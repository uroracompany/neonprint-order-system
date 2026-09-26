-- Canonical file catalog for hybrid Supabase Storage + Cloudflare R2.
-- Keeps legacy URL columns working while new flows can use provider/object metadata.

create table if not exists public.order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  bucket text not null,
  object_key text not null,
  original_filename text,
  content_type text,
  size_bytes bigint,
  checksum text,
  category text not null default 'design',
  status text not null default 'pending',
  uploaded_by uuid references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_files_provider_check check (provider in ('supabase', 'r2')),
  constraint order_files_category_check check (category in ('design', 'preview', 'reference', 'payment', 'production')),
  constraint order_files_status_check check (status in ('pending', 'uploading', 'uploaded', 'failed', 'deleted')),
  constraint order_files_size_nonnegative_check check (size_bytes is null or size_bytes >= 0),
  constraint order_files_unique_object unique (provider, bucket, object_key)
);

create index if not exists idx_order_files_order_id
  on public.order_files(order_id);
create index if not exists idx_order_files_provider
  on public.order_files(provider);
create index if not exists idx_order_files_status
  on public.order_files(status);
create index if not exists idx_order_files_created_at
  on public.order_files(created_at desc);
create index if not exists idx_order_files_active_order
  on public.order_files(order_id)
  where deleted_at is null;

alter table public.order_files enable row level security;

grant select, insert, update, delete on public.order_files to authenticated;
grant select, insert, update, delete on public.order_files to service_role;

drop policy if exists order_files_select_by_order_access on public.order_files;
create policy order_files_select_by_order_access
  on public.order_files for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_files.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
          or public.producer_can_access_order(o.id)
          or (public.current_profile_role() = 'delivery' and o.status in ('in_Completed', 'in_Delivered'))
        )
    )
  );

drop policy if exists order_files_insert_by_order_access on public.order_files;
create policy order_files_insert_by_order_access
  on public.order_files for insert
  to authenticated
  with check (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_files.order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  );

drop policy if exists order_files_update_by_order_access on public.order_files;
create policy order_files_update_by_order_access
  on public.order_files for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or uploaded_by = auth.uid()
    or exists (
      select 1
      from public.orders o
      where o.id = order_files.order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  )
  with check (
    public.current_profile_is_admin()
    or uploaded_by = auth.uid()
    or exists (
      select 1
      from public.orders o
      where o.id = order_files.order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  );

drop policy if exists order_files_delete_admin_only on public.order_files;
create policy order_files_delete_admin_only
  on public.order_files for delete
  to authenticated
  using (public.current_profile_is_admin());

create or replace function public.touch_order_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_order_file on public.order_files;
create trigger trg_touch_order_file
  before update on public.order_files
  for each row
  execute function public.touch_order_file();

revoke all on function public.touch_order_file() from public, anon, authenticated;

alter table public.order_production_files
  add column if not exists order_file_id uuid references public.order_files(id) on delete set null;

create index if not exists idx_order_production_files_order_file_id
  on public.order_production_files(order_file_id);

create table if not exists public.order_delete_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  deleted_by uuid references public.profiles(id),
  order_created_at timestamptz,
  client_name text,
  files_deleted integer not null default 0,
  storage_errors jsonb not null default '[]'::jsonb,
  delete_status text not null default 'deleted',
  deleted_at timestamptz not null default now(),
  constraint order_delete_audit_status_check
    check (delete_status in ('deleted', 'skipped_storage_error', 'failed'))
);

create index if not exists idx_order_delete_audit_order_id
  on public.order_delete_audit(order_id);
create index if not exists idx_order_delete_audit_deleted_at
  on public.order_delete_audit(deleted_at desc);

alter table public.order_delete_audit enable row level security;

revoke all on public.order_delete_audit from public;
grant select on public.order_delete_audit to authenticated;
grant select, insert, update on public.order_delete_audit to service_role;

drop policy if exists order_delete_audit_select_admin on public.order_delete_audit;
create policy order_delete_audit_select_admin
  on public.order_delete_audit for select
  to authenticated
  using (public.current_profile_is_admin());

-- Stabilize the current Supabase bucket drift observed in production.
update storage.buckets
set
  file_size_limit = 209715200,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'image/tiff',
    'application/pdf',
    'application/postscript',
    'application/illustrator',
    'application/vnd.adobe.illustrator',
    'image/vnd.adobe.photoshop',
    'image/x-photoshop',
    'application/vnd.adobe.photoshop',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.rar',
    'application/x-rar-compressed',
    'application/octet-stream'
  ]
where id = 'order-docs';
