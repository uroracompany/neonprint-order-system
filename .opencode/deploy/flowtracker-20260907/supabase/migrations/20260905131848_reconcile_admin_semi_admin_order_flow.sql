-- Reconcile the operational surfaces after the manually-applied Semi-Admin
-- migrations. This migration intentionally keeps all sensitive helpers private.

create or replace function public.validate_order_assignment_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.designer_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.designer_id
      and p.role in ('designer', 'semi_admin')
      and coalesce(p.employment_status, true) = true
      and p.deleted_at is null
  ) then
    raise exception 'designer_id must reference an active designer or semi-admin profile';
  end if;

  if new.quote_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.quote_id
      and (
        p.role in ('quote', 'semi_admin')
        or (
          p.role = 'admin'
          and new.quote_id = auth.uid()
          and new.updated_by = auth.uid()
          and current_setting('app.neonprint_order_command', true) = 'on'
          and current_setting('app.admin_intervention_context', true) = 'route_quote'
        )
      )
      and coalesce(p.employment_status, true) = true
      and p.deleted_at is null
  ) then
    raise exception 'quote_id must reference an active quote, semi-admin, or the acting administrator profile';
  end if;
  return new;
end;
$$;

create or replace function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_catalog jsonb;
  v_actions jsonb;
  v_unavailable jsonb;
  v_payment_status text;
begin
  perform public.require_active_semi_admin_actor();
  v_catalog := public.semi_admin_get_order_command_catalog_base(p_order_id);
  if coalesce((v_catalog->>'locked')::boolean, false) then return v_catalog; end if;

  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
  from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) action
  where action->>'key' not in ('register_payment', 'grant_credit');
  select coalesce(jsonb_agg(
    case when action->>'key' = 'route_production'
      then action || jsonb_build_object('next_safe_step', 'Caja debe registrar el pago o crédito y completar las especificaciones de cada archivo.')
      else action end
  ), '[]'::jsonb) into v_unavailable
  from jsonb_array_elements(coalesce(v_catalog->'unavailable_actions', '[]'::jsonb)) action;

  if v_catalog->>'active_stage' = 'quote' then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
      'key', 'payment_operations',
      'title', 'Pago y crédito',
      'next_safe_step', 'El estado de pago y crédito solo puede ser gestionado por Caja o Administración.'
    ));
  elsif v_catalog->>'active_stage' = 'production' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action
    where action->>'key' not in ('stage_responsibility', 'reassign_production_file', 'manage_production');
    v_catalog := jsonb_set(v_catalog, '{can_operate_current_stage}', 'false'::jsonb, true);
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
      'key', 'production_operations', 'title', 'Producción',
      'next_safe_step', 'Producción se gestiona exclusivamente por el operador asignado.'
    ));
  elsif v_catalog->>'active_stage' = 'delivery' then
    select payment_status into v_payment_status from public.orders where id = p_order_id;
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action
    where action->>'key' <> 'mark_delivered';
    if v_payment_status in ('pagado', 'credito') then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega'));
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'delivery_operations', 'title', 'Acciones de Entrega',
        'next_safe_step', 'La orden debe estar pagada o a crédito antes de entregarse.'
      ));
    end if;
  end if;

  return jsonb_set(jsonb_set(v_catalog, '{actions}', v_actions, true), '{unavailable_actions}', v_unavailable, true);
end;
$$;

create or replace function public.semi_admin_execute_order_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.orders;
begin
  perform public.require_active_semi_admin_actor();
  if p_action in ('set_payment', 'mark_credit') then
    raise exception 'Semi-Administración no puede modificar el estado de pago ni otorgar crédito.';
  end if;
  if p_action in ('production_file_status', 'reassign_production_file')
    or (p_action = 'stage_responsibility' and p_payload->>'stage' = 'production') then
    raise exception 'Semi-Administración no puede gestionar Producción.';
  end if;
  if p_action = 'mark_delivered' then
    select * into v_result from public.semi_admin_mark_order_delivered(
      p_order_id, nullif(p_payload->>'delivery_note', ''), p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));
  end if;
  return public.semi_admin_execute_order_command_base(p_order_id, p_action, p_payload, p_expected_updated_at);
end;
$$;

create or replace function public.notify_semi_admin_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_only_update boolean := false;
  v_title text;
  v_message text;
  v_assignee_name text;
  v_stage_label text;
begin
  if new.event_type = 'semi_admin_order_updated' then
    select not exists (
      select 1 from jsonb_object_keys(coalesce(new.changes -> 'changes', '{}'::jsonb)) as key(name)
      where key.name not in ('order_file_url', 'preview_image', 'reference_images')
    ) into v_asset_only_update;
  end if;
  if new.actor_id is null or new.event_type not like 'semi_admin_%' or v_asset_only_update
    or not exists (select 1 from public.profiles profile where profile.id = new.actor_id and profile.role = 'semi_admin') then
    return new;
  end if;

  case new.event_type
    when 'semi_admin_order_created' then
      v_title := 'Orden creada correctamente';
      v_message := 'La orden fue creada y quedó lista para continuar el flujo.';
    when 'semi_admin_send_to_designer' then
      v_title := 'Orden enviada a Diseño correctamente';
      v_message := 'La orden fue asignada a Diseño correctamente.';
    when 'semi_admin_send_to_quote', 'semi_admin_send_design_to_quote' then
      v_title := 'Orden enviada a Caja correctamente';
      v_message := 'La orden fue asignada a Caja correctamente.';
    when 'semi_admin_production_routed' then
      v_title := 'Orden enviada a Producción correctamente';
      v_message := 'Las asignaciones por área fueron registradas correctamente.';
    when 'semi_admin_stage_responsibility_changed' then
      if coalesce((new.changes->>'self_assigned')::boolean, false) then
        v_title := 'Orden asignada a mí correctamente';
        v_message := 'Ahora eres el responsable de esta etapa.';
      else
        select name into v_assignee_name from public.profiles where id = nullif(new.changes->>'responsible_id', '')::uuid;
        v_stage_label := case new.changes->>'stage' when 'design' then 'Diseño' when 'quote' then 'Caja' when 'delivery' then 'Entrega' else 'la etapa' end;
        v_title := 'Responsable actualizado correctamente';
        v_message := 'Responsable de ' || v_stage_label || ' asignado a ' || coalesce(v_assignee_name, 'usuario seleccionado') || '.';
      end if;
    else
      return new;
  end case;

  insert into public.notifications(user_id, type, title, message, order_id, metadata)
  values (new.actor_id, 'success', v_title, v_message, new.order_id,
    jsonb_build_object('event_type', new.event_type, 'actor_id', new.actor_id, 'event_kind', 'semi_admin_confirmation'));
  return new;
