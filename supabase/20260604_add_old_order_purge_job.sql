-- Automatic retention cleanup for orders older than 3 months.
-- The Edge Function deletes Storage first, then calls the database purge
-- function so rows are only removed after associated files are gone.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.order_purge_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  order_created_at timestamptz not null,
  client_name text,
  status text,
  payment_status text,
  order_events_count integer not null default 0,
  notifications_count integer not null default 0,
  storage_files_deleted integer not null default 0,
  storage_errors jsonb not null default '[]'::jsonb,
  purge_status text not null default 'purged',
  purged_at timestamptz not null default now(),
  constraint order_purge_audit_status_check
    check (purge_status in ('purged', 'skipped_storage_error', 'failed'))
);

create index if not exists idx_orders_created_at
  on public.orders (created_at);

create index if not exists idx_order_purge_audit_order_id
  on public.order_purge_audit (order_id);

create index if not exists idx_order_purge_audit_purged_at
  on public.order_purge_audit (purged_at desc);

alter table public.order_purge_audit enable row level security;

drop policy if exists order_purge_audit_select_admin on public.order_purge_audit;
create policy order_purge_audit_select_admin
  on public.order_purge_audit for select
  to authenticated
  using (public.current_profile_is_admin());

revoke all on public.order_purge_audit from public;
grant select on public.order_purge_audit to authenticated;
grant select, insert, update on public.order_purge_audit to service_role;

