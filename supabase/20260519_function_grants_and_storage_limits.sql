-- Follow-up hardening for function execution grants and storage limits.

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_profile_is_admin() from public;
revoke all on function public.get_role_user_ids(text) from public;
revoke all on function public.get_admin_user_ids() from public;
revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from public;
revoke all on function public.set_order_update_metadata() from public;
revoke all on function public.handle_order_change_notification() from public;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_is_admin() to authenticated;
grant execute on function public.get_role_user_ids(text) to authenticated;
grant execute on function public.get_admin_user_ids() to authenticated;

create index if not exists idx_orders_updated_by on public.orders(updated_by);

create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_order_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  nid uuid;
  caller uuid := auth.uid();
begin
  if caller is null or p_user_id is distinct from caller then
    raise exception 'Cannot create notifications for another user';
  end if;

  select id into nid
  from public.notifications
  where user_id = p_user_id
    and type = p_type
    and order_id is not distinct from p_order_id
    and title = p_title
    and message = p_message
    and created_at > now() - interval '10 minutes'
  order by created_at desc
  limit 1;

  if nid is null then
    insert into public.notifications (user_id, type, title, message, order_id, metadata)
    values (p_user_id, p_type, p_title, p_message, p_order_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into nid;
  end if;

  return nid;
end;
$$;

revoke all on function public.create_notification(uuid, text, text, text, uuid, jsonb) from public;
grant execute on function public.create_notification(uuid, text, text, text, uuid, jsonb) to authenticated;

create or replace function public.can_manage_order_asset_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.orders o
    where o.id::text = (storage.foldername(object_name))[2]
      and (
        public.current_profile_is_admin()
        or auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
      )
  );
$$;

revoke all on function public.can_manage_order_asset_path(text) from public;
grant execute on function public.can_manage_order_asset_path(text) to authenticated;

update storage.buckets
set
  file_size_limit = 52428800,
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

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'application/pdf'
  ]
where id = 'order-previews';

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
where id = 'payment-invoice';

drop policy if exists order_assets_select_authenticated on storage.objects;
drop policy if exists order_assets_insert_authenticated on storage.objects;
drop policy if exists order_assets_update_authenticated on storage.objects;
drop policy if exists order_assets_delete_authenticated on storage.objects;

create policy order_assets_select_authenticated
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('order-docs', 'order-previews')
    and (
      public.current_profile_is_admin()
      or public.can_manage_order_asset_path(name)
    )
  );

create policy order_assets_insert_authenticated
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('order-docs', 'order-previews')
    and (
      public.current_profile_is_admin()
      or public.can_manage_order_asset_path(name)
    )
  );

create policy order_assets_update_authenticated
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('order-docs', 'order-previews')
    and (
      public.current_profile_is_admin()
      or public.can_manage_order_asset_path(name)
    )
  )
  with check (
    bucket_id in ('order-docs', 'order-previews')
    and (
      public.current_profile_is_admin()
      or public.can_manage_order_asset_path(name)
    )
  );

create policy order_assets_delete_authenticated
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('order-docs', 'order-previews')
    and (
      public.current_profile_is_admin()
      or public.can_manage_order_asset_path(name)
    )
  );
