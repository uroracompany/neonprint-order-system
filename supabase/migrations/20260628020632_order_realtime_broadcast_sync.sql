-- Hybrid order synchronization:
-- private per-user Broadcast is the primary invalidation signal while
-- Postgres Changes remains available as a temporary fallback.

alter table realtime.messages enable row level security;

drop policy if exists order_broadcast_select_own_topic on realtime.messages;
create policy order_broadcast_select_own_topic
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'orders:user:' || (select auth.uid())::text
  );

create or replace function public.order_realtime_recipient_ids(
  p_old public.orders,
  p_new public.orders
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with order_versions as (
    select p_old as order_row
    where (p_old).id is not null
    union all
    select p_new as order_row
    where (p_new).id is not null
  ),
  candidate_recipients as (
    select unnest(public.get_admin_user_ids()) as recipient_id

    union all

    select unnest(array[
      (order_row).created_by,
      (order_row).seller_id,
      (order_row).designer_id,
      (order_row).quote_id,
      (order_row).production_id,
      (order_row).delivery_id
    ]) as recipient_id
    from order_versions

    union all

    select unnest(public.admin_order_edit_production_recipients(order_row)) as recipient_id
    from order_versions

    union all

    select unnest(public.get_role_user_ids('delivery')) as recipient_id
    from order_versions
    where (order_row).status in ('in_Completed', 'in_Delivered')
  )
  select coalesce(array_agg(distinct candidate.recipient_id), array[]::uuid[])
  from candidate_recipients candidate
  join public.profiles profile on profile.id = candidate.recipient_id
  where candidate.recipient_id is not null
    and coalesce(profile.employment_status, true) = true
$$;

create or replace function public.broadcast_order_realtime_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  old_order public.orders;
  new_order public.orders;
  target_order_id uuid;
  changed_at timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    new_order := new;
    target_order_id := new.id;
  elsif tg_op = 'DELETE' then
    old_order := old;
    target_order_id := old.id;
  else
    old_order := old;
    new_order := new;
    target_order_id := new.id;
  end if;

  foreach recipient_id in array public.order_realtime_recipient_ids(old_order, new_order)
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'order_id', target_order_id,
          'operation', tg_op,
          'changed_at', changed_at
        ),
        'order_changed',
        'orders:user:' || recipient_id::text,
        true
      );
    exception
      when others then
        raise warning 'Could not broadcast order % change to user %: %', target_order_id, recipient_id, sqlerrm;
    end;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_broadcast_order_realtime_change on public.orders;
create trigger trg_broadcast_order_realtime_change
  after insert or update on public.orders
  for each row
  execute function public.broadcast_order_realtime_change();

-- BEFORE DELETE keeps production assignment rows available while recipients
-- are calculated; the message itself is emitted only if the delete commits.
drop trigger if exists trg_broadcast_order_realtime_delete on public.orders;
create trigger trg_broadcast_order_realtime_delete
  before delete on public.orders
  for each row
  execute function public.broadcast_order_realtime_change();

revoke all on function public.order_realtime_recipient_ids(public.orders, public.orders) from public;
revoke all on function public.order_realtime_recipient_ids(public.orders, public.orders) from anon;
revoke all on function public.order_realtime_recipient_ids(public.orders, public.orders) from authenticated;
revoke all on function public.broadcast_order_realtime_change() from public;
revoke all on function public.broadcast_order_realtime_change() from anon;
revoke all on function public.broadcast_order_realtime_change() from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;
