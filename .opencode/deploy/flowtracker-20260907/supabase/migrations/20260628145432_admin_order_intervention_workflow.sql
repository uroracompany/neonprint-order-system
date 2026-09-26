-- Controlled administrative interventions for orders.
-- Admins gain flexibility through validated actions, never through free-form status writes.

alter table public.orders
  add column if not exists last_admin_intervention_at timestamptz,
  add column if not exists last_admin_intervention_by uuid references public.profiles(id),
  add column if not exists last_admin_intervention_kind text;

create index if not exists idx_orders_last_admin_intervention
  on public.orders(last_admin_intervention_at desc)
  where last_admin_intervention_at is not null;

create or replace function public.admin_intervention_reason_label(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'client_request' then 'Solicitud del cliente'
    when 'assignment_correction' then 'Correccion de responsable'
    when 'workflow_correction' then 'Correccion de flujo'
    when 'quality_rework' then 'Retrabajo o calidad'
    when 'operational_priority' then 'Prioridad operativa'
    when 'other' then 'Otro'
    else null
  end
$$;

create or replace function public.admin_intervention_action_label(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'assign_seller' then 'Reasignada por Administracion'
    when 'route_sales' then 'Movida a Ventas por Administracion'
    when 'route_design' then 'Movida a Diseno por Administracion'
    when 'route_quote' then 'Movida a Caja por Administracion'
    when 'route_production' then 'Movida a Produccion por Administracion'
    when 'reassign_production' then 'Produccion reasignada por Administracion'
    when 'route_completed' then 'Asignada a Entrega por Administracion'
    when 'production_file_status' then 'Archivo actualizado por Administracion'
    when 'production_file_reopened' then 'Archivo reabierto por Administracion'
    else 'Intervenida por Administracion'
  end
$$;

create or replace function public.admin_order_action_blockers(
  p_order_id uuid,
  p_action text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_row public.orders;
  blockers jsonb := '[]'::jsonb;
  file_count integer := 0;
  invalid_file_count integer := 0;
  completed_count integer := 0;
begin
  select * into order_row
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_array(jsonb_build_object('code', 'order_not_found', 'message', 'La orden no existe.'));
  end if;

  if p_action not in (
    'assign_seller', 'route_sales', 'route_design', 'route_quote',
    'route_production', 'reassign_production', 'route_completed'
  ) then
    return jsonb_build_array(jsonb_build_object('code', 'invalid_action', 'message', 'La accion administrativa no es valida.'));
  end if;

  if order_row.status in ('cancelled', 'in_Delivered') then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'terminal_order',
      'message', 'Las ordenes canceladas o entregadas no pueden reabrirse.'
    ));
  end if;

  if p_action = 'route_design' and order_row.order_design_type = 'EXTERNAL_DESING' then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'external_design',
      'message', 'Una orden de diseno externo no puede enviarse a Diseno.'
    ));
  end if;

  if p_action in ('route_quote', 'route_production', 'reassign_production', 'route_completed') then
    select
      count(*),
      count(*) filter (
        where opf.production_area_code is null
          or nullif(trim(coalesce(opf.public_label, '')), '') is null
          or pa.code is null
      ),
      count(*) filter (where opf.status = 'completed')
    into file_count, invalid_file_count, completed_count
    from public.order_production_files opf
    left join public.production_areas pa
      on pa.code = opf.production_area_code
     and pa.is_active = true
    where opf.order_id = p_order_id;
  end if;

  if p_action in ('route_quote', 'route_production') then
    if nullif(trim(coalesce(order_row.preview_image, '')), '') is null then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_preview',
        'message', 'Falta la imagen de la orden de trabajo.'
      ));
    end if;
    if file_count = 0 then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_work_files',
        'message', 'Debe existir al menos un archivo de trabajo.'
      ));
    elsif invalid_file_count > 0 then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'unclassified_files',
        'message', 'Todos los archivos deben tener nombre y un area de produccion activa.'
      ));
    end if;
  end if;

  if p_action = 'route_production' then
    if order_row.status <> 'in_Quote' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_quote',
        'message', 'La orden debe encontrarse en Caja antes de entrar a Produccion.'
      ));
    end if;
    if order_row.payment_status not in ('pagado', 'parcial', 'credito') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_payment',
        'message', 'Produccion requiere pago pagado, parcial o aprobado a credito.'
      ));
    end if;
    if file_count > 0 and completed_count = file_count then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'all_files_completed',
        'message', 'Todos los archivos siguen completados. Reabre al menos uno antes de volver a Produccion.'
      ));
    end if;
  end if;

  if p_action = 'reassign_production'
    and order_row.status not in ('in_Production', 'in_Termination') then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'not_in_production',
      'message', 'Solo se puede reasignar Produccion mientras la orden esta en Produccion o Terminacion.'
    ));
  end if;

  if p_action = 'route_completed' then
    if order_row.status not in ('in_Production', 'in_Termination', 'in_Completed') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_production',
        'message', 'La orden debe estar en Produccion o Terminacion para enviarse a Entrega.'
      ));
    end if;
    if file_count = 0 or completed_count <> file_count then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'incomplete_files',
        'message', 'Todos los archivos de Produccion deben estar completados.'
      ));
    end if;
    if order_row.payment_status not in ('pagado', 'credito') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'delivery_payment',
        'message', 'Entrega requiere pago total o credito aprobado.'
      ));
    end if;
  end if;

  return blockers;
