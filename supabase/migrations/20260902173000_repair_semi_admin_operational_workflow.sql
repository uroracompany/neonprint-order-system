-- Semi-Administrator operational workflow repair.
-- This is intentionally a restricted coordination surface, not an Admin alias.

create or replace function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_actions jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_files_ready boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' or v_order.status in ('cancelled', 'in_Delivered') then
    return jsonb_build_object('actions', v_actions, 'unavailable_actions', v_unavailable, 'locked', true);
  end if;

  if v_order.status in ('Pending', 'pending') then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'send_to_designer', 'title', 'Enviar a Diseño'));
    if v_order.order_design_type = 'EXTERNAL_DESING' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'send_to_quote', 'title', 'Enviar a Caja'));
    end if;
  end if;

  if v_order.status = 'in_Quote' then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'register_payment', 'title', 'Registrar pago'));
    if v_order.payment_status = 'Pending_Payment' and v_order.client_id is not null and nullif(trim(v_order.invoice_number), '') is not null then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'grant_credit', 'title', 'Registrar crédito'));
    end if;

    select coalesce(bool_and(
      f.production_area_code is not null
      and coalesce(cardinality(f.material_names), 0) > 0
      and nullif(trim(f.termination_name), '') is not null
    ), false)
    into v_files_ready
    from public.order_production_files f where f.order_id = v_order.id;

    if v_order.payment_status in ('pagado', 'parcial', 'credito') and v_files_ready then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'route_production', 'title', 'Enviar a Producción'));
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'route_production',
        'title', 'Enviar a Producción',
        'next_safe_step', case
          when v_order.payment_status not in ('pagado', 'parcial', 'credito') then 'Registra un pago, pago parcial o crédito antes de enviar a Producción.'
          else 'Completa área, materiales y terminación de cada archivo antes de enviar a Producción.'
        end
      ));
    end if;
  end if;

  if v_order.status in ('Pending', 'pending', 'in_Design', 'In_Design', 'in_Quote') then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'manage_specifications', 'title', 'Configurar archivos'));
  end if;
  if v_order.status in ('in_Production', 'in_Termination') then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'manage_production', 'title', 'Coordinar Producción'));
  end if;
  if v_order.status = 'in_Completed' and v_order.payment_status in ('pagado', 'credito') and v_order.delivery_id is not null then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega'));
  elsif v_order.status = 'in_Completed' then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega', 'next_safe_step', 'La orden requiere pago confirmado o crédito y un Delivery activo asignado.'));
  end if;

  return jsonb_build_object('actions', v_actions, 'unavailable_actions', v_unavailable, 'locked', false);
end;
$$;

