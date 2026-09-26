-- `order_returned` is part of the notifications type check and preserves the
-- established Delivery rework presentation; the event kind distinguishes this
-- return-to-Delivery notification from the original Delivery -> Production one.
create or replace function public.notify_delivery_rework_returned_to_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.returned_to_delivery_at is null and new.returned_to_delivery_at is not null then
    perform public.notify_many(
      array[new.returning_delivery_id],
      'order_returned',
      'Orden regresada de Producción',
      'La orden regresó de Producción y está disponible nuevamente para revisión.',
      new.order_id,
      jsonb_build_object(
        'event_kind', 'delivery_rework_returned_to_delivery',
        'handoff_id', new.id,
        'order_id', new.order_id,
        'deep_link', '/delivery?order=' || new.order_id::text
      )
    );
  end if;
  return new;
end;
$$;

-- Acknowledgement is idempotent. Locking the handoff serializes simultaneous
-- detail openings and guarantees that a later notification mutation cannot
-- affect the badge acknowledgement.
create or replace function public.acknowledge_delivery_rework_return(
  p_order_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_handoff public.delivery_rework_handoffs%rowtype;
begin
  if v_actor is null or p_order_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'delivery'
      and p.deleted_at is null
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'No tienes acceso a los reingresos de Delivery.';
  end if;

  select h.* into v_handoff
  from public.delivery_rework_handoffs h
  join public.orders o on o.id = h.order_id
  where h.order_id = p_order_id
    and o.delivery_id = v_actor
    and h.returning_delivery_id = v_actor
    and h.returned_to_delivery_at is not null
  order by h.returned_to_delivery_at desc
  limit 1
  for update of h;

  if not found then
    return false;
  end if;

  update public.delivery_rework_handoffs
  set delivery_opened_at = coalesce(delivery_opened_at, now())
  where id = v_handoff.id;

  return true;
end;
$$;

-- A rework can be returned more than once over its history.  The inbox needs
-- one badge per order, always representing the latest unopened return.
create or replace function public.get_pending_delivery_rework_return_badges(
  p_order_ids uuid[]
) returns table (
  order_id uuid,
  handoff_id uuid,
  returned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_order_ids is null or cardinality(p_order_ids) = 0 then
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'delivery'
      and p.deleted_at is null
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'No tienes acceso a los reingresos de Delivery.';
  end if;

  return query
  select distinct on (h.order_id) h.order_id, h.id, h.returned_to_delivery_at
  from public.delivery_rework_handoffs h
  join public.orders o on o.id = h.order_id
  where h.order_id = any(p_order_ids)
    and h.returning_delivery_id = v_actor
    and h.returned_to_delivery_at is not null
    and h.delivery_opened_at is null
    and o.delivery_id = v_actor
  order by h.order_id, h.returned_to_delivery_at desc;
end;
$$;
