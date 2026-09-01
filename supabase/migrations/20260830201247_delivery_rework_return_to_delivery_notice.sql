-- A completed Delivery -> Production rework cycle remains auditable after it
-- returns to Delivery. This acknowledgement belongs to the handoff, not to a
-- notification row, so reading or archiving a notification cannot hide it.
alter table public.delivery_rework_handoffs
  add column if not exists delivery_opened_at timestamptz;

create index if not exists delivery_rework_handoffs_unopened_delivery_return_idx
  on public.delivery_rework_handoffs(returning_delivery_id, returned_to_delivery_at desc)
  where returned_to_delivery_at is not null and delivery_opened_at is null;

-- The transition is performed by the production status RPC. Emit exactly one
-- directed notification when that RPC closes a rework handoff; no other
-- Delivery user is a recipient.
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

drop trigger if exists delivery_rework_returned_to_delivery_notification on public.delivery_rework_handoffs;
create trigger delivery_rework_returned_to_delivery_notification
after update of returned_to_delivery_at on public.delivery_rework_handoffs
for each row
when (old.returned_to_delivery_at is null and new.returned_to_delivery_at is not null)
execute function public.notify_delivery_rework_returned_to_delivery();

-- Delivery can read only its own still-unopened return badges, and only for
-- orders that remain assigned to that same Delivery user.
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
  select h.order_id, h.id, h.returned_to_delivery_at
  from public.delivery_rework_handoffs h
  join public.orders o on o.id = h.order_id
  where h.order_id = any(p_order_ids)
    and h.returning_delivery_id = v_actor
    and h.returned_to_delivery_at is not null
    and h.delivery_opened_at is null
    and o.delivery_id = v_actor;
end;
$$;

-- Opening the order details acknowledges the badge only. Notifications remain
-- untouched, including their read, archive and deletion history.
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

  -- Lock first so two simultaneous detail opens cannot race.  The original
  -- Delivery user receives success both before and after acknowledgement;
  -- this keeps the UI operation idempotent without touching notifications.
  select h.*
  into v_handoff
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

  if v_handoff.delivery_opened_at is null then
    update public.delivery_rework_handoffs
    set delivery_opened_at = now()
    where id = v_handoff.id;
  end if;

  return true;
end;
$$;

revoke all on function public.get_pending_delivery_rework_return_badges(uuid[]) from public, anon;
revoke all on function public.acknowledge_delivery_rework_return(uuid) from public, anon;
grant execute on function public.get_pending_delivery_rework_return_badges(uuid[]) to authenticated;
grant execute on function public.acknowledge_delivery_rework_return(uuid) to authenticated;