end;
$$;

create or replace function public.admin_route_quote_to_actor_command(
  p_order_id uuid,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_old public.orders;
  v_new public.orders;
  v_existing jsonb;
  v_blockers jsonb;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
  v_request_hash text := md5(concat_ws('|', p_order_id::text, 'route_quote', p_reason_category, p_reason_detail, v_actor::text));
begin
  select result into v_existing from public.admin_order_command_executions where idempotency_key = p_idempotency_key;
  if found then
    if v_existing is null then raise exception 'El comando ya está en proceso.'; end if;
    return v_existing;
  end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'La orden cambió mientras la editabas. Actualiza los datos e intenta nuevamente.'; end if;
  if v_old.operational_status = 'blocked' then raise exception 'La orden está bloqueada. Reanúdala antes de continuar.'; end if;
  if (v_old.order_design_type = 'INTERNAL_DESING' and v_old.status <> 'in_Design')
    or (v_old.order_design_type <> 'INTERNAL_DESING' and v_old.status <> 'Pending') then
    raise exception 'La orden no está en una etapa válida para enviarse a Caja.';
  end if;
  v_blockers := public._admin_validate_order_completeness(p_order_id, 'route_quote');
  if jsonb_array_length(v_blockers) > 0 then raise exception '%', v_blockers->0->>'message'; end if;

  insert into public.admin_order_command_executions(idempotency_key, order_id, actor_id, action, request_hash)
  values (p_idempotency_key, p_order_id, v_actor, 'route_quote', v_request_hash);
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'route_quote', true);
  update public.orders set status = 'in_Quote', quote_id = v_actor, delivery_id = null,
    updated_by = v_actor, last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
    last_admin_intervention_kind = 'route_quote', updated_at = now()
  where id = p_order_id returning * into v_new;
  perform public.record_admin_intervention(v_old, v_new, 'route_quote', p_reason_category, trim(p_reason_detail), v_started_at, null);
  v_result := jsonb_build_object('order', to_jsonb(v_new), 'action', 'route_quote', 'success', true);
  update public.admin_order_command_executions set result = v_result, completed_at = now() where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb, p_reason_category text,
  p_reason_detail text, p_expected_updated_at timestamptz, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_target_user_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoría de motivo válida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.'; end if;
  if exists (select 1 from public.admin_order_command_executions where idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(p_order_id, p_action, v_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  perform public.assert_admin_order_action_allowed(p_order_id, p_action);
  if p_action = 'route_quote' then
    v_target_user_id := nullif(v_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is null then
      return public.admin_route_quote_to_actor_command(p_order_id, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
    end if;
    if not exists (select 1 from public.profiles p where p.id = v_target_user_id and p.role = 'quote' and coalesce(p.employment_status, true) and p.deleted_at is null) then
      raise exception 'Selecciona un responsable activo de Caja.';
    end if;
  elsif p_action = 'assign_seller' then
    v_target_user_id := nullif(v_payload->>'target_user_id', '')::uuid;
    if v_target_user_id = v_actor then v_payload := jsonb_set(v_payload, '{target_user_id}', 'null'::jsonb, true);
    elsif v_target_user_id is not null and not exists (select 1 from public.profiles p where p.id = v_target_user_id and p.role = 'seller' and coalesce(p.employment_status, true) and p.deleted_at is null) then raise exception 'Selecciona un vendedor activo.'; end if;
  elsif p_action in ('route_design', 'set_designer_assignee') then
    v_target_user_id := nullif(v_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is null then raise exception 'Selecciona un diseñador responsable.'; end if;
    if v_target_user_id <> v_actor and not exists (select 1 from public.profiles p where p.id = v_target_user_id and p.role = 'designer' and coalesce(p.employment_status, true) and p.deleted_at is null) then raise exception 'Selecciona un diseñador activo o Administración (yo).'; end if;
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  return public.admin_execute_order_command_legacy(p_order_id, p_action, v_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
end;
$$;

revoke all on function public.admin_route_quote_to_actor_command(uuid,text,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.notify_semi_admin_order_event() from public, anon, authenticated;
revoke all on function public.semi_admin_set_order_payment(uuid,text,text,timestamptz), public.semi_admin_mark_order_credit(uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.semi_admin_get_order_command_catalog(uuid), public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) from public, anon;
grant execute on function public.semi_admin_get_order_command_catalog(uuid), public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) to authenticated;
revoke all on function public.admin_execute_order_command(uuid,text,jsonb,text,text,timestamptz,text) from public, anon;
grant execute on function public.admin_execute_order_command(uuid,text,jsonb,text,text,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
