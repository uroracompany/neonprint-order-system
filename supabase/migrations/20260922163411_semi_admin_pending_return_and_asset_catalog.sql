-- Allow a responsible Semi-Admin to return an ordinary pending quote order
-- when its audited route into Caja is known. A paid -> pending correction is
-- still captured and tied to the return when that correction exists.

create or replace function public.semi_admin_return_quote_to_previous_stage(
  p_order_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_new public.orders;
  v_payment_event public.order_events;
  v_route_event public.order_events;
  v_target_status text;
  v_target_stage text;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Indica un motivo de al menos 10 caracteres.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' or v_order.status = 'cancelled' then
    raise exception 'La orden no está disponible.';
  end if;
  if v_order.status <> 'in_Quote' or v_order.payment_status <> 'Pending_Payment' then
    raise exception 'La orden debe estar en Caja con pago pendiente.';
  end if;
  if v_order.designer_id is distinct from v_actor
     and v_order.quote_id is distinct from v_actor
     and v_order.seller_id is distinct from v_actor
     and v_order.created_by is distinct from v_actor then
    raise exception 'No tienes acceso operativo a esta orden.';
  end if;

  -- This event is optional for ordinary pending orders, but if it exists the
  -- route back must not precede the audited paid -> pending correction.
  select * into v_payment_event
  from public.order_events
  where order_id = v_order.id
    and event_type = 'semi_admin_payment_updated'
    and old_payment_status = 'pagado'
    and new_payment_status = 'Pending_Payment'
    and changes->>'correction' = 'paid_to_pending_in_quote'
  order by created_at desc
  limit 1;

  if v_order.order_design_type = 'EXTERNAL_DESING' then
    select * into v_route_event
    from public.order_events
    where order_id = v_order.id
      and event_type = 'semi_admin_send_to_quote'
      and old_status = 'Pending'
      and new_status = 'in_Quote'
      and created_at <= coalesce(v_payment_event.created_at, now())
    order by created_at desc
    limit 1;
    v_target_status := 'Pending';
    v_target_stage := 'sales';
  elsif v_order.order_design_type = 'INTERNAL_DESING' then
    select * into v_route_event
    from public.order_events
    where order_id = v_order.id
      and event_type = 'semi_admin_send_design_to_quote'
      and old_status in ('in_Design', 'In_Design')
      and new_status = 'in_Quote'
      and created_at <= coalesce(v_payment_event.created_at, now())
    order by created_at desc
    limit 1;
    v_target_status := 'in_Design';
    v_target_stage := 'design';
  else
    raise exception 'El tipo de diseño de la orden no permite determinar un retorno seguro.';
  end if;

  if v_route_event.id is null then
    raise exception 'No existe una transición auditada válida hacia Caja para devolver esta orden.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = v_target_status,
      quote_id = null,
      return_reason = trim(p_reason),
      updated_at = now(),
      updated_by = v_actor
  where id = v_order.id
  returning * into v_new;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes)
  values (
    v_order.id,
    v_actor,
    'semi_admin_return_quote_to_previous_stage',
    v_order.status,
    v_new.status,
    v_order.payment_status,
    v_new.payment_status,
    jsonb_build_object(
      'reason', trim(p_reason),
      'target_stage', v_target_stage,
      'design_type', v_order.order_design_type,
      'payment_correction_event_id', v_payment_event.id,
      'source_route_event_id', v_route_event.id
    )
  );

  return v_new;
end;
$$;

revoke all on function public.semi_admin_return_quote_to_previous_stage(uuid, text, timestamptz) from public, anon;
grant execute on function public.semi_admin_return_quote_to_previous_stage(uuid, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
