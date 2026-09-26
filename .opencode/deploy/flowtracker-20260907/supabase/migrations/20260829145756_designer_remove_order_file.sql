-- A designer may detach a design asset only while responsible for an active
-- Design-stage order.  Storage cleanup remains asynchronous through the
-- existing durable outbox; this RPC never exposes a direct Storage delete.

-- Canonical Supabase refs became the normal browser contract after the upload
-- gateway was hardened.  Keep the administrative queue compatible with those
-- refs as well as the existing legacy public URL and R2 representations.
create or replace function public.enqueue_admin_order_asset_deletion(
  p_order_id uuid,
  p_url text,
  p_default_bucket text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_parts text[];
  v_bucket text;
  v_object_path text;
  v_catalog_file public.order_files;
begin
  if v_url is null then
    return;
  end if;
  if p_default_bucket not in ('order-docs', 'order-previews', 'payment-invoice') then
    raise exception 'Bucket de orden no permitido.';
  end if;

  select f.* into v_catalog_file
  from public.order_files f
  where f.order_id = p_order_id
    and f.deleted_at is null
    and (
      ('r2://' || f.bucket || '/' || f.object_key) = v_url
      or (
        f.provider = 'supabase'
        and f.bucket = p_default_bucket
        and (
          ('supabase://' || f.bucket || '/' || f.object_key) = v_url
          or f.object_key = regexp_replace(
            v_url,
            '^https?://[^/]+/storage/v1/object/[^/]+/[^/]+/([^?]+).*$','\1'
          )
        )
      )
    )
  limit 1
  for update;

  if found then
    insert into public.order_asset_deletion_outbox(order_id, provider, bucket, target_kind, object_path)
    values (p_order_id, v_catalog_file.provider, v_catalog_file.bucket, 'object', v_catalog_file.object_key)
    on conflict (provider, bucket, target_kind, object_path) do nothing;

    update public.order_files
    set deleted_at = now(), status = 'deleted'
    where id = v_catalog_file.id;
    return;
  end if;

  -- Legacy public URLs are accepted only when they point inside this order's
  -- known prefix and match the expected bucket for the removed field.
  v_parts := regexp_match(
    v_url,
    '^https?://[^/]+/storage/v1/object/[^/]+/([^/]+)/([^?]+)'
  );
  if v_parts is null then
    return;
  end if;
  v_bucket := v_parts[1];
  v_object_path := v_parts[2];
  if v_bucket <> p_default_bucket
     or not (
       (v_bucket in ('order-docs', 'order-previews') and v_object_path like ('orders/' || p_order_id::text || '/%'))
       or (v_bucket = 'payment-invoice' and v_object_path like (p_order_id::text || '/%'))
     ) then
    raise exception 'El archivo retirado no pertenece a esta orden.';
  end if;

  insert into public.order_asset_deletion_outbox(order_id, provider, bucket, target_kind, object_path)
  values (p_order_id, 'supabase', v_bucket, 'object', v_object_path)
  on conflict (provider, bucket, target_kind, object_path) do nothing;
end;
$$;

revoke all on function public.enqueue_admin_order_asset_deletion(uuid, text, text) from public, anon, authenticated;

create or replace function public.designer_remove_order_file(
  p_order_id uuid,
  p_file_id uuid,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_file public.order_production_files%rowtype;
  v_catalog_file public.order_files%rowtype;
  v_file_urls jsonb;
  v_remaining_urls jsonb;
  v_url_count integer;
  v_updated public.orders%rowtype;
begin
  if p_order_id is null or p_file_id is null or p_expected_updated_at is null then
    raise exception 'ORDER_STALE';
  end if;

  if v_actor is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'designer'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Solo Diseno activo puede retirar archivos.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_order.designer_id is distinct from v_actor
     or v_order.status <> 'in_Design'
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_designer, false) then
    raise exception 'La orden no esta disponible en Diseno.';
  end if;

  select * into v_file
  from public.order_production_files
  where id = p_file_id
    and order_id = p_order_id
  for update;
  if not found then
    raise exception 'El archivo no pertenece a esta orden.';
  end if;

  v_file_urls := case
    when nullif(trim(coalesce(v_order.order_file_url, '')), '') is null then '[]'::jsonb
    when left(trim(v_order.order_file_url), 1) = '[' then v_order.order_file_url::jsonb
    else jsonb_build_array(v_order.order_file_url)
  end;
  if jsonb_typeof(v_file_urls) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(v_file_urls) item
       where jsonb_typeof(item) <> 'string'
     ) then
    raise exception 'Los archivos actuales de la orden no son validos.';
  end if;

  select count(*) into v_url_count
  from jsonb_array_elements_text(v_file_urls) item(value)
  where item.value = v_file.url;
  if v_url_count <> 1 then
    raise exception 'El archivo no esta asociado de forma valida a la orden.';
  end if;

  select f.* into v_catalog_file
  from public.order_files f
  where f.order_id = p_order_id
    and f.deleted_at is null
    and (
      f.id = v_file.order_file_id
      or ('r2://' || f.bucket || '/' || f.object_key) = v_file.url
      or (f.provider = 'supabase' and ('supabase://' || f.bucket || '/' || f.object_key) = v_file.url)
    )
  limit 1
  for update;
  if not found
     or v_catalog_file.bucket <> 'order-docs'
     or v_catalog_file.object_key not like ('orders/' || p_order_id::text || '/%') then
    raise exception 'El archivo no tiene un registro seguro de almacenamiento.';
  end if;

  -- The queue locks and marks the exact catalog entry before either relation is
  -- changed, so an error rolls back all three layers together.
  perform public.enqueue_admin_order_asset_deletion(p_order_id, v_file.url, 'order-docs');

  select coalesce(jsonb_agg(to_jsonb(item.value)), '[]'::jsonb) into v_remaining_urls
  from jsonb_array_elements_text(v_file_urls) item(value)
  where item.value <> v_file.url;

  perform set_config('app.neonprint_order_command', 'on', true);
  delete from public.order_production_files where id = v_file.id and order_id = p_order_id;

  update public.orders
  set order_file_url = v_remaining_urls::text,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  insert into public.order_events(
    order_id, actor_id, event_type, old_status, new_status,
    old_payment_status, new_payment_status, changes
  ) values (
    p_order_id, v_actor, 'designer_file_removed', v_order.status, v_updated.status,
    v_order.payment_status, v_updated.payment_status,
    jsonb_build_object('file_id', v_file.id, 'filename', v_file.filename, 'url', v_file.url)
  );

  return v_updated;
end;
$$;

revoke all on function public.designer_remove_order_file(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.designer_remove_order_file(uuid, uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