end;
$$;

create or replace function public.get_admin_order_action_availability(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  order_row public.orders;
  action_key text;
  action_items jsonb := '[]'::jsonb;
  action_blockers jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id
      and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede consultar estas acciones.';
  end if;

  select * into order_row from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  foreach action_key in array array[
    'assign_seller', 'route_sales', 'route_design', 'route_quote',
    'route_production', 'reassign_production', 'route_completed'
  ] loop
    action_blockers := public.admin_order_action_blockers(p_order_id, action_key);
    action_items := action_items || jsonb_build_array(jsonb_build_object(
      'key', action_key,
      'label', public.admin_intervention_action_label(action_key),
      'allowed', jsonb_array_length(action_blockers) = 0,
      'blockers', action_blockers,
      'target_role', case
        when action_key in ('assign_seller', 'route_sales') then 'seller'
        when action_key = 'route_design' then 'designer'
        when action_key = 'route_quote' then 'quote'
        when action_key = 'route_completed' then 'delivery'
        else null
      end,
      'requires_area_assignments', action_key in ('route_production', 'reassign_production')
    ));
  end loop;

  return jsonb_build_object(
    'order_id', order_row.id,
    'expected_updated_at', order_row.updated_at,
    'actions', action_items
  );
end;
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
  event_label text := public.admin_intervention_action_label(p_action);
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
      'source_module', 'admin',
      'action', p_action,
      'reason_category', p_reason_category,
      'reason_label', reason_label,
      'reason_detail', p_reason_detail,
      'changed_fields', changed_fields,
      'old', to_jsonb(p_old),
      'new', to_jsonb(p_new)
    )
  ) returning id into event_id;

  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
  into recipients
  from unnest(public.order_realtime_recipient_ids(p_old, p_new)) recipient_id
  where recipient_id is not null
    and recipient_id is distinct from v_actor_id;

  perform public.create_order_event_reviews(
    event_id,
    p_new.id,
    recipients,
    event_label,
    'admin',
    'admin_intervention',
    changed_fields,
    event_label || '. Motivo: ' || reason_label || '. ' || p_reason_detail,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', 'admin',
      'action', p_action,
      'reason_category', p_reason_category,
      'reason_label', reason_label,
      'reason_detail', p_reason_detail,
      'changed_at', now()
    )
  );

  perform public.notify_many(
    recipients,
    'order_updated',
    event_label,
    'La orden #' || left(p_new.id::text, 8) || ' fue intervenida por Administracion. Motivo: ' || reason_label || '.',
    p_new.id,
    jsonb_build_object(
      'event_kind', 'admin_intervention',
      'event_id', event_id,
      'actor_id', v_actor_id,
      'action', p_action,
      'reason_category', p_reason_category,
      'reason_label', reason_label,
      'reason_detail', p_reason_detail,
      'changed_fields', changed_fields,
      'deep_link', '/dashboard?order=' || p_new.id::text
    )
  );

  return event_id;
end;
$$;

