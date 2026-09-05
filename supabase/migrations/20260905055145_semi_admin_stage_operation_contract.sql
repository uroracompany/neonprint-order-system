-- Reconcile Semi-Admin operations around the stage assignee.  This migration
-- deliberately does not reuse Administration commands or permissions.

create or replace function public.semi_admin_can_operate_stage(
  p_order_id uuid,
  p_stage text,
  p_production_area_code text default null
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then return false; end if;
  if p_stage = 'design' then
    return v_order.status in ('in_Design', 'In_Design') and v_order.designer_id = v_actor;
  elsif p_stage = 'quote' then
    return v_order.status = 'in_Quote' and v_order.quote_id = v_actor;
  elsif p_stage = 'delivery' then
    return v_order.status = 'in_Completed' and v_order.delivery_id = v_actor;
  elsif p_stage = 'production' then
    return v_order.status in ('in_Production', 'in_Termination')
      and p_production_area_code is not null
      and exists (
        select 1 from public.order_production_assignments a
        where a.order_id = p_order_id and a.production_area_code = p_production_area_code and a.assigned_to = v_actor
      );
  end if;
  return false;
end $$;

revoke all on function public.semi_admin_can_operate_stage(uuid,text,text) from public, anon;
grant execute on function public.semi_admin_can_operate_stage(uuid,text,text) to authenticated;

create or replace function public.semi_admin_transition_order(
  p_order_id uuid, p_action text, p_target_user_id uuid default null,
  p_reason text default null, p_expected_updated_at timestamptz default null
) returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders;
  v_new public.orders;
  v_target_role text;
begin
  if p_action not in ('send_to_designer', 'send_to_quote') then
    raise exception 'Acción de orden no permitida para Semi-Administración.';
  end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' then raise exception 'La orden está archivada o bloqueada.'; end if;
  if v_old.status not in ('Pending', 'pending') then raise exception 'La orden debe estar en Ventas antes de asignar su siguiente etapa.'; end if;
  select role into v_target_role from public.profiles
    where id = p_target_user_id and coalesce(employment_status, true) and deleted_at is null;
  if p_action = 'send_to_designer' and v_target_role not in ('designer', 'semi_admin') then
    raise exception 'Selecciona un Diseñador o Semi-Administrador activo.';
  end if;
  if p_action = 'send_to_quote' and (v_old.order_design_type <> 'EXTERNAL_DESING' or v_target_role not in ('quote', 'semi_admin')) then
    raise exception 'Selecciona un usuario de Caja o Semi-Administrador activo para un diseño externo.';
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    status = case when p_action = 'send_to_designer' then 'in_Design' else 'in_Quote' end,
    designer_id = case when p_action = 'send_to_designer' then p_target_user_id else designer_id end,
    quote_id = case when p_action = 'send_to_quote' then p_target_user_id else quote_id end,
    updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
    values (p_order_id, v_actor, 'semi_admin_' || p_action, v_old.status, v_new.status,
      jsonb_build_object('target_user_id', p_target_user_id));
  return v_new;
end $$;

create or replace function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_stage text;
  v_responsible uuid;
  v_can_operate boolean := false;
  v_actions jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_files_ready boolean := false;
  v_candidates jsonb := '{}'::jsonb;
  v_production_candidates jsonb := '{}'::jsonb;
  v_responsibility_history jsonb := '[]'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  v_stage := case
    when v_order.status in ('in_Design', 'In_Design') then 'design'
    when v_order.status = 'in_Quote' then 'quote'
    when v_order.status in ('in_Production', 'in_Termination') then 'production'
    when v_order.status = 'in_Completed' then 'delivery'
    else null end;
  v_responsible := case v_stage when 'design' then v_order.designer_id when 'quote' then v_order.quote_id when 'delivery' then v_order.delivery_id else null end;
  select coalesce(jsonb_object_agg(c.area_code, c.candidates), '{}'::jsonb) into v_production_candidates from (
    select distinct f.production_area_code as area_code,
      coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) order by p.name)
        from public.profiles p join public.production_areas a on a.code = f.production_area_code and a.is_active
        where coalesce(p.employment_status, true) and p.deleted_at is null and p.role in (a.producer_role, 'semi_admin')), '[]'::jsonb) as candidates
    from public.order_production_files f where f.order_id = v_order.id and f.production_area_code is not null
  ) c;
  select jsonb_build_object(
    'design', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) order by p.name) from public.profiles p where coalesce(p.employment_status, true) and p.deleted_at is null and p.role in ('designer', 'semi_admin')), '[]'::jsonb),
    'quote', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) order by p.name) from public.profiles p where coalesce(p.employment_status, true) and p.deleted_at is null and p.role in ('quote', 'semi_admin')), '[]'::jsonb),
    'delivery', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) order by p.name) from public.profiles p where coalesce(p.employment_status, true) and p.deleted_at is null and p.role in ('delivery', 'semi_admin')), '[]'::jsonb),
    'production', v_production_candidates
  ) into v_candidates;
  select coalesce(jsonb_agg(jsonb_build_object('created_at', e.created_at, 'actor_id', e.actor_id, 'changes', e.changes) order by e.created_at desc), '[]'::jsonb) into v_responsibility_history
    from (select created_at, actor_id, changes from public.order_events where order_id = v_order.id and event_type = 'semi_admin_stage_responsibility_changed' order by created_at desc limit 20) e;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' or v_order.status in ('cancelled', 'in_Delivered') then
    return jsonb_build_object('version', v_order.updated_at, 'locked', true, 'active_stage', v_stage, 'responsible_id', v_responsible, 'candidates', v_candidates, 'responsibility_history', v_responsibility_history, 'actions', v_actions, 'unavailable_actions', v_unavailable);
  end if;
  if v_stage = 'production' then
    select exists (select 1 from public.order_production_assignments a where a.order_id = v_order.id and a.assigned_to = v_actor) into v_can_operate;
  elsif v_stage is not null then
    v_can_operate := public.semi_admin_can_operate_stage(p_order_id, v_stage, null);
  end if;

  if v_order.status in ('Pending', 'pending') then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'send_to_designer', 'title', 'Enviar a Diseño'));
    if v_order.order_design_type = 'EXTERNAL_DESING' then v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'send_to_quote', 'title', 'Enviar a Caja')); end if;
  end if;
  if v_stage is not null then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'key', 'stage_responsibility', 'title', 'Gestionar responsable', 'stage', v_stage,
      'responsible_id', v_responsible, 'can_assign_self', v_responsible is distinct from v_actor,
      'can_reassign', true, 'can_operate_current_stage', v_can_operate
    ));
  end if;
  if v_stage = 'design' then
    if v_can_operate then
      v_actions := v_actions || jsonb_build_array(
        jsonb_build_object('key', 'manage_design_assets', 'title', 'Gestionar diseños'),
        jsonb_build_object('key', 'send_design_to_quote', 'title', 'Enviar a Caja'),
        jsonb_build_object('key', 'return_design_to_sales', 'title', 'Regresar a Ventas', 'requires_reason', true)
      );
    else v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'design_operations', 'title', 'Acciones de Diseño', 'next_safe_step', 'Asígnate o pide la reasignación de Diseño para operar esta etapa.')); end if;
  elsif v_stage = 'quote' then
    if v_can_operate then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'register_payment', 'title', 'Registrar pago'));
      if v_order.payment_status = 'Pending_Payment' and v_order.client_id is not null and nullif(trim(v_order.invoice_number), '') is not null then v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'grant_credit', 'title', 'Registrar crédito')); end if;
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'manage_specifications', 'title', 'Configurar archivos'));
      select coalesce(bool_and(f.production_area_code is not null and coalesce(cardinality(f.material_names), 0) > 0 and nullif(trim(f.termination_name), '') is not null), false)
        into v_files_ready from public.order_production_files f where f.order_id = v_order.id;
      if v_order.payment_status in ('pagado', 'parcial', 'credito') and v_files_ready then v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'route_production', 'title', 'Enviar a Producción'));
      else v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'route_production', 'title', 'Enviar a Producción', 'next_safe_step', 'Registra el pago y completa las especificaciones de cada archivo.')); end if;
    else v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'quote_operations', 'title', 'Acciones de Caja', 'next_safe_step', 'Asígnate o pide la reasignación de Caja para operar esta etapa.')); end if;
  elsif v_stage = 'production' then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'reassign_production_file', 'title', 'Reasignar Producción'));
    if exists (select 1 from public.order_production_assignments a where a.order_id = v_order.id and a.assigned_to = v_actor) then v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'manage_production', 'title', 'Registrar avance de Producción')); end if;
  elsif v_stage = 'delivery' then
    if v_can_operate and v_order.payment_status in ('pagado', 'credito') then v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega'));
    elsif not v_can_operate then v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'delivery_operations', 'title', 'Acciones de Entrega', 'next_safe_step', 'Asígnate o pide la reasignación de Entrega para operar esta etapa.')); end if;
  end if;
  return jsonb_build_object('version', v_order.updated_at, 'locked', false, 'active_stage', v_stage, 'responsible_id', v_responsible, 'can_operate_current_stage', v_can_operate, 'candidates', v_candidates, 'responsibility_history', v_responsibility_history, 'actions', v_actions, 'unavailable_actions', v_unavailable);