create or replace function public.semi_admin_route_order_to_production(
  p_order_id uuid,
  p_area_assignments jsonb,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_area record;
  v_assignee uuid;
  v_extra_area text;
  v_updated public.orders;
begin
  if p_expected_updated_at is null or jsonb_typeof(coalesce(p_area_assignments, '{}'::jsonb)) <> 'object' then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' or v_order.status <> 'in_Quote' then raise exception 'La orden no está disponible para enviarse a Producción.'; end if;
  if v_order.payment_status not in ('pagado', 'parcial', 'credito') then raise exception 'La orden requiere pago, pago parcial o crédito antes de enviarse a Producción.'; end if;
  if not exists (select 1 from public.order_production_files where order_id = v_order.id) then raise exception 'La orden no tiene archivos de Producción.'; end if;
  if exists (
    select 1 from public.order_production_files f
    left join public.production_areas a on a.code = f.production_area_code and a.is_active
    where f.order_id = v_order.id
      and (f.production_area_code is null or a.code is null or coalesce(cardinality(f.material_names), 0) = 0 or nullif(trim(f.termination_name), '') is null)
  ) then raise exception 'Cada archivo requiere un área activa, materiales y terminación antes de enviarse a Producción.'; end if;

  select key into v_extra_area
  from jsonb_object_keys(p_area_assignments) as provided(key)
  where not exists (
    select 1 from public.order_production_files f where f.order_id = v_order.id and f.production_area_code = provided.key
  ) limit 1;
  if v_extra_area is not null then raise exception 'El área % no participa en esta orden.', v_extra_area; end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  for v_area in
    select distinct a.code, a.label, a.producer_role
    from public.order_production_files f join public.production_areas a on a.code = f.production_area_code and a.is_active
    where f.order_id = v_order.id order by a.code
  loop
    if not (p_area_assignments ? v_area.code) then raise exception 'Debes asignar un responsable para el área %.', v_area.label; end if;
    begin v_assignee := nullif(trim(p_area_assignments ->> v_area.code), '')::uuid;
    exception when invalid_text_representation then raise exception 'El responsable del área % no es válido.', v_area.label;
    end;
    if v_assignee is null or not exists (
      select 1 from public.profiles p where p.id = v_assignee and p.role = v_area.producer_role
        and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then raise exception 'Debes seleccionar un responsable activo para el área %.', v_area.label; end if;
    insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by)
      values(v_order.id, v_area.code, v_assignee, v_actor)
      on conflict(order_id, production_area_code) do update set assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = now();
    update public.order_production_files
      set assigned_to = v_assignee, status = case when status = 'pending' then 'in_production' else status end,
          started_at = case when status = 'pending' then coalesce(started_at, now()) else started_at end,
          updated_by = v_actor, updated_at = now()
      where order_id = v_order.id and production_area_code = v_area.code;
    perform public.notify_many(array[v_assignee], 'order_assigned', 'Nueva orden de Producción',
      'La orden #' || left(v_order.id::text, 8) || ' fue asignada a tu área de ' || v_area.label || '.', v_order.id,
      jsonb_build_object('event_kind', 'production_assigned', 'production_area_code', v_area.code, 'assigned_by', v_actor));
  end loop;
  delete from public.order_production_assignments a where a.order_id = v_order.id and not exists (
    select 1 from public.order_production_files f where f.order_id = a.order_id and f.production_area_code = a.production_area_code
  );
  update public.orders set status = 'in_Production', updated_at = now(), updated_by = v_actor where id = v_order.id returning * into v_updated;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
    values(v_order.id, v_actor, 'semi_admin_production_routed', v_order.status, v_updated.status, jsonb_build_object('area_assignments', p_area_assignments));
  perform public.notify_many(array[v_actor], 'info', 'Orden enviada a Producción', 'Se registraron las asignaciones operativas de la orden.', v_order.id, jsonb_build_object('event_kind', 'semi_admin_confirmation'));
  return v_updated;
end;
$$;

create or replace function public.semi_admin_reassign_file_production_area(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz
)
returns public.order_production_files
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_role text;
begin
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  select * into v_order from public.orders where id = v_file.order_id for update;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived,false) or v_order.operational_status = 'blocked' or v_order.status not in ('in_Production','in_Termination') then raise exception 'La reasignación solo está disponible durante Producción.'; end if;
  if v_file.status = 'completed' then raise exception 'No se puede reasignar un archivo completado.'; end if;
  select p.role into v_role from public.profiles p join public.production_areas a on a.code = p_new_area_code and a.producer_role = p.role and a.is_active
    where p.id = p_new_assigned_user_id and coalesce(p.employment_status,true) and p.deleted_at is null;
  if v_role is null then raise exception 'Selecciona un operador activo del área de Producción.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.order_production_files set production_area_code = p_new_area_code, assigned_to = p_new_assigned_user_id, updated_by = v_actor, updated_at = now() where id = p_file_id returning * into v_file;
  insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by)
    values(v_order.id, p_new_area_code, p_new_assigned_user_id, v_actor)
    on conflict(order_id, production_area_code) do update set assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = now();
  update public.order_production_files set assigned_to = p_new_assigned_user_id, updated_by = v_actor, updated_at = now()
    where order_id = v_order.id and production_area_code = p_new_area_code and status <> 'completed';
  delete from public.order_production_assignments a where a.order_id = v_order.id and not exists (
    select 1 from public.order_production_files f where f.order_id = a.order_id and f.production_area_code = a.production_area_code
  );
  insert into public.order_events(order_id,actor_id,event_type,changes) values(v_order.id,v_actor,'semi_admin_production_area_reassigned',jsonb_build_object('file_id',p_file_id,'area',p_new_area_code,'assigned_to',p_new_assigned_user_id));
  perform public.notify_many(array[p_new_assigned_user_id], 'order_updated', 'Área de Producción asignada', 'Tienes archivos activos asignados en una orden de Producción.', v_order.id, jsonb_build_object('event_kind','production_reassigned','assigned_by',v_actor));
  return v_file;
