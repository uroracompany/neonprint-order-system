-- Production-readiness release, additive phase.  Apply this migration to an
-- isolated branch first.  It intentionally does not delete objects or make a
-- bucket private: those restrictions are the final promotion gate once the
-- signed-upload/download clients have passed role tests.

alter table public.order_files
  add column if not exists customer_visible boolean not null default false;

alter table public.order_files
  drop constraint if exists order_files_customer_visible_preview_only;
alter table public.order_files
  add constraint order_files_customer_visible_preview_only
  check (not customer_visible or category = 'preview');

create index if not exists idx_order_files_customer_visible_preview
  on public.order_files(order_id, updated_at desc)
  where customer_visible = true
    and category = 'preview'
    and status = 'uploaded'
    and deleted_at is null;

-- The browser no longer needs anonymous tracking RPCs.  The Vercel tracking
-- handler executes this narrow function with the service credential and emits
-- only the returned JSON shape.
create or replace function public.get_public_order_tracking(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'status', o.status,
      'payment_status', o.payment_status,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'delivery_date', o.delivery_date,
      'order_type', o.order_type,
      'order_design_type', o.order_design_type,
      'cancellation_reason', o.cancellation_reason
    ),
    'events', coalesce(events.items, '[]'::jsonb)
  )
  from public.orders o
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'new_status', e.new_status,
      'created_at', e.created_at
    ) order by e.created_at) as items
    from public.order_events e
    where e.order_id = o.id and e.new_status is not null
  ) events on true
  where o.tracking_token = case
    when p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_token::uuid
    else null
  end
  limit 1;
$$;

revoke all on function public.get_public_order_tracking(text) from public, anon, authenticated;
grant execute on function public.get_public_order_tracking(text) to service_role;

revoke all on function public.get_order_tracking(text) from public, anon;
revoke all on function public.get_order_tracking_events(text) from public, anon;

-- A pre-order upload cannot use order_files because its foreign key order does
-- not exist yet.  Reserve each object before a signed upload URL is emitted;
-- the creation command consumes exactly that reservation in the same
-- idempotent transaction that creates the order and manifest rows.
create table if not exists public.order_asset_preupload_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  provider text not null check (provider in ('supabase', 'r2')),
  bucket text not null,
  object_key text not null,
  original_filename text,
  content_type text,
  size_bytes bigint,
  category text not null check (category in ('design', 'preview', 'reference')),
  status text not null default 'reserved' check (status in ('reserved', 'bound', 'expired')),
  expires_at timestamptz not null,
  bound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, bucket, object_key)
);

create index if not exists idx_order_asset_preupload_reservations_actor_order
  on public.order_asset_preupload_reservations(actor_id, order_id, idempotency_key)
  where status = 'reserved';

alter table public.order_asset_preupload_reservations enable row level security;
revoke all on public.order_asset_preupload_reservations from public, anon, authenticated;
grant select, insert, update on public.order_asset_preupload_reservations to service_role;