end $$;

create or replace function public.semi_admin_send_design_to_quote(
  p_order_id uuid, p_quote_id uuid, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_order public.orders; v_new public.orders; v_role text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not public.semi_admin_can_operate_stage(p_order_id, 'design', null) then raise exception 'Asígnate como responsable de Diseño antes de avanzar la orden.'; end if;
  select role into v_role from public.profiles where id = p_quote_id and coalesce(employment_status, true) and deleted_at is null;
  if v_role not in ('quote', 'semi_admin') then raise exception 'Selecciona un responsable activo de Caja.'; end if;
  if nullif(trim(coalesce(v_order.preview_image, '')), '') is null
    or not exists (select 1 from public.order_files f where f.order_id = p_order_id and f.category = 'preview' and f.status = 'uploaded' and f.deleted_at is null)
    or not exists (select 1 from public.order_files f where f.order_id = p_order_id and f.category = 'design' and f.status = 'uploaded' and f.deleted_at is null)
    or exists (select 1 from public.order_production_files f where f.order_id = p_order_id and (nullif(trim(coalesce(f.public_label, '')), '') is null or nullif(trim(coalesce(f.production_area_code, '')), '') is null or coalesce(cardinality(f.material_names), 0) = 0 or nullif(trim(coalesce(f.termination_name, '')), '') is null)) then
    raise exception 'Completa preview, archivo de diseño y especificaciones antes de enviar a Caja.';
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set status = 'in_Quote', quote_id = p_quote_id, return_reason = null, returned_to_designer_at = null, updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes) values(p_order_id, v_actor, 'semi_admin_send_design_to_quote', v_order.status, v_new.status, jsonb_build_object('quote_id', p_quote_id));
  return v_new;