create or replace function public.admin_intervene_order(
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
  blockers jsonb;
  expected_role text;
  area_row record;
  assigned_user_id uuid;
  started_at timestamptz := clock_timestamp();
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;

  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into old_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'La orden no existe.'; end if;

  if p_expected_updated_at is null or old_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  blockers := public.admin_order_action_blockers(p_order_id, p_action);
  if jsonb_array_length(blockers) > 0 then
    raise exception '%', blockers->0->>'message';
  end if;

  expected_role := case
    when p_action in ('assign_seller', 'route_sales') then 'seller'
    when p_action = 'route_design' then 'designer'
    when p_action = 'route_quote' then 'quote'
    when p_action = 'route_completed' then 'delivery'
    else null
  end;

  if expected_role is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_target_user_id
      and p.role = expected_role
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Selecciona un responsable activo del departamento correcto.';
  end if;

  perform set_config('app.admin_intervention_context', p_action, true);

  if p_action = 'assign_seller' then
    update public.orders set seller_id = p_target_user_id, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_sales' then
    update public.orders
    set status = 'Pending', seller_id = p_target_user_id,
        designer_id = null, quote_id = null, delivery_id = null, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_design' then
    update public.orders
    set status = 'in_Design', designer_id = p_target_user_id,
        quote_id = null, delivery_id = null, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_quote' then
    update public.orders
    set status = 'in_Quote', quote_id = p_target_user_id,
        delivery_id = null, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_production' then
    perform public.send_order_to_production(p_order_id, coalesce(p_area_assignments, '{}'::jsonb));
  elsif p_action = 'reassign_production' then
    if jsonb_typeof(coalesce(p_area_assignments, '{}'::jsonb)) <> 'object' then
      raise exception 'Las asignaciones de Produccion no son validas.';
    end if;
    for area_row in
      select distinct pa.code, pa.label, pa.producer_role
      from public.order_production_files opf
      join public.production_areas pa on pa.code = opf.production_area_code and pa.is_active = true
      where opf.order_id = p_order_id
    loop
      begin
        assigned_user_id := nullif(trim(p_area_assignments->>area_row.code), '')::uuid;
      exception when invalid_text_representation then
        raise exception 'El responsable de % no es valido.', area_row.label;
      end;
      if assigned_user_id is null or not exists (
        select 1 from public.profiles p
        where p.id = assigned_user_id and p.role = area_row.producer_role
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Debes asignar un responsable activo para %.', area_row.label;
      end if;
      insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by)
      values (p_order_id, area_row.code, assigned_user_id, actor_id)
      on conflict (order_id, production_area_code) do update
      set assigned_to = excluded.assigned_to,
          assigned_by = excluded.assigned_by,
          updated_at = now();
      update public.order_production_files
      set assigned_to = assigned_user_id, updated_by = actor_id
      where order_id = p_order_id and production_area_code = area_row.code;
    end loop;
    update public.orders set updated_at = now() where id = p_order_id;
  elsif p_action = 'route_completed' then
    update public.orders
    set status = 'in_Completed', delivery_id = p_target_user_id, updated_at = now()
    where id = p_order_id;
  end if;

  update public.orders
  set last_admin_intervention_at = now(),
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
end;
$$;

create or replace function public.admin_update_production_file_status(
  p_file_id uuid,
  p_next_status text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_delivery_id uuid default null
)
returns public.order_production_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  file_row public.order_production_files;
  old_file_status text;
  old_order public.orders;
  new_order public.orders;
  other_incomplete integer;
  action_key text := 'production_file_status';
  started_at timestamptz := clock_timestamp();
  changed_fields jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede cambiar archivos de Produccion.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into file_row
  from public.order_production_files
  where id = p_file_id
  for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  old_file_status := file_row.status;
  if p_expected_updated_at is null or file_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'El archivo cambio mientras lo editabas. Actualiza e intenta nuevamente.';
  end if;

  select * into old_order from public.orders where id = file_row.order_id for update;
  if old_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'No se pueden modificar archivos de una orden terminal.';
  end if;

  if not (
    (file_row.status = 'pending' and p_next_status = 'in_production') or
    (file_row.status = 'in_production' and p_next_status = 'in_termination') or
    (file_row.status = 'in_termination' and p_next_status in ('in_production', 'completed')) or
    (file_row.status = 'completed' and p_next_status = 'in_termination')
  ) then
    raise exception 'La transicion solicitada no es valida para este archivo.';
  end if;

  perform set_config('app.admin_intervention_context', 'production_file_status', true);

  if file_row.status = 'completed' and p_next_status = 'in_termination' then
    action_key := 'production_file_reopened';
    update public.orders set delivery_id = null where id = old_order.id;
  end if;

  if p_next_status = 'completed' then
    select count(*) into other_incomplete
    from public.order_production_files
    where order_id = file_row.order_id and id <> file_row.id and status <> 'completed';
    if other_incomplete = 0 then
      if not exists (
        select 1 from public.profiles p
        where p.id = p_delivery_id and p.role = 'delivery'
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.';
      end if;
      update public.orders set delivery_id = p_delivery_id where id = old_order.id;
    end if;
  end if;

  update public.order_production_files
  set status = p_next_status, updated_by = actor_id, updated_at = now()
  where id = p_file_id
  returning * into file_row;

  perform public.recalculate_order_production_status(file_row.order_id);
  update public.orders
  set last_admin_intervention_at = now(),
      last_admin_intervention_by = actor_id,
      last_admin_intervention_kind = action_key,
      updated_at = now()
  where id = file_row.order_id
  returning * into new_order;

  changed_fields := jsonb_build_array(jsonb_build_object(
    'field', 'production_file_status',
    'label', coalesce(file_row.public_label, 'Archivo de Produccion'),
    'old_value', case old_file_status
      when 'pending' then 'Pendiente'
      when 'in_production' then 'En produccion'
      when 'in_termination' then 'En terminacion'
      when 'completed' then 'Completado'
    end,
    'new_value', case p_next_status
      when 'in_production' then 'En produccion'
      when 'in_termination' then 'En terminacion'
      when 'completed' then 'Completado'
    end,
    'area', file_row.production_area_code
  ));

  perform public.record_admin_intervention(
    old_order, new_order, action_key, p_reason_category,
    trim(p_reason_detail), started_at, changed_fields
  );
  return file_row;
end;
$$;

-- Restore the production-entry guard lost when the payment guard was replaced.
create or replace function public.check_production_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  file_count integer;
  invalid_file_count integer;
begin
  if new.status = 'in_Production' and old.status is distinct from new.status then
    if old.status not in ('in_Quote', 'in_Termination') then
      raise exception 'La orden debe pasar por Caja antes de entrar a Produccion.';
    end if;
    if coalesce(new.payment_status, old.payment_status) not in ('pagado', 'parcial', 'credito') then
      raise exception 'Produccion requiere pago pagado, parcial o aprobado a credito.';
    end if;
    select
      count(*),
      count(*) filter (
        where opf.production_area_code is null
          or nullif(trim(coalesce(opf.public_label, '')), '') is null
          or pa.code is null
      )
    into file_count, invalid_file_count
    from public.order_production_files opf
    left join public.production_areas pa
      on pa.code = opf.production_area_code and pa.is_active = true
    where opf.order_id = new.id;
    if nullif(trim(coalesce(new.preview_image, '')), '') is null
      or file_count = 0 or invalid_file_count > 0 then
      raise exception 'La orden requiere imagen de trabajo y todos sus archivos clasificados antes de Produccion.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_production_eligibility on public.orders;
create trigger trg_check_production_eligibility
  before update of status on public.orders
  for each row execute function public.check_production_eligibility();

-- Skip the generic admin-review event while a semantic intervention is being recorded.
create or replace function public.handle_admin_order_edit_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_profile_role();
  changed_fields jsonb := public.order_business_changed_fields(old, new);
  event_id uuid;
  source_module text := public.order_event_source_module(actor_role);
begin
  if tg_op <> 'UPDATE' or coalesce(actor_role, '') <> 'admin' then return new; end if;
  if nullif(current_setting('app.admin_intervention_context', true), '') is not null then return new; end if;
  if jsonb_array_length(changed_fields) = 0 then return new; end if;

  insert into public.order_events (
    order_id, actor_id, event_type, old_status, new_status,
    old_payment_status, new_payment_status, changes
  ) values (
    new.id, actor_id, 'admin_edited_order', old.status, new.status,
    old.payment_status, new.payment_status,
    jsonb_build_object(
      'source_module', source_module,
      'changed_fields', changed_fields,
      'old', to_jsonb(old),
      'new', to_jsonb(new)
    )
  ) returning id into event_id;

  perform public.notify_admin_order_edit_area_alerts(
    old, new, event_id, actor_id, actor_role, changed_fields
  );
  return new;
end;
$$;

revoke all on function public.admin_intervention_reason_label(text) from public, anon, authenticated;
revoke all on function public.admin_intervention_action_label(text) from public, anon, authenticated;
revoke all on function public.admin_order_action_blockers(uuid, text) from public, anon, authenticated;
revoke all on function public.record_admin_intervention(public.orders, public.orders, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.get_admin_order_action_availability(uuid) from public, anon;
revoke all on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
revoke all on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.get_admin_order_action_availability(uuid) to authenticated;
grant execute on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
grant execute on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid) to authenticated;
