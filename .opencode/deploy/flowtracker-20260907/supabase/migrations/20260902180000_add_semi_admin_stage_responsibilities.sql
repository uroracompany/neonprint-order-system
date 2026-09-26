-- Independent responsibility assignment for each operational stage.
-- Production deliberately remains per participating production area.

create or replace function public.semi_admin_assign_stage_responsibility(
  p_order_id uuid,
  p_stage text,
  p_assignee_id uuid,
  p_expected_updated_at timestamptz,
  p_production_area_code text default null
)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_assignee_role text;
  v_previous uuid;
  v_area text := nullif(trim(p_production_area_code), '');
begin
  if p_stage not in ('design','quote','production','delivery') then raise exception 'Etapa inválida.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived,false) or v_order.operational_status='blocked' or v_order.status in ('cancelled','in_Delivered') then raise exception 'La orden no está disponible para reasignación.'; end if;
  select role into v_assignee_role from public.profiles where id=p_assignee_id and coalesce(employment_status,true) and deleted_at is null;
  if v_assignee_role is null then raise exception 'Selecciona un usuario activo.'; end if;

  if p_stage='design' then
    if v_order.status not in ('in_Design','In_Design') then raise exception 'La responsabilidad de Diseño solo se asigna durante Diseño.'; end if;
    if v_assignee_role not in ('designer','semi_admin') then raise exception 'Diseño requiere un Diseñador o Semi-Administrador.'; end if;
    v_previous := v_order.designer_id;
    update public.orders set designer_id=p_assignee_id, updated_by=v_actor, updated_at=now() where id=v_order.id returning * into v_order;
  elsif p_stage='quote' then
    if v_order.status <> 'in_Quote' then raise exception 'La responsabilidad de Caja solo se asigna durante Caja.'; end if;
    if v_assignee_role not in ('quote','semi_admin') then raise exception 'Caja requiere un usuario de Caja o Semi-Administrador.'; end if;
    v_previous := v_order.quote_id;
    update public.orders set quote_id=p_assignee_id, updated_by=v_actor, updated_at=now() where id=v_order.id returning * into v_order;
  elsif p_stage='delivery' then
    if v_order.status <> 'in_Completed' then raise exception 'La responsabilidad de Entrega solo se asigna cuando la orden está completada.'; end if;
    if v_assignee_role not in ('delivery','semi_admin') then raise exception 'Entrega requiere un Delivery o Semi-Administrador.'; end if;
    v_previous := v_order.delivery_id;
    update public.orders set delivery_id=p_assignee_id, updated_by=v_actor, updated_at=now() where id=v_order.id returning * into v_order;
  else
    if v_order.status not in ('in_Production','in_Termination') or v_area is null then raise exception 'Indica un área participante de Producción.'; end if;
    if not exists(select 1 from public.order_production_files where order_id=v_order.id and production_area_code=v_area) then raise exception 'El área no participa en esta orden.'; end if;
    if v_assignee_role <> 'semi_admin' and not exists(select 1 from public.production_areas where code=v_area and producer_role=v_assignee_role and is_active) then raise exception 'El responsable no pertenece al área seleccionada.'; end if;
    select assigned_to into v_previous from public.order_production_assignments where order_id=v_order.id and production_area_code=v_area for update;
    update public.order_production_assignments set assigned_to=p_assignee_id, assigned_by=v_actor, updated_at=now() where order_id=v_order.id and production_area_code=v_area;
    if not found then insert into public.order_production_assignments(order_id,production_area_code,assigned_to,assigned_by) values(v_order.id,v_area,p_assignee_id,v_actor); end if;
    update public.order_production_files set assigned_to=p_assignee_id, updated_by=v_actor, updated_at=now() where order_id=v_order.id and production_area_code=v_area and status <> 'completed';
    update public.orders set updated_by=v_actor, updated_at=now() where id=v_order.id returning * into v_order;
  end if;

  insert into public.order_events(order_id,actor_id,event_type,changes) values(v_order.id,v_actor,'semi_admin_stage_responsibility_changed',jsonb_build_object('stage',p_stage,'production_area_code',v_area,'previous_responsible_id',v_previous,'responsible_id',p_assignee_id,'self_assigned',p_assignee_id=v_actor));
  perform public.notify_many(array_remove(array[p_assignee_id],v_actor),'order_assigned','Responsabilidad de etapa asignada','Se te asignó la responsabilidad de ' || case p_stage when 'design' then 'Diseño' when 'quote' then 'Caja' when 'delivery' then 'Entrega' else 'Producción ('||v_area||')' end || '.',v_order.id,jsonb_build_object('event_kind','stage_responsibility_assigned','stage',p_stage,'production_area_code',v_area,'assigned_by',v_actor));
  return v_order;
end $$;

-- Semi-Admin may close a delivery only when it was explicitly assigned to that stage.
create or replace function public.semi_admin_mark_order_delivered(p_order_id uuid,p_delivery_note text,p_expected_updated_at timestamptz)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders;
begin
  select * into v_old from public.orders where id=p_order_id for update;
  if not found or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status='blocked' or v_old.status<>'in_Completed' or v_old.payment_status not in ('pagado','credito') then raise exception 'La orden no es elegible para entrega.'; end if;
  if v_old.delivery_id is distinct from v_actor then raise exception 'Asígnate como responsable de Entrega antes de confirmar la entrega.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Delivered',delivery_note=coalesce(nullif(trim(p_delivery_note),''),delivery_note),updated_at=now(),updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id,actor_id,event_type,old_status,new_status,changes) values(p_order_id,v_actor,'semi_admin_order_delivered',v_old.status,v_new.status,jsonb_build_object('delivery_id',v_old.delivery_id));
  return v_new;
end $$;

revoke all on function public.semi_admin_assign_stage_responsibility(uuid,text,uuid,timestamptz,text) from public,anon;
grant execute on function public.semi_admin_assign_stage_responsibility(uuid,text,uuid,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
