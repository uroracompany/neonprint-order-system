-- A creation command already supplies classified production rows. Suppress only
-- the legacy mirror during that command so it cannot create an unclassified
-- duplicate before the command's authoritative insert.
create or replace function public.sync_order_production_files_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.neonprint_skip_legacy_order_file_sync', true) = 'on' then
    return new;
  end if;

  insert into public.order_production_files (order_id, url, filename, status, created_at, updated_at)
  select
    new.id,
    files.url,
    nullif(regexp_replace(split_part(files.url, '?', 1), '^.*/', ''), ''),
    'pending',
    now(),
    now()
  from public._production_file_urls_from_legacy(new.order_file_url::text) as files(url)
  on conflict (order_id, url) do nothing;

  return new;
end;
$$;

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
      select * into v_order from public.orders where id = v_command.order_id;
      return v_order;
    end if;
    raise exception 'ORDER_CREATION_IN_PROGRESS';
  end if;

  v_order_id := coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid());
  insert into public.order_creation_commands(actor_id, idempotency_key, request_hash)
    values (v_actor, p_idempotency_key, v_hash);
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.neonprint_skip_legacy_order_file_sync', 'on', true);
  insert into public.orders(id, client_id, client_name, client_contact, invoice_number, description, material, termination_type, order_type, order_design_type, delivery_date, status, payment_status, seller_id, created_by, order_file_url, preview_image, reference_images, updated_by)
  values (v_order_id, nullif(p_order->>'client_id', '')::uuid, p_order->>'client_name', nullif(p_order->>'client_contact', ''), p_order->>'invoice_number', p_order->>'description', p_order->>'material', nullif(p_order->>'termination_type', ''), p_order->>'order_type', p_order->>'order_design_type', nullif(trim(p_order->>'delivery_date'), ''), 'Pending', 'Pending_Payment', v_seller_id, v_actor, p_order->>'order_file_url', p_order->>'preview_image', coalesce(p_order->'reference_images', '[]'::jsonb), v_actor)
  returning * into v_order;

  for v_file in select value from jsonb_array_elements(p_production_files) loop
    if nullif(trim(v_file->>'url'), '') is null or nullif(trim(v_file->>'public_label'), '') is null or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de produccion invalido';
    end if;

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
    if not found then raise exception 'La reserva del archivo previo no es válida o expiró'; end if;

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
