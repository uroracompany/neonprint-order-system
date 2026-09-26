-- A Semi-Administrador may assign itself when entering Diseño, while normal
-- sellers remain limited to active native designers. This replaces only the
-- target-role condition and preserves locking, optimistic concurrency, audit,
-- status transitions and existing function privileges.

create or replace function public.semi_admin_transition_order(
  p_order_id uuid, p_action text, p_target_user_id uuid default null,
  p_reason text default null, p_expected_updated_at timestamptz default null
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders; v_target_role text;
begin
  if p_action not in ('send_to_designer','send_to_quote','cancel','archive') then
    raise exception 'Acción de orden no permitida.';
  end if;
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if p_action in ('send_to_designer','send_to_quote') then
    select role into v_target_role from public.profiles where id=p_target_user_id and coalesce(employment_status,true) and deleted_at is null;
    if p_action='send_to_designer' and (v_target_role is null or v_target_role not in ('designer','semi_admin') or (v_target_role='semi_admin' and p_target_user_id is distinct from v_actor)) then
      raise exception 'Selecciona un Diseñador activo o asígnate a ti mismo.';
    end if;
    if p_action='send_to_quote' and v_target_role is distinct from 'quote' then raise exception 'Selecciona un usuario de Caja activo.'; end if;
  end if;
  if p_action='send_to_designer' and v_old.status not in ('Pending','pending') then raise exception 'La orden debe estar en Ventas antes de enviarse a Diseño.'; end if;
  if p_action='send_to_quote' and (v_old.status not in ('Pending','pending') or v_old.order_design_type <> 'EXTERNAL_DESING') then raise exception 'La orden no es elegible para enviarse a Caja.'; end if;
  if p_action='cancel' and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Debes indicar el motivo de cancelación.'; end if;
  if p_action='cancel' and v_old.payment_status in ('parcial','pagado','credito') then raise exception 'La orden no puede cancelarse con pago confirmado.'; end if;
  if p_action='archive' and (v_old.payment_status='parcial' or v_old.status not in ('cancelled','in_Completed','in_Delivered')) then raise exception 'La orden no puede archivarse.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set
    status=case when p_action='send_to_designer' then 'in_Design' when p_action='send_to_quote' then 'in_Quote' when p_action='cancel' then 'cancelled' else status end,
    designer_id=case when p_action='send_to_designer' then p_target_user_id else designer_id end,
    quote_id=case when p_action='send_to_quote' then p_target_user_id else quote_id end,
    cancellation_reason=case when p_action='cancel' then trim(p_reason) else cancellation_reason end,
    is_archived=case when p_action='archive' then true else is_archived end,
    updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
    values (p_order_id,v_actor,'semi_admin_'||p_action,v_old.status,v_new.status,jsonb_build_object('target_user_id',p_target_user_id,'reason',p_reason,'self_assigned',p_target_user_id=v_actor));
  return v_new;
end $$;

revoke all on function public.semi_admin_transition_order(uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.semi_admin_transition_order(uuid,text,uuid,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