end $$;

create or replace function public.semi_admin_return_design_to_sales(
  p_order_id uuid, p_reason text, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_order public.orders; v_new public.orders;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Indica un motivo de al menos 10 caracteres.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not public.semi_admin_can_operate_stage(p_order_id, 'design', null) then raise exception 'Asígnate como responsable de Diseño antes de devolver la orden.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set status = 'Pending', designer_id = null, return_reason = trim(p_reason), updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes) values(p_order_id, v_actor, 'semi_admin_return_design_to_sales', v_order.status, v_new.status, jsonb_build_object('reason', trim(p_reason), 'previous_designer_id', v_order.designer_id));
  return v_new;
end $$;

create or replace function public.semi_admin_route_order_to_production_v2(
  p_order_id uuid, p_area_assignments jsonb, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_order public.orders; v_area record; v_assignee uuid; v_role text; v_updated public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.status <> 'in_Quote' or coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then raise exception 'La orden no está disponible para enviarse a Producción.'; end if;
  if v_order.payment_status not in ('pagado', 'parcial', 'credito') then raise exception 'La orden requiere pago antes de enviarse a Producción.'; end if;
  if not exists (select 1 from public.order_production_files f where f.order_id = p_order_id) then raise exception 'La orden no tiene archivos de Producción.'; end if;
  if exists (select 1 from public.order_production_files f left join public.production_areas a on a.code = f.production_area_code and a.is_active where f.order_id = p_order_id and (a.code is null or coalesce(cardinality(f.material_names), 0) = 0 or nullif(trim(f.termination_name), '') is null)) then raise exception 'Cada archivo requiere área, materiales y terminación.'; end if;
  for v_area in select distinct a.code, a.label, a.producer_role from public.order_production_files f join public.production_areas a on a.code = f.production_area_code and a.is_active where f.order_id = p_order_id loop
    begin v_assignee := nullif(p_area_assignments ->> v_area.code, '')::uuid; exception when invalid_text_representation then raise exception 'Responsable inválido para %.', v_area.label; end;
    select role into v_role from public.profiles where id = v_assignee and coalesce(employment_status, true) and deleted_at is null;
    if v_role is null or v_role not in (v_area.producer_role, 'semi_admin') then raise exception 'Selecciona un responsable activo para %.', v_area.label; end if;
    insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by) values(p_order_id, v_area.code, v_assignee, v_actor)
      on conflict(order_id, production_area_code) do update set assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = now();
    update public.order_production_files set assigned_to = v_assignee, status = case when status = 'pending' then 'in_production' else status end, started_at = case when status = 'pending' then coalesce(started_at, now()) else started_at end, updated_by = v_actor, updated_at = now() where order_id = p_order_id and production_area_code = v_area.code;
  end loop;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set status = 'in_Production', updated_by = v_actor, updated_at = now() where id = p_order_id returning * into v_updated;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes) values(p_order_id, v_actor, 'semi_admin_production_routed', v_order.status, v_updated.status, jsonb_build_object('area_assignments', p_area_assignments));
  return v_updated;