create or replace function public.get_old_orders_for_purge(
  p_cutoff timestamptz default now() - interval '3 months',
  p_limit integer default 100
) returns table (
  order_id uuid,
  order_created_at timestamptz,
  client_name text,
  status text,
  payment_status text,
  order_events_count integer,
  notifications_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.created_at,
    o.client_name,
    o.status,
    o.payment_status,
    (
      select count(*)::integer
      from public.order_events e
      where e.order_id = o.id
    ) as order_events_count,
    (
      select count(*)::integer
      from public.notifications n
      where n.order_id = o.id
    ) as notifications_count
  from public.orders o
  where o.created_at < p_cutoff
    and not exists (
      select 1
      from public.order_purge_audit a
      where a.order_id = o.id
        and a.purge_status = 'purged'
    )
  order by o.created_at asc
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
$$;

revoke all on function public.get_old_orders_for_purge(timestamptz, integer) from public;
revoke all on function public.get_old_orders_for_purge(timestamptz, integer) from anon;
revoke all on function public.get_old_orders_for_purge(timestamptz, integer) from authenticated;
grant execute on function public.get_old_orders_for_purge(timestamptz, integer) to service_role;

create or replace function public.purge_old_orders_batch(
  p_cutoff timestamptz default now() - interval '3 months',
  p_limit integer default 100
) returns table (
  order_id uuid,
  order_created_at timestamptz,
  client_name text,
  status text,
  payment_status text,
  order_events_count integer,
  notifications_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.get_old_orders_for_purge(p_cutoff, p_limit);
$$;

comment on function public.purge_old_orders_batch(timestamptz, integer)
  is 'Returns old-order purge candidates. Storage cleanup must succeed before purge_old_order_after_storage deletes rows.';

revoke all on function public.purge_old_orders_batch(timestamptz, integer) from public;
revoke all on function public.purge_old_orders_batch(timestamptz, integer) from anon;
revoke all on function public.purge_old_orders_batch(timestamptz, integer) from authenticated;
grant execute on function public.purge_old_orders_batch(timestamptz, integer) to service_role;

create or replace function public.log_old_order_purge_storage_error(
  p_order_id uuid,
  p_storage_files_deleted integer default 0,
  p_storage_errors jsonb default '[]'::jsonb
) returns public.order_purge_audit
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders%rowtype;
  audit_row public.order_purge_audit%rowtype;
begin
  select *
  into target_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Order % was not found', p_order_id;
  end if;

  insert into public.order_purge_audit (
    order_id,
    order_created_at,
    client_name,
    status,
    payment_status,
    order_events_count,
    notifications_count,
    storage_files_deleted,
    storage_errors,
    purge_status
  )
  values (
    target_order.id,
    target_order.created_at,
    target_order.client_name,
    target_order.status,
    target_order.payment_status,
    (select count(*)::integer from public.order_events e where e.order_id = target_order.id),
    (select count(*)::integer from public.notifications n where n.order_id = target_order.id),
    greatest(coalesce(p_storage_files_deleted, 0), 0),
    coalesce(p_storage_errors, '[]'::jsonb),
    'skipped_storage_error'
  )
  returning * into audit_row;

  return audit_row;
end;
$$;

revoke all on function public.log_old_order_purge_storage_error(uuid, integer, jsonb) from public;
revoke all on function public.log_old_order_purge_storage_error(uuid, integer, jsonb) from anon;
revoke all on function public.log_old_order_purge_storage_error(uuid, integer, jsonb) from authenticated;
grant execute on function public.log_old_order_purge_storage_error(uuid, integer, jsonb) to service_role;

create or replace function public.purge_old_order_after_storage(
  p_order_id uuid,
  p_cutoff timestamptz default now() - interval '3 months',
  p_storage_files_deleted integer default 0
) returns public.order_purge_audit
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders%rowtype;
  audit_row public.order_purge_audit%rowtype;
  event_count integer;
  notification_count integer;
begin
  select *
  into target_order
  from public.orders
  where id = p_order_id
    and created_at < p_cutoff
  for update;

  if not found then
    raise exception 'Order % is not eligible for purge', p_order_id;
  end if;

  select count(*)::integer
  into event_count
  from public.order_events
  where order_id = target_order.id;

  select count(*)::integer
  into notification_count
  from public.notifications
  where order_id = target_order.id;

  insert into public.order_purge_audit (
    order_id,
    order_created_at,
    client_name,
    status,
    payment_status,
    order_events_count,
    notifications_count,
    storage_files_deleted,
    storage_errors,
    purge_status
  )
  values (
    target_order.id,
    target_order.created_at,
    target_order.client_name,
    target_order.status,
    target_order.payment_status,
    event_count,
    notification_count,
    greatest(coalesce(p_storage_files_deleted, 0), 0),
    '[]'::jsonb,
    'purged'
  )
  returning * into audit_row;

  delete from public.notifications
  where order_id = target_order.id;

  delete from public.orders
  where id = target_order.id;

  if exists (select 1 from public.order_events where order_id = target_order.id) then
    raise exception 'Orphaned order_events remain for order %', target_order.id;
  end if;

  if exists (select 1 from public.notifications where order_id = target_order.id) then
    raise exception 'Orphaned notifications remain for order %', target_order.id;
  end if;

  return audit_row;
end;
$$;

revoke all on function public.purge_old_order_after_storage(uuid, timestamptz, integer) from public;
revoke all on function public.purge_old_order_after_storage(uuid, timestamptz, integer) from anon;
revoke all on function public.purge_old_order_after_storage(uuid, timestamptz, integer) from authenticated;
grant execute on function public.purge_old_order_after_storage(uuid, timestamptz, integer) to service_role;

-- Foreign-key inventory to run before enabling the job in production:
-- select
--   conrelid::regclass as dependent_table,
--   conname as constraint_name,
--   pg_get_constraintdef(oid) as constraint_definition
-- from pg_constraint
-- where contype = 'f'
--   and confrelid = 'public.orders'::regclass
-- order by dependent_table::text, constraint_name;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'purge-old-orders-daily'
  ) then
    perform cron.unschedule('purge-old-orders-daily');
  end if;
end $$;

select cron.schedule(
  'purge-old-orders-daily',
  '0 3 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-old-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'order_purge_cron_token')
      ),
      body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now())
    ) as request_id;
  $$
);