-- This is the latest active creation contract with the provider made explicit.
-- Preallocated Supabase uploads and R2 uploads are both inserted atomically
-- with their order; arbitrary buckets and paths remain invalid.
create or replace function public.create_seller_order_with_assets(
  p_idempotency_key uuid,
  p_order jsonb,
  p_production_files jsonb default '[]'::jsonb,
  p_asset_refs jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_seller_id uuid;
  v_hash text;
  v_command public.order_creation_commands%rowtype;
  v_order public.orders%rowtype;
  v_file jsonb;
  v_asset jsonb;
  v_order_id uuid;
  v_provider text;
  v_reservation public.order_asset_preupload_reservations%rowtype;
begin
  select p.role into v_role from public.profiles p
  where p.id = v_actor and p.role in ('seller', 'admin')
    and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_role is null then raise exception 'Solo Ventas o Administracion activa puede crear ordenes'; end if;
  if p_idempotency_key is null
    or jsonb_typeof(coalesce(p_order, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_production_files, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_asset_refs, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de creacion invalida';
  end if;
  v_seller_id := case when v_role = 'seller' then v_actor else null end;
  v_hash := md5(coalesce(p_order, '{}'::jsonb)::text || coalesce(p_production_files, '[]'::jsonb)::text || coalesce(p_asset_refs, '[]'::jsonb)::text);
  select * into v_command from public.order_creation_commands
    where actor_id = v_actor and idempotency_key = p_idempotency_key for update;
  if found then
    if v_command.request_hash <> v_hash then raise exception 'ORDER_IDEMPOTENCY_CONFLICT'; end if;
    if v_command.status = 'completed' and v_command.order_id is not null then
      select * into v_order from public.orders where id = v_command.order_id; return v_order;
    end if;
    raise exception 'ORDER_CREATION_IN_PROGRESS';
  end if;
  v_order_id := coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid());
  insert into public.order_creation_commands(actor_id, idempotency_key, request_hash)
    values (v_actor, p_idempotency_key, v_hash);
  perform set_config('app.neonprint_order_command', 'on', true);
  insert into public.orders(id, client_id, client_name, client_contact, invoice_number, description, material, termination_type, order_type, order_design_type, delivery_date, status, payment_status, seller_id, created_by, order_file_url, preview_image, reference_images, updated_by)
  values (v_order_id, nullif(p_order->>'client_id', '')::uuid, p_order->>'client_name', nullif(p_order->>'client_contact', ''), p_order->>'invoice_number', p_order->>'description', p_order->>'material', nullif(p_order->>'termination_type', ''), p_order->>'order_type', p_order->>'order_design_type', nullif(trim(p_order->>'delivery_date'), ''), 'Pending', 'Pending_Payment', v_seller_id, v_actor, p_order->>'order_file_url', p_order->>'preview_image', coalesce(p_order->'reference_images', '[]'::jsonb), v_actor)
  returning * into v_order;
  for v_file in select value from jsonb_array_elements(p_production_files) loop
    if nullif(trim(v_file->>'url'), '') is null or nullif(trim(v_file->>'public_label'), '') is null or nullif(trim(v_file->>'production_area_code'), '') is null then raise exception 'Archivo de produccion invalido'; end if;
    insert into public.order_production_files(order_id, url, filename, public_label, production_area_code, status, created_by, updated_by)
    values(v_order_id, trim(v_file->>'url'), coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'), trim(v_file->>'public_label'), trim(v_file->>'production_area_code'), 'pending', v_actor, v_actor);
  end loop;
  for v_asset in select value from jsonb_array_elements(p_asset_refs) loop
    v_provider := coalesce(nullif(trim(v_asset->>'provider'), ''), 'r2');
    if v_provider not in ('supabase', 'r2')
      or nullif(trim(coalesce(v_asset->>'bucket', '')), '') is null
      or nullif(trim(coalesce(v_asset->>'objectKey', '')), '') is null
      or (v_asset->>'objectKey') !~ ('^orders/' || v_order_id::text || '/')
      or coalesce(v_asset->>'category', '') not in ('design', 'preview', 'reference')
      or (v_provider = 'supabase' and v_asset->>'bucket' not in ('order-docs', 'order-previews')) then
      raise exception 'Referencia de archivo previo invalida';
    end if;
    select * into v_reservation
    from public.order_asset_preupload_reservations
    where id = nullif(v_asset->>'reservationId', '')::uuid
      and actor_id = v_actor
      and order_id = v_order_id
      and idempotency_key = p_idempotency_key
      and provider = v_provider
      and bucket = trim(v_asset->>'bucket')
      and object_key = trim(v_asset->>'objectKey')
      and category = v_asset->>'category'
      and status = 'reserved'
      and expires_at > now()
    for update;
    if not found then
      raise exception 'La reserva del archivo previo no es válida o expiró';
    end if;
    insert into public.order_files(order_id, provider, bucket, object_key, original_filename, content_type, size_bytes, category, status, uploaded_by)
    values(v_order_id, v_provider, trim(v_asset->>'bucket'), trim(v_asset->>'objectKey'), nullif(trim(v_asset->>'originalFilename'), ''), nullif(trim(v_asset->>'contentType'), ''), nullif(v_asset->>'sizeBytes', '')::bigint, v_asset->>'category', 'uploaded', v_actor)
    on conflict(provider, bucket, object_key) do nothing;
    update public.order_asset_preupload_reservations
    set status = 'bound', bound_at = now()
    where id = v_reservation.id;
  end loop;
  update public.order_creation_commands set order_id = v_order_id, status = 'completed', updated_at = now()
    where actor_id = v_actor and idempotency_key = p_idempotency_key;
  return v_order;
end;
$$;

revoke all on function public.create_seller_order_with_assets(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_seller_order_with_assets(uuid, jsonb, jsonb, jsonb) to authenticated;

-- The application reaches these protected records through command RPCs or the
-- server gateway.  Keep SELECT/RLS policies for legitimate reads, but prevent
-- a browser from bypassing audit/version checks with direct writes.
revoke insert, update, delete on table public.orders from anon, authenticated;
revoke insert, update, delete on table public.order_files from anon, authenticated;
revoke insert, update, delete on table public.order_production_files from anon, authenticated;

-- Each cleanup worker receives an opaque lease.  The worker must present this
-- claim token when it marks a deletion complete or schedules a retry, so an
-- expired invocation cannot overwrite the result of a later claimant.
alter table public.order_asset_deletion_outbox
  add column if not exists claim_token uuid,
  add column if not exists claim_expires_at timestamptz;

create index if not exists idx_order_asset_deletion_outbox_processing_lease
  on public.order_asset_deletion_outbox(claim_expires_at)
  where status = 'processing';

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

  update public.order_asset_deletion_outbox
  set status = 'pending', locked_at = null, claim_token = null, claim_expires_at = null, next_attempt_at = now()
  where status = 'processing'
    and claim_expires_at < now();

  return query
  with candidates as (
    select id
    from public.order_asset_deletion_outbox
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.order_asset_deletion_outbox queued
  set status = 'processing',
      attempts = queued.attempts + 1,
      locked_at = now(),
      claim_token = gen_random_uuid(),
      claim_expires_at = now() + interval '30 minutes'
  from candidates
  where queued.id = candidates.id
  returning queued.*;
end;
$$;

revoke all on function public.claim_order_asset_deletion_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_order_asset_deletion_outbox(integer) to service_role;
