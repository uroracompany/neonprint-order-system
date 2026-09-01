-- Restore the established Administration creation capability without reopening
-- direct table writes.  Ownership is always derived from the authenticated
-- active profile; only a seller receives an initial seller assignment.
create or replace function public.create_seller_order_with_assets(
  p_idempotency_key uuid,
  p_order jsonb,
  p_production_files jsonb default '[]'::jsonb,
  p_asset_refs jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
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
begin
  select p.role into v_role
  from public.profiles p
  where p.id = v_actor
    and p.role in ('seller', 'admin')
    and coalesce(p.employment_status, true)
    and p.deleted_at is null;

  if v_role is null then
    raise exception 'Solo Ventas o Administracion activa puede crear ordenes';
  end if;

  if p_idempotency_key is null
     or jsonb_typeof(coalesce(p_order, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_production_files, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de creacion invalida';
  end if;

  v_seller_id := case when v_role = 'seller' then v_actor else null end;
  v_hash := md5(
    coalesce(p_order, '{}'::jsonb)::text
    || coalesce(p_production_files, '[]'::jsonb)::text
    || coalesce(p_asset_refs, '[]'::jsonb)::text
  );

  select * into v_command
  from public.order_creation_commands
  where actor_id = v_actor and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_command.request_hash <> v_hash then
      raise exception 'ORDER_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.status = 'completed' and v_command.order_id is not null then
      select * into v_order from public.orders where id = v_command.order_id;
      return v_order;
    end if;
    raise exception 'ORDER_CREATION_IN_PROGRESS';
  end if;

  v_order_id := coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid());

  -- Keep order_id null until the order INSERT succeeds; it is a foreign key.
  insert into public.order_creation_commands(actor_id, idempotency_key, request_hash)
  values (v_actor, p_idempotency_key, v_hash);

  perform set_config('app.neonprint_order_command', 'on', true);

  insert into public.orders(
    id, client_id, client_name, client_contact, invoice_number, description,
    material, termination_type, order_type, order_design_type, delivery_date,
    status, payment_status, seller_id, created_by, order_file_url,
    preview_image, reference_images, updated_by
  ) values (
    v_order_id,
    nullif(p_order->>'client_id', '')::uuid,
    p_order->>'client_name',
    nullif(p_order->>'client_contact', ''),
    p_order->>'invoice_number',
    p_order->>'description',
    p_order->>'material',
    nullif(p_order->>'termination_type', ''),
    p_order->>'order_type',
    p_order->>'order_design_type',
    nullif(trim(p_order->>'delivery_date'), ''),
    'Pending',
    'Pending_Payment',
    v_seller_id,
    v_actor,
    p_order->>'order_file_url',
    p_order->>'preview_image',
    coalesce(p_order->'reference_images', '[]'::jsonb),
    v_actor
  ) returning * into v_order;

  for v_file in select value from jsonb_array_elements(p_production_files)
  loop
    if nullif(trim(v_file->>'url'), '') is null
       or nullif(trim(v_file->>'public_label'), '') is null
       or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de produccion invalido';
    end if;
    insert into public.order_production_files(
      order_id, url, filename, public_label, production_area_code, status,
      created_by, updated_by
    ) values (
      v_order_id,
      trim(v_file->>'url'),
      coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'),
      trim(v_file->>'public_label'),
      trim(v_file->>'production_area_code'),
      'pending',
      v_actor,
      v_actor
    );
  end loop;

  -- Pre-order R2 descriptors must remain scoped to the preallocated order id.
  for v_asset in select value from jsonb_array_elements(coalesce(p_asset_refs, '[]'::jsonb))
  loop
    if nullif(trim(coalesce(v_asset->>'bucket', '')), '') is null
       or nullif(trim(coalesce(v_asset->>'objectKey', '')), '') is null
       or (v_asset->>'objectKey') !~ ('^orders/' || v_order_id::text || '/')
       or coalesce(v_asset->>'category', '') not in ('design', 'preview', 'reference') then
      raise exception 'Referencia de archivo previo invalida';
    end if;
    insert into public.order_files(
      order_id, provider, bucket, object_key, original_filename, content_type,
      size_bytes, category, status, uploaded_by
    ) values (
      v_order_id,
      'r2',
      trim(v_asset->>'bucket'),
      trim(v_asset->>'objectKey'),
      nullif(trim(v_asset->>'originalFilename'), ''),
      nullif(trim(v_asset->>'contentType'), ''),
      nullif(v_asset->>'sizeBytes', '')::bigint,
      v_asset->>'category',
      'uploaded',
      v_actor
    ) on conflict(provider, bucket, object_key) do nothing;
  end loop;

  update public.order_creation_commands
  set order_id = v_order_id, status = 'completed', updated_at = now()
  where actor_id = v_actor and idempotency_key = p_idempotency_key;

  return v_order;
end;
$$;

-- A fixed, audited asset-metadata command.  This is intentionally not a
-- generic JSON-to-orders update endpoint.
create or replace function public.admin_update_order_asset_metadata(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_key text;
  v_url text;
  v_preview_image text;
  v_reference_images jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'admin'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Solo un administrador activo puede actualizar los archivos de la orden.';
  end if;

  if p_expected_updated_at is null
     or jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'ORDER_STALE';
  end if;

  for v_key in select jsonb_object_keys(p_changes)
  loop
    if v_key not in ('preview_image', 'reference_images') then
      raise exception 'Campo no permitido: %', v_key;
    end if;
  end loop;

  select * into v_old
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_old.status in ('cancelled', 'in_Delivered') then
    raise exception 'No se pueden actualizar archivos en una orden terminal.';
  end if;

  v_preview_image := v_old.preview_image;
  if p_changes ? 'preview_image' then
    if jsonb_typeof(p_changes->'preview_image') not in ('string', 'null') then
      raise exception 'La imagen de preview debe ser una URL o estar vacia.';
    end if;
    v_preview_image := nullif(trim(coalesce(p_changes->>'preview_image', '')), '');

    if v_preview_image is not null and not (
      (
        v_preview_image ~ ('^https?://[^/]+/storage/v1/object/(public|sign)/order-previews/orders/' || p_order_id::text || '/preview/')
        and exists (
          select 1
          from storage.objects s
          where s.bucket_id = 'order-previews'
            and s.name = regexp_replace(
              v_preview_image,
              '^https?://[^/]+/storage/v1/object/(public|sign)/order-previews/([^?]+).*$','\2'
            )
            and s.name like ('orders/' || p_order_id::text || '/preview/%')
        )
      )
      or exists (
        select 1
        from public.order_files f
        where f.order_id = p_order_id
          and f.provider = 'r2'
          and f.category = 'preview'
          and f.status = 'uploaded'
          and f.deleted_at is null
          and f.object_key like ('orders/' || p_order_id::text || '/preview/%')
          and ('r2://' || f.bucket || '/' || f.object_key) = v_preview_image
      )
    ) then
      raise exception 'La imagen de preview no pertenece a esta orden.';
    end if;
    v_changed_fields := v_changed_fields || jsonb_build_array(jsonb_build_object(
      'field', 'preview_image',
      'label', 'Imagen de preview',
      'old_value', v_old.preview_image,
      'new_value', v_preview_image
    ));
  end if;

  v_reference_images := coalesce(v_old.reference_images, '[]'::jsonb);
  if p_changes ? 'reference_images' then
    if jsonb_typeof(p_changes->'reference_images') = 'null' then
      v_reference_images := '[]'::jsonb;
    elsif jsonb_typeof(p_changes->'reference_images') = 'array' then
      v_reference_images := p_changes->'reference_images';
    else
      raise exception 'Las imagenes de referencia deben ser una lista.';
    end if;

    if jsonb_array_length(v_reference_images) > 3 then
      raise exception 'Solo se permiten hasta 3 imagenes de referencia.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_reference_images) item(value)
      where jsonb_typeof(item.value) <> 'string'
        or nullif(trim(item.value #>> '{}'), '') is null
    ) then
      raise exception 'Cada imagen de referencia debe ser una URL valida.';
    end if;
    if exists (
      select item.value #>> '{}'
      from jsonb_array_elements(v_reference_images) item(value)
      group by item.value #>> '{}'
      having count(*) > 1
    ) then
      raise exception 'No se permiten imagenes de referencia duplicadas.';
    end if;

    for v_url in select trim(item.value #>> '{}') from jsonb_array_elements(v_reference_images) item(value)
    loop
      if not (
        (
          v_url ~ ('^https?://[^/]+/storage/v1/object/(public|sign)/order-docs/orders/' || p_order_id::text || '/ref-images/')
          and exists (
            select 1
            from storage.objects s
            where s.bucket_id = 'order-docs'
              and s.name = regexp_replace(
                v_url,
                '^https?://[^/]+/storage/v1/object/(public|sign)/order-docs/([^?]+).*$','\2'
              )
              and s.name like ('orders/' || p_order_id::text || '/ref-images/%')
          )
        )
        or exists (
          select 1
          from public.order_files f
          where f.order_id = p_order_id
            and f.provider = 'r2'
            and f.category = 'reference'
            and f.status = 'uploaded'
            and f.deleted_at is null
            and f.object_key like ('orders/' || p_order_id::text || '/ref-images/%')
            and ('r2://' || f.bucket || '/' || f.object_key) = v_url
        )
      ) then
        raise exception 'Una imagen de referencia no pertenece a esta orden.';
      end if;
    end loop;

    v_changed_fields := v_changed_fields || jsonb_build_array(jsonb_build_object(
      'field', 'reference_images',
      'label', 'Imagenes de referencia',
      'old_value', v_old.reference_images,
      'new_value', v_reference_images
    ));
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);

  update public.orders
  set preview_image = v_preview_image,
      reference_images = v_reference_images,
      updated_by = v_actor,
      last_admin_intervention_at = now(),
      last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = 'asset_metadata_updated',
      updated_at = now()
  where id = p_order_id
  returning * into v_new;

  perform public.record_admin_intervention(
    v_old,
    v_new,
    'asset_metadata_updated',
    'workflow_correction',
    'Archivos de la orden actualizados por Administracion desde Configuracion avanzada.',
    v_started_at,
    v_changed_fields
  );

  return v_new;
end;
$$;

revoke all on function public.create_seller_order_with_assets(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_seller_order_with_assets(uuid, jsonb, jsonb, jsonb) to authenticated;

revoke all on function public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb) to authenticated;
