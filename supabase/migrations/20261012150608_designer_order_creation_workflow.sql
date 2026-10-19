-- Designer-created orders use the same validated asset/idempotency path as
-- Sales, while deriving ownership and lifecycle fields exclusively from the
-- authenticated active profile.
create schema if not exists private authorization postgres;
revoke usage on schema private from public, anon, authenticated;

create or replace function private.create_order_with_assets_as_actor(
  p_idempotency_key uuid,
  p_order jsonb,
  p_production_files jsonb default '[]'::jsonb,
  p_asset_refs jsonb default '[]'::jsonb,
  p_creation_mode text default 'seller'
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
  v_designer_id uuid;
  v_status text;
  v_invoice_mode text;
  v_hash text;
  v_command public.order_creation_commands%rowtype;
  v_order public.orders%rowtype;
  v_file jsonb;
  v_asset jsonb;
  v_order_id uuid;
  v_provider text;
  v_reservation public.order_asset_preupload_reservations%rowtype;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = v_actor
    and coalesce(p.employment_status, true)
    and p.deleted_at is null;

  if v_role is null or p_creation_mode not in ('seller', 'designer') then
    raise exception 'Perfil o modo de creación no permitido.';
  end if;

  if (p_creation_mode = 'seller' and v_role not in ('seller', 'admin'))
     or (p_creation_mode = 'designer' and v_role <> 'designer') then
    raise exception 'El perfil activo no puede crear órdenes con este modo.';
  end if;

  if p_idempotency_key is null
     or jsonb_typeof(coalesce(p_order, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_production_files, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_asset_refs, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de creacion invalida';
  end if;

  if nullif(btrim(p_order->>'client_id'), '') is null
     or not exists (
       select 1 from public.clients c
       where c.id = nullif(p_order->>'client_id', '')::uuid
         and c.deleted_at is null
     )
     or nullif(btrim(p_order->>'client_name'), '') is null
     or nullif(btrim(p_order->>'client_contact'), '') is null
     or nullif(btrim(p_order->>'description'), '') is null
     or p_order->>'order_type' is null
     or p_order->>'order_type' not in ('orden normal', 'orden 911')
     or p_order->>'order_design_type' is null
     or p_order->>'order_design_type' not in ('INTERNAL_DESING', 'EXTERNAL_DESING') then
    raise exception 'Los datos obligatorios de la orden no son válidos.';
  end if;

  if p_order->>'order_design_type' = 'EXTERNAL_DESING'
     and jsonb_array_length(coalesce(p_production_files, '[]'::jsonb)) = 0 then
    raise exception 'Las órdenes de Diseño Externo requieren al menos un archivo.';
  end if;

  v_seller_id := case when p_creation_mode = 'seller' and v_role = 'seller' then v_actor else null end;
  v_designer_id := case when p_creation_mode = 'designer' then v_actor else null end;
  v_status := case when p_creation_mode = 'designer' then 'in_Design' else 'Pending' end;
  v_invoice_mode := case
    when p_creation_mode = 'designer' then 'cashier'
    else coalesce(nullif(lower(btrim(p_order->>'invoice_assignment_mode')), ''), 'seller')
  end;

  if v_invoice_mode not in ('seller', 'cashier') then
    raise exception 'Responsabilidad de facturación inválida.';
  end if;

  v_hash := md5(
    coalesce(p_order, '{}'::jsonb)::text
    || coalesce(p_production_files, '[]'::jsonb)::text
    || coalesce(p_asset_refs, '[]'::jsonb)::text
  );

  insert into public.order_creation_commands(actor_id, idempotency_key, request_hash)
  values (v_actor, p_idempotency_key, v_hash)
  on conflict (actor_id, idempotency_key) do nothing
  returning * into v_command;

  if not found then
    select * into v_command
    from public.order_creation_commands
    where actor_id = v_actor and idempotency_key = p_idempotency_key
    for update;
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

  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.neonprint_skip_legacy_order_file_sync', 'on', true);
  perform set_config('app.neonprint_invoice_assignment_mode', v_invoice_mode, true);

  insert into public.orders(
    id, client_id, client_name, client_contact, invoice_number,
    invoice_assignment_mode, description, material, termination_type,
    order_type, order_design_type, delivery_date, status, payment_status,
    seller_id, designer_id, quote_id, created_by, order_file_url,
    preview_image, reference_images, updated_by
  ) values (
    v_order_id,
    nullif(p_order->>'client_id', '')::uuid,
    p_order->>'client_name',
    nullif(p_order->>'client_contact', ''),
    p_order->>'invoice_number',
    v_invoice_mode,
    p_order->>'description',
    p_order->>'material',
    nullif(p_order->>'termination_type', ''),
    p_order->>'order_type',
    p_order->>'order_design_type',
    nullif(trim(p_order->>'delivery_date'), ''),
    v_status,
    'Pending_Payment',
    v_seller_id,
    v_designer_id,
    null,
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

  for v_asset in select value from jsonb_array_elements(coalesce(p_asset_refs, '[]'::jsonb))
  loop
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

    insert into public.order_files(
      order_id, provider, bucket, object_key, original_filename, content_type,
      size_bytes, category, status, uploaded_by
    ) values (
      v_order_id,
      v_provider,
      trim(v_asset->>'bucket'),
      trim(v_asset->>'objectKey'),
      nullif(trim(v_asset->>'originalFilename'), ''),
      nullif(trim(v_asset->>'contentType'), ''),
      nullif(v_asset->>'sizeBytes', '')::bigint,
      v_asset->>'category',
      'uploaded',
      v_actor
    ) on conflict(provider, bucket, object_key) do nothing;

    update public.order_asset_preupload_reservations
    set status = 'bound', bound_at = now()
    where id = v_reservation.id;
  end loop;

  update public.order_creation_commands
  set order_id = v_order_id, status = 'completed', updated_at = now()
  where actor_id = v_actor and idempotency_key = p_idempotency_key;

  return v_order;
end;
$$;

revoke all on function private.create_order_with_assets_as_actor(uuid, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;

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
begin
  return private.create_order_with_assets_as_actor(
    p_idempotency_key, p_order, p_production_files, p_asset_refs, 'seller'
  );
end;
$$;

create or replace function public.create_seller_order_with_file_specifications(
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
  v_order public.orders%rowtype;
begin
  v_order := public.create_seller_order_with_assets(
    p_idempotency_key, p_order, p_production_files, p_asset_refs
  );
  if jsonb_array_length(coalesce(p_production_files, '[]'::jsonb)) > 0 then
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_production_files
    );
  end if;
  return v_order;
end;
$$;

create or replace function public.designer_create_order_with_file_specifications(
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
  v_order public.orders%rowtype;
begin
  v_order := private.create_order_with_assets_as_actor(
    p_idempotency_key, p_order, p_production_files, p_asset_refs, 'designer'
  );
  if jsonb_array_length(coalesce(p_production_files, '[]'::jsonb)) > 0 then
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_production_files
    );
  end if;
  return v_order;
end;
$$;

revoke all on function public.create_seller_order_with_assets(uuid, jsonb, jsonb, jsonb),
  public.create_seller_order_with_file_specifications(uuid, jsonb, jsonb, jsonb),
  public.designer_create_order_with_file_specifications(uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_seller_order_with_assets(uuid, jsonb, jsonb, jsonb),
  public.create_seller_order_with_file_specifications(uuid, jsonb, jsonb, jsonb),
  public.designer_create_order_with_file_specifications(uuid, jsonb, jsonb, jsonb)
  to authenticated;

-- Designers may reuse the existing registered-client modal.  The policy still
-- derives access from the active, non-deleted profile helper.
drop policy if exists clients_insert_non_admin on public.clients;
create policy clients_insert_non_admin
  on public.clients
  for insert to authenticated
  with check (public.current_profile_role() in ('seller', 'quote', 'designer'));

create or replace function public.can_send_order_to_production(
  p_order_id uuid,
  p_actor_id uuid default auth.uid()
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
begin
  if v_actor is null or p_actor_id is distinct from v_actor then return false; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_admin, false)
     or coalesce(v_order.is_archived_quote, false)
     or coalesce(v_order.is_archived_designer, false)
     or coalesce(v_order.is_archived_production, false)
     or coalesce(v_order.is_archived_delivery, false)
     or v_order.operational_status = 'blocked'
     or v_order.status <> 'in_Quote'
     or v_order.payment_status not in ('pagado', 'parcial', 'credito')
     or v_order.production_authorized_at is null
     or v_order.production_authorized_by is null then
    return false;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_actor
    and coalesce(p.employment_status, true)
    and p.deleted_at is null;
  if v_role = 'admin' then return true; end if;
  if v_role = 'designer' then
    return v_order.designer_id = v_actor
       and (
         v_order.order_design_type = 'INTERNAL_DESING'
         or (v_order.order_design_type = 'EXTERNAL_DESING' and v_order.created_by = v_actor)
       );
  end if;
  if v_role = 'seller' then
    return v_order.order_design_type = 'EXTERNAL_DESING'
       and (v_order.seller_id = v_actor or v_order.created_by = v_actor);
  end if;
  if v_role = 'semi_admin' then
    return public.semi_admin_is_order_routing_responsible(p_order_id, v_actor);
  end if;
  return false;
end;
$$;

revoke all on function public.can_send_order_to_production(uuid, uuid) from public, anon;
grant execute on function public.can_send_order_to_production(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