end $$;

create or replace function public.semi_admin_update_production_file_status_v2(
  p_file_id uuid, p_next_status text, p_expected_updated_at timestamptz, p_delivery_id uuid default null
) returns public.order_production_files language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_last boolean; v_delivery_role text;
begin
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  select * into v_order from public.orders where id = v_file.order_id for update;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not public.semi_admin_can_operate_stage(v_order.id, 'production', v_file.production_area_code) then raise exception 'Responsable de Producción requerido.'; end if;
  if not ((v_file.status = 'in_production' and p_next_status = 'in_termination') or (v_file.status = 'in_termination' and p_next_status in ('in_production', 'completed'))) then raise exception 'Transición de archivo no permitida.'; end if;
  select not exists(select 1 from public.order_production_files f where f.order_id = v_order.id and f.id <> v_file.id and f.status <> 'completed') into v_last;
  if p_next_status = 'completed' and v_last then
    select role into v_delivery_role from public.profiles where id = p_delivery_id and coalesce(employment_status, true) and deleted_at is null;
    if v_delivery_role not in ('delivery', 'semi_admin') then raise exception 'Selecciona un responsable activo de Entrega.'; end if;
    update public.orders set delivery_id = p_delivery_id, updated_by = v_actor, updated_at = now() where id = v_order.id;
  elsif p_delivery_id is not null then raise exception 'Entrega solo se asigna al completar el último archivo.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.order_production_files set status = p_next_status, updated_by = v_actor, updated_at = now() where id = p_file_id returning * into v_file;
  perform public.recalculate_order_production_status(v_order.id);
  insert into public.order_events(order_id, actor_id, event_type, changes) values(v_order.id, v_actor, 'semi_admin_production_file_status', jsonb_build_object('file_id', p_file_id, 'status', p_next_status));
  return v_file;
