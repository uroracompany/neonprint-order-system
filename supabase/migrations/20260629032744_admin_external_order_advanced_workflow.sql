-- Case-oriented advanced workflow for orders created as external design.
-- The existing generic intervention engine remains the source of truth for
-- validations and audit history; this migration exposes only the actions that
-- make sense for this case and narrows notification recipients per transition.

create or replace function public.admin_external_intervention_recipient_ids(
  p_old public.orders,
  p_new public.orders,
  p_action text
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with candidates(user_id) as (
    select case when p_action = 'route_quote' then coalesce(p_old.seller_id, p_old.created_by) end
    union all select case when p_action = 'route_quote' then p_new.quote_id end
    union all select case when p_action = 'set_quote_assignee' then p_old.quote_id end
    union all select case when p_action = 'set_quote_assignee' then p_new.quote_id end
    union all select case when p_action = 'route_sales' then p_old.quote_id end
    union all select case when p_action = 'route_sales' then coalesce(p_new.seller_id, p_new.created_by) end
    union all select case when p_action = 'route_production' then p_old.quote_id end
  )
  select coalesce(array_agg(distinct p.id), array[]::uuid[])
  from candidates c
  join public.profiles p on p.id = c.user_id
  where c.user_id is not null
    and coalesce(p.employment_status, true) = true
$$;

create or replace function public.admin_external_intervention_label(
  p_old public.orders,
  p_new public.orders,
  p_action text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_action = 'set_quote_assignee' and p_old.quote_id is null and p_new.quote_id is not null
      then 'Asignada a Caja por Administracion'
    when p_action = 'set_quote_assignee' and p_old.quote_id is not null and p_new.quote_id is null
      then 'Asignacion de Caja retirada por Administracion'
    when p_action = 'set_quote_assignee'
      then 'Caja reasignada por Administracion'
    when p_action = 'mark_delivered'
      then 'Marcada como Entregada por Administracion'
    when p_action = 'return_to_completed'
      then 'Regresada a Completado por Administracion'
    else public.admin_intervention_action_label(p_action)
  end
$$;

create or replace function public.record_admin_intervention(
  p_old public.orders,
  p_new public.orders,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_started_at timestamptz,
  p_custom_changed_fields jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  event_id uuid;
  recipients uuid[];
  changed_fields jsonb;
  event_label text := public.admin_external_intervention_label(p_old, p_new, p_action);
  reason_label text := public.admin_intervention_reason_label(p_reason_category);
begin
  if p_custom_changed_fields is null then
    select coalesce(jsonb_agg(
      item || jsonb_build_object(
        'old_value', public.admin_order_edit_value(p_old, item->>'field'),
        'new_value', public.admin_order_edit_value(p_new, item->>'field')
      )
    ), '[]'::jsonb)
    into changed_fields
    from jsonb_array_elements(public.order_business_changed_fields(p_old, p_new)) as changed(item);
  else
    changed_fields := p_custom_changed_fields;
  end if;

  delete from public.order_events
  where order_id = p_new.id
    and public.order_events.actor_id is not distinct from v_actor_id
    and event_type in ('order_updated', 'admin_edited_order')
    and created_at >= p_started_at;

  insert into public.order_events (
    order_id, actor_id, event_type, old_status, new_status,
    old_payment_status, new_payment_status, changes
  ) values (
    p_new.id, v_actor_id, 'admin_intervention', p_old.status, p_new.status,
    p_old.payment_status, p_new.payment_status,
    jsonb_build_object(
      'source_module', 'admin', 'action', p_action,
      'reason_category', p_reason_category, 'reason_label', reason_label,
      'reason_detail', p_reason_detail, 'changed_fields', changed_fields,
      'old', to_jsonb(p_old), 'new', to_jsonb(p_new)
    )
  ) returning id into event_id;

  if p_old.order_design_type = 'EXTERNAL_DESING'
    and p_action in ('route_quote', 'set_quote_assignee', 'route_sales', 'route_production') then
    select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
      into recipients
    from unnest(public.admin_external_intervention_recipient_ids(p_old, p_new, p_action)) recipient_id
    where recipient_id is distinct from v_actor_id;
  else
    select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
      into recipients
    from unnest(public.order_realtime_recipient_ids(p_old, p_new)) recipient_id
    where recipient_id is not null and recipient_id is distinct from v_actor_id;
  end if;

  perform public.create_order_event_reviews(
    event_id, p_new.id, recipients, event_label, 'admin', 'admin_intervention',
    changed_fields,
    event_label || '. Motivo: ' || reason_label || '. ' || p_reason_detail,
    jsonb_build_object(
      'actor_id', v_actor_id, 'actor_role', 'admin', 'action', p_action,
      'reason_category', p_reason_category, 'reason_label', reason_label,
      'reason_detail', p_reason_detail, 'changed_at', now()
    )
  );

  perform public.notify_many(
    recipients, 'order_updated', event_label,
    'La orden #' || left(p_new.id::text, 8) || ' fue actualizada por Administracion. Motivo: ' || reason_label || '.',
    p_new.id,
    jsonb_build_object(
      'event_kind', 'admin_intervention', 'event_id', event_id,
      'actor_id', v_actor_id, 'action', p_action,
      'reason_category', p_reason_category, 'reason_label', reason_label,
      'reason_detail', p_reason_detail, 'changed_fields', changed_fields,
      'deep_link', '/dashboard?order=' || p_new.id::text
    )
  );
  return event_id;
end;
$$;

create or replace function public.get_admin_external_order_actions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  order_row public.orders;
  quote_blockers jsonb;
  production_blockers jsonb;
  actions jsonb := '[]'::jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede consultar estas acciones.';
  end if;

  select * into order_row from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  if order_row.order_design_type <> 'EXTERNAL_DESING' then
    raise exception 'Esta configuracion solo aplica a ordenes de Diseno Externo.';
  end if;

  if order_row.status = 'Pending' then
    quote_blockers := public.admin_order_action_blockers(p_order_id, 'route_quote');
    if jsonb_array_length(quote_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'route_quote', 'label', 'Enviar a Caja', 'target_role', 'quote'
      ));
    end if;
  elsif order_row.status = 'in_Quote' then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'set_quote_assignee', 'label', 'Gestionar usuario de Caja', 'target_role', 'quote'),
      jsonb_build_object('key', 'route_sales', 'label', 'Regresar orden a Ventas', 'target_role', 'seller'),
      jsonb_build_object('key', 'register_payment', 'label', 'Registrar pago')
    );
    production_blockers := public.admin_order_action_blockers(p_order_id, 'route_production');
    if jsonb_array_length(production_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'route_production', 'label', 'Enviar a Produccion',
        'requires_area_assignments', true
      ));
    end if;
  end if;

  return jsonb_build_object(
    'order_id', order_row.id,
    'expected_updated_at', order_row.updated_at,
    'actions', actions
  );
