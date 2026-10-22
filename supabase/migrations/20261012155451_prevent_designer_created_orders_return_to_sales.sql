-- Prevent a Designer from returning an order they created to Sales.
-- Sales-assigned orders keep the existing Design -> Sales correction flow.
create or replace function public.designer_return_order_to_sales(
  p_order_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_sales_recipient uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'designer'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Solo el diseñador activo asignado puede devolver la orden a Ventas.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica un motivo para devolver la orden.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_order.order_design_type <> 'INTERNAL_DESING'
     or v_order.status <> 'in_Design'
     or v_order.designer_id is distinct from v_actor
     or coalesce(v_order.is_archived, false)
     or v_order.operational_status = 'blocked' then
    raise exception 'La orden no está disponible para devolver a Ventas.';
  end if;

  -- An order created by Design belongs to that Design workflow and must not
  -- be sent back to Sales. Orders created by Sales remain eligible.
  if v_order.created_by is not distinct from v_actor then
    raise exception 'Las órdenes creadas por Diseño no pueden devolverse a Ventas.';
  end if;

  -- Resolve exactly one current Sales owner before clearing the Design owner.
  -- seller_id takes precedence; created_by is the safe fallback only when it
  -- is an active Sales profile.
  select p.id into v_sales_recipient
  from public.profiles p
  where p.id = v_order.seller_id
    and p.role = 'seller'
    and coalesce(p.employment_status, true)
    and p.deleted_at is null;

  if v_sales_recipient is null then
    select p.id into v_sales_recipient
    from public.profiles p
    where p.id = v_order.created_by
      and p.role = 'seller'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null;
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
     set status = 'Pending', designer_id = null, return_reason = btrim(p_reason),
         updated_at = now(), updated_by = v_actor
   where id = p_order_id
   returning * into v_updated;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
  values (p_order_id, v_actor, 'designer_returned_to_sales', v_order.status, v_updated.status,
    jsonb_build_object('reason', btrim(p_reason), 'previous_designer_id', v_actor));

  -- The generic status fan-out is suppressed below only for this strict
  -- transition. This is the sole durable notice and has one Sales recipient.
  if v_sales_recipient is not null and v_sales_recipient is distinct from v_actor then
    perform public.notify_many(
      array[v_sales_recipient],
      'order_returned',
      'Orden devuelta desde Diseño',
      'La orden #' || substring(p_order_id::text, 1, 8) || ' fue devuelta a Ventas. Motivo: ' || btrim(p_reason),
      p_order_id,
      jsonb_build_object(
        'event_kind', 'designer_returned_to_sales',
        'variant', 'warning',
        'return_reason', btrim(p_reason),
        'previous_designer_id', v_actor,
        'recipient_id', v_sales_recipient,
        'status', v_updated.status
      )
    );
  end if;

  return v_updated;
end;
$$;

revoke all on function public.designer_return_order_to_sales(uuid, text, timestamptz) from public, anon;
grant execute on function public.designer_return_order_to_sales(uuid, text, timestamptz) to authenticated;
notify pgrst, 'reload schema';