end $$;

create or replace function public.semi_admin_reassign_file_production_area_v2(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz
) returns public.order_production_files language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_role text;
begin
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  select * into v_order from public.orders where id = v_file.order_id for update;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.status not in ('in_Production', 'in_Termination') or coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' or v_file.status = 'completed' then raise exception 'El archivo no está disponible para reasignación.'; end if;
  if not exists (select 1 from public.production_areas a where a.code = p_new_area_code and a.is_active) then raise exception 'Selecciona un área de Producción activa.'; end if;
  select p.role into v_role from public.profiles p left join public.production_areas a on a.code = p_new_area_code and a.is_active where p.id = p_new_assigned_user_id and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_role is null or (v_role <> 'semi_admin' and not exists(select 1 from public.production_areas a where a.code = p_new_area_code and a.producer_role = v_role and a.is_active)) then raise exception 'Selecciona un responsable activo del área de Producción.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.order_production_files set production_area_code = p_new_area_code, assigned_to = p_new_assigned_user_id, updated_by = v_actor, updated_at = now() where id = p_file_id returning * into v_file;
  insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by) values(v_order.id, p_new_area_code, p_new_assigned_user_id, v_actor) on conflict(order_id, production_area_code) do update set assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = now();
  insert into public.order_events(order_id, actor_id, event_type, changes) values(v_order.id, v_actor, 'semi_admin_production_area_reassigned', jsonb_build_object('file_id', p_file_id, 'area', p_new_area_code, 'assigned_to', p_new_assigned_user_id));
  return v_file;
end $$;

create or replace function public.semi_admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_result public.orders; v_file_result public.order_production_files;
begin
  if p_action = 'update_order' then
    select * into v_order from public.orders where id = p_order_id;
    if not found then raise exception 'La orden no existe.'; end if;
    if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then raise exception 'La orden está archivada o bloqueada.'; end if;
    if v_order.status in ('in_Design', 'In_Design') and not public.semi_admin_can_operate_stage(p_order_id, 'design', null) then
      raise exception 'Asígnate como responsable de Diseño antes de editar esta orden.';
    elsif v_order.status not in ('Pending', 'pending', 'in_Design', 'In_Design') then
      raise exception 'La edición comercial no está disponible en esta etapa.';
    end if;
    select public.semi_admin_update_order(p_order_id, p_expected_updated_at, coalesce(p_payload->'changes', '{}'::jsonb), coalesce(p_payload->'new_production_files', '[]'::jsonb)) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action = 'stage_responsibility' then
    select public.semi_admin_assign_stage_responsibility(p_order_id, p_payload->>'stage', nullif(p_payload->>'assignee_id', '')::uuid, p_expected_updated_at, nullif(p_payload->>'production_area_code', '')) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action in ('send_to_designer', 'send_to_quote') then
    select public.semi_admin_transition_order(p_order_id, p_action, nullif(p_payload->>'target_user_id', '')::uuid, null, p_expected_updated_at) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action = 'send_design_to_quote' then
    select public.semi_admin_send_design_to_quote(p_order_id, nullif(p_payload->>'quote_id', '')::uuid, p_expected_updated_at) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action = 'return_design_to_sales' then
    select public.semi_admin_return_design_to_sales(p_order_id, p_payload->>'reason', p_expected_updated_at) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action in ('set_payment', 'mark_credit', 'route_production', 'production_specifications') then
    if not public.semi_admin_can_operate_stage(p_order_id, 'quote', null) then raise exception 'Asígnate como responsable de Caja antes de operar esta etapa.'; end if;
    if p_action = 'set_payment' then select public.semi_admin_set_order_payment(p_order_id, p_payload->>'payment_status', nullif(p_payload->>'invoice_payment', ''), p_expected_updated_at) into v_result;
    elsif p_action = 'mark_credit' then select public.semi_admin_mark_order_credit(p_order_id, nullif(p_payload->>'due_date', '')::timestamptz, p_expected_updated_at) into v_result;
    elsif p_action = 'route_production' then select public.semi_admin_route_order_to_production_v2(p_order_id, coalesce(p_payload->'area_assignments', '{}'::jsonb), p_expected_updated_at) into v_result;
    else select public.semi_admin_save_order_production_file_specifications(p_order_id, p_expected_updated_at, coalesce(p_payload->'specifications', '[]'::jsonb)) into v_result; end if;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action in ('production_file_status', 'reassign_production_file') then
    select * into v_file from public.order_production_files where id = nullif(p_payload->>'file_id', '')::uuid;
    if not found or v_file.order_id <> p_order_id then raise exception 'El archivo no pertenece a la orden.'; end if;
    if p_action = 'production_file_status' then
      if not public.semi_admin_can_operate_stage(p_order_id, 'production', v_file.production_area_code) then raise exception 'Asígnate como responsable de esta área antes de registrar avances.'; end if;
      select public.semi_admin_update_production_file_status_v2(v_file.id, p_payload->>'next_status', p_expected_updated_at, nullif(p_payload->>'delivery_id', '')::uuid) into v_file_result;
    else
      select public.semi_admin_reassign_file_production_area_v2(v_file.id, p_payload->>'new_area_code', nullif(p_payload->>'new_assigned_user_id', '')::uuid, p_expected_updated_at) into v_file_result;
    end if;
    return jsonb_build_object('file', to_jsonb(v_file_result));
  elsif p_action = 'mark_delivered' then
    if not public.semi_admin_can_operate_stage(p_order_id, 'delivery', null) then raise exception 'Asígnate como responsable de Entrega antes de confirmar la entrega.'; end if;
    select public.semi_admin_mark_order_delivered(p_order_id, nullif(p_payload->>'delivery_note', ''), p_expected_updated_at) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  end if;
  raise exception 'Acción Semi-Administrativa no permitida.';