end;
$$;

create or replace function public.admin_manage_external_order(
  p_order_id uuid,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_target_user_id uuid default null,
  p_area_assignments jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_order public.orders;
  new_order public.orders;
  started_at timestamptz := clock_timestamp();
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;
  if p_action not in ('route_quote', 'set_quote_assignee', 'route_sales', 'route_production') then
    raise exception 'La accion no pertenece al flujo de Diseno Externo.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into old_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if old_order.order_design_type <> 'EXTERNAL_DESING' then
    raise exception 'Esta accion solo aplica a ordenes de Diseno Externo.';
  end if;
  if p_expected_updated_at is null or old_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  if p_action = 'set_quote_assignee' then
    if old_order.status <> 'in_Quote' then
      raise exception 'La orden debe encontrarse en Caja para gestionar su responsable.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and p.role = 'quote'
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un usuario de Caja activo.';
    end if;
    if old_order.quote_id is not distinct from p_target_user_id then
      raise exception 'La asignacion de Caja no ha cambiado.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set quote_id = p_target_user_id,
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  if p_action = 'route_quote' and old_order.status <> 'Pending' then
    raise exception 'Solo una orden en Ventas puede enviarse a Caja desde este flujo.';
  end if;
  if p_action in ('route_sales', 'route_production') and old_order.status <> 'in_Quote' then
    raise exception 'La orden debe encontrarse en Caja para realizar esta accion.';
  end if;

  return public.admin_intervene_order(
    p_order_id, p_action, p_reason_category, trim(p_reason_detail),
    p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
  );
end;
$$;

create or replace function public.mark_order_events_reviewed(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  reviewed_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  with reviewed as (
    update public.order_event_reviews
       set reviewed_at = now(), reviewed_by = current_user_id
     where order_id = p_order_id and user_id = current_user_id and reviewed_at is null
     returning id
  ) select count(*)::integer into reviewed_count from reviewed;

  update public.notifications
     set is_read = true, read_at = coalesce(read_at, now())
   where user_id = current_user_id and order_id = p_order_id and is_read = false
     and metadata->>'event_kind' in (
       'admin_order_edit_area_notice', 'admin_edited_order', 'admin_intervention',
       'design_files_changed', 'production_files_changed',
       'production_assignment_changed', 'delivery_changed', 'payment_updated'
     );
  return reviewed_count;
end;
$$;

revoke all on function public.admin_external_intervention_recipient_ids(public.orders, public.orders, text) from public, anon, authenticated;
revoke all on function public.admin_external_intervention_label(public.orders, public.orders, text) from public, anon, authenticated;
revoke all on function public.record_admin_intervention(public.orders, public.orders, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.get_admin_external_order_actions(uuid) from public, anon;
revoke all on function public.admin_manage_external_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
revoke all on function public.mark_order_events_reviewed(uuid) from public, anon;
grant execute on function public.get_admin_external_order_actions(uuid) to authenticated;
grant execute on function public.admin_manage_external_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
grant execute on function public.mark_order_events_reviewed(uuid) to authenticated;
