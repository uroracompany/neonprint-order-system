-- Preserve file deletion work independently from orders so direct DELETE operations
-- cannot orphan Storage or R2 objects after their metadata cascades away.
create table if not exists public.order_asset_deletion_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  provider text not null,
  bucket text not null,
  target_kind text not null default 'object',
  object_path text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint order_asset_deletion_outbox_provider_check check (provider in ('supabase', 'r2')),
  constraint order_asset_deletion_outbox_target_kind_check check (target_kind in ('object', 'prefix')),
  constraint order_asset_deletion_outbox_status_check check (status in ('pending', 'processing', 'completed')),
  constraint order_asset_deletion_outbox_attempts_check check (attempts >= 0),
  constraint order_asset_deletion_outbox_unique_target unique (provider, bucket, target_kind, object_path),
  constraint order_asset_deletion_outbox_r2_object_only check (provider <> 'r2' or target_kind = 'object')
);

create index if not exists idx_order_asset_deletion_outbox_pending
  on public.order_asset_deletion_outbox(next_attempt_at, created_at)
  where status = 'pending';

create index if not exists idx_order_asset_deletion_outbox_order_id
  on public.order_asset_deletion_outbox(order_id);

alter table public.order_asset_deletion_outbox enable row level security;
revoke all on public.order_asset_deletion_outbox from public, anon, authenticated;
grant select, insert, update on public.order_asset_deletion_outbox to service_role;

create table if not exists public.order_asset_reconciliation_cursors (
  provider text not null,
  bucket text not null,
  cursor text,
  updated_at timestamptz not null default now(),
  primary key (provider, bucket),
  constraint order_asset_reconciliation_cursor_provider_check check (provider in ('supabase', 'r2'))
);

alter table public.order_asset_reconciliation_cursors enable row level security;
revoke all on public.order_asset_reconciliation_cursors from public, anon, authenticated;
grant select, insert, update on public.order_asset_reconciliation_cursors to service_role;

create or replace function public.list_order_storage_assets(
  p_bucket text,
  p_after_name text default null,
  p_limit integer default 250
)
returns table (object_path text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if p_bucket not in ('order-docs', 'order-previews', 'payment-invoice') then
    raise exception 'Bucket de orden no permitido.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'El limite debe estar entre 1 y 1000.';
  end if;

  return query
  select stored_object.name, stored_object.created_at
  from storage.objects stored_object
  where stored_object.bucket_id = p_bucket
    and stored_object.name > coalesce(p_after_name, '')
    and (
      (p_bucket in ('order-docs', 'order-previews') and stored_object.name ~ '^orders/[0-9a-fA-F-]{36}/')
      or (p_bucket = 'payment-invoice' and stored_object.name ~ '^[0-9a-fA-F-]{36}/')
    )
  order by stored_object.name asc
  limit p_limit;
end;
$$;

create or replace function public.enqueue_order_asset_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Exact records cover R2 and every nonstandard Storage path registered by the app.
  insert into public.order_asset_deletion_outbox (order_id, provider, bucket, target_kind, object_path)
  select old.id, file.provider, file.bucket, 'object', file.object_key
  from public.order_files file
  where file.order_id = old.id
    and nullif(trim(file.object_key), '') is not null
  on conflict (provider, bucket, target_kind, object_path) do nothing;

  -- Prefix jobs also cover legacy Supabase assets from before the canonical catalog.
  insert into public.order_asset_deletion_outbox (order_id, provider, bucket, target_kind, object_path)
  values
    (old.id, 'supabase', 'order-docs', 'prefix', format('orders/%s/files', old.id)),
    (old.id, 'supabase', 'order-docs', 'prefix', format('orders/%s/ref-images', old.id)),
    (old.id, 'supabase', 'order-previews', 'prefix', format('orders/%s/preview', old.id)),
    (old.id, 'supabase', 'payment-invoice', 'prefix', old.id::text)
  on conflict (provider, bucket, target_kind, object_path) do nothing;

  return old;
end;
$$;

drop trigger if exists trg_enqueue_order_asset_deletion on public.orders;
create trigger trg_enqueue_order_asset_deletion
  before delete on public.orders
  for each row
  execute function public.enqueue_order_asset_deletion();

create or replace function public.claim_order_asset_deletion_outbox(p_limit integer default 50)
returns setof public.order_asset_deletion_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'El limite de limpieza debe estar entre 1 y 100.';
  end if;

  -- Recover work whose previous server invocation ended unexpectedly.
  update public.order_asset_deletion_outbox
  set status = 'pending', locked_at = null, next_attempt_at = now()
  where status = 'processing'
    and locked_at < now() - interval '30 minutes';

  return query
  with candidates as (
    select id
    from public.order_asset_deletion_outbox
    where status = 'pending'
      and next_attempt_at <= now()
    order by next_attempt_at asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.order_asset_deletion_outbox queued
  set status = 'processing',
      attempts = queued.attempts + 1,
      locked_at = now()
  from candidates
  where queued.id = candidates.id
  returning queued.*;
end;
$$;

revoke all on function public.enqueue_order_asset_deletion() from public, anon, authenticated;
revoke all on function public.claim_order_asset_deletion_outbox(integer) from public, anon, authenticated;
revoke all on function public.list_order_storage_assets(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_order_asset_deletion_outbox(integer) to service_role;
grant execute on function public.list_order_storage_assets(text, text, integer) to service_role;