end $$;

-- These implementation helpers are only reachable through the command gateway.
-- Keeping their direct grants would let a Semi-Administrador bypass the catalog.
revoke all on function public.semi_admin_send_design_to_quote(uuid,uuid,timestamptz), public.semi_admin_return_design_to_sales(uuid,text,timestamptz), public.semi_admin_route_order_to_production_v2(uuid,jsonb,timestamptz), public.semi_admin_update_production_file_status_v2(uuid,text,timestamptz,uuid), public.semi_admin_reassign_file_production_area_v2(uuid,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) from public, anon;
grant execute on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) to authenticated;

revoke execute on function public.semi_admin_transition_order(uuid,text,uuid,text,timestamptz), public.semi_admin_update_order(uuid,timestamptz,jsonb,jsonb), public.semi_admin_cancel_order(uuid,text,timestamptz), public.semi_admin_set_order_archive(uuid,boolean,timestamptz) from authenticated;
revoke execute on function public.semi_admin_set_order_payment(uuid,text,text,timestamptz), public.semi_admin_mark_order_credit(uuid,timestamptz,timestamptz), public.semi_admin_route_order_to_production(uuid,jsonb,timestamptz), public.semi_admin_save_order_production_file_specifications(uuid,timestamptz,jsonb), public.semi_admin_update_production_file_status(uuid,text,timestamptz,uuid), public.semi_admin_reassign_file_production_area(uuid,text,uuid,timestamptz), public.semi_admin_mark_order_delivered(uuid,text,timestamptz), public.semi_admin_assign_stage_responsibility(uuid,text,uuid,timestamptz,text), public.semi_admin_send_order_to_designer(uuid,uuid,timestamptz), public.semi_admin_send_order_to_quote(uuid,uuid,timestamptz) from authenticated;

notify pgrst, 'reload schema';