end $$;

create or replace function public.semi_admin_update_production_file_status(
  p_file_id uuid, p_next_status text, p_expected_updated_at timestamptz, p_delivery_id uuid default null
)
returns public.order_production_files
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_is_last boolean; v_handoff public.delivery_rework_handoffs;
begin
  select * into v_file from public.order_production_files where id=p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  select * into v_order from public.orders where id=v_file.order_id for update;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived,false) or v_order.operational_status = 'blocked' or v_order.status not in ('in_Production','in_Termination') then raise exception 'La orden no está disponible para esta operación de Producción.'; end if;
  if not ((v_file.status='in_production' and p_next_status='in_termination') or (v_file.status='in_termination' and p_next_status in ('in_production','completed'))) then raise exception 'Transición de archivo no permitida.'; end if;
  if p_next_status = 'completed' then
    select not exists(select 1 from public.order_production_files where order_id=v_order.id and id<>v_file.id and status<>'completed') into v_is_last;
    if v_is_last then
      select * into v_handoff from public.delivery_rework_handoffs where order_id=v_order.id and returned_to_delivery_at is null for update;
      if p_delivery_id is null or not exists(select 1 from public.profiles where id=p_delivery_id and role='delivery' and coalesce(employment_status,true) and deleted_at is null) then raise exception 'Selecciona un Delivery activo para completar el último archivo.'; end if;
      if v_handoff.id is not null and p_delivery_id is distinct from v_handoff.returning_delivery_id then raise exception 'Esta orden devuelta debe regresar al Delivery que la devolvió.'; end if;
    elsif p_delivery_id is not null then raise exception 'Delivery solo se asigna al completar el último archivo.'; end if;
  elsif p_delivery_id is not null then raise exception 'Delivery solo se asigna al completar el último archivo.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  if v_is_last then update public.orders set delivery_id=p_delivery_id, updated_at=now(), updated_by=v_actor where id=v_order.id; end if;
  update public.order_production_files set status=p_next_status, updated_by=v_actor, updated_at=now() where id=p_file_id returning * into v_file;
  perform public.recalculate_order_production_status(v_order.id);
  if v_is_last and v_handoff.id is not null then
    update public.delivery_rework_handoffs set returned_to_delivery_at=now(), returned_to_delivery_by=v_actor where id=v_handoff.id and returned_to_delivery_at is null;
  end if;
  insert into public.order_events(order_id,actor_id,event_type,changes) values(v_order.id,v_actor,'semi_admin_production_file_status',jsonb_build_object('file_id',p_file_id,'status',p_next_status));
  return v_file;
end $$;

create or replace function public.semi_admin_mark_order_delivered(
  p_order_id uuid, p_delivery_note text, p_expected_updated_at timestamptz
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders;
begin
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status='blocked' or v_old.status<>'in_Completed' or v_old.payment_status not in ('pagado','credito') then raise exception 'La orden no es elegible para entrega.'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_old.delivery_id and p.role='delivery' and coalesce(p.employment_status,true) and p.deleted_at is null) then raise exception 'La orden requiere un Delivery activo asignado antes de confirmarse.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Delivered', delivery_note=coalesce(nullif(trim(p_delivery_note),''),delivery_note), updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id,actor_id,event_type,old_status,new_status,changes) values(p_order_id,v_actor,'semi_admin_order_delivered',v_old.status,v_new.status,jsonb_build_object('delivery_id',v_old.delivery_id));
  return v_new;
end $$;

revoke all on function public.semi_admin_get_order_command_catalog(uuid), public.semi_admin_route_order_to_production(uuid,jsonb,timestamptz) from public, anon;
grant execute on function public.semi_admin_get_order_command_catalog(uuid), public.semi_admin_route_order_to_production(uuid,jsonb,timestamptz) to authenticated;

notify pgrst, 'reload schema';
