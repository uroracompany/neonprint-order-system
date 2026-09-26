-- Administrative order operations must use the same transaction-local command
-- boundary as every other workflow actor.  The prior admin exception in the
-- orders trigger made direct browser DML possible and was also masking legacy
-- command functions that had not yet established the command context.

create or replace function public.guard_orders_direct_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_command_context boolean := coalesce(current_setting('app.neonprint_order_command', true) = 'on', false)
    or nullif(current_setting('app.admin_intervention_context', true), '') is not null;
begin
  if not v_has_command_context
     and (
       new.created_by is distinct from old.created_by or new.seller_id is distinct from old.seller_id
       or new.designer_id is distinct from old.designer_id or new.quote_id is distinct from old.quote_id
       or new.production_id is distinct from old.production_id or new.delivery_id is distinct from old.delivery_id
       or new.status is distinct from old.status or new.payment_status is distinct from old.payment_status
       or new.invoice_payment is distinct from old.invoice_payment or new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name or new.client_contact is distinct from old.client_contact
       or new.invoice_number is distinct from old.invoice_number or new.description is distinct from old.description
       or new.material is distinct from old.material or new.termination_type is distinct from old.termination_type
       or new.order_type is distinct from old.order_type or new.order_design_type is distinct from old.order_design_type
       or new.delivery_date is distinct from old.delivery_date or new.order_file_url is distinct from old.order_file_url
       or new.preview_image is distinct from old.preview_image or new.reference_images is distinct from old.reference_images
       or new.cancellation_reason is distinct from old.cancellation_reason or new.cancelled_from_status is distinct from old.cancelled_from_status
       or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
       or new.return_reason is distinct from old.return_reason or new.returned_to_designer_at is distinct from old.returned_to_designer_at
       or new.delivery_note is distinct from old.delivery_note or new.operational_status is distinct from old.operational_status
       or new.blocked_reason_category is distinct from old.blocked_reason_category or new.blocked_reason_detail is distinct from old.blocked_reason_detail
       or new.blocked_owner_id is distinct from old.blocked_owner_id or new.blocked_by is distinct from old.blocked_by
       or new.blocked_at is distinct from old.blocked_at or new.blocked_expected_resolution_at is distinct from old.blocked_expected_resolution_at
       or new.commercial_review_required is distinct from old.commercial_review_required
       or new.status_changed_at is distinct from old.status_changed_at
       or new.last_admin_intervention_at is distinct from old.last_admin_intervention_at
       or new.last_admin_intervention_by is distinct from old.last_admin_intervention_by
       or new.last_admin_intervention_kind is distinct from old.last_admin_intervention_kind
       or new.is_archived is distinct from old.is_archived or new.is_archived_designer is distinct from old.is_archived_designer
       or new.is_archived_quote is distinct from old.is_archived_quote or new.is_archived_delivery is distinct from old.is_archived_delivery
       or new.is_archived_admin is distinct from old.is_archived_admin or new.updated_by is distinct from old.updated_by
     ) then
    raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden';
  end if;

  if new.status = 'in_Production' then
    if new.status is not distinct from old.status and not v_has_command_context then
      raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden';
    end if;
    if new.status is distinct from old.status
       and old.status is distinct from 'in_Quote'
       and not (old.status = 'in_Termination' and current_setting('app.neonprint_order_command', true) = 'on') then
      raise exception 'La orden debe estar en Caja antes de enviarse a Produccion.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.require_active_admin_order_actor()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;
  return v_actor;
end;
$$;

revoke all on function public.require_active_admin_order_actor() from public, anon, authenticated;

-- Preserve the public command and its idempotency-replay behavior while giving
-- the retained implementation the trusted context it now requires.
create or replace function public.admin_execute_order_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_target_user_id uuid;
  v_order_status text;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Falta la clave de idempotencia.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  -- Keep a completed command replayable by its legacy compatibility engine.
  if exists (select 1 from public.admin_order_command_executions e where e.idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(
      p_order_id, p_action, p_payload, p_reason_category, p_reason_detail,
      p_expected_updated_at, p_idempotency_key
    );
  end if;

  if p_action = 'register_payment' then
    select status into v_order_status from public.orders where id = p_order_id for share;
    if not found then raise exception 'La orden no existe.'; end if;
    if v_order_status <> 'in_Quote' then
      raise exception 'El pago solo puede modificarse cuando la orden esta en Caja.';
    end if;
  end if;

  if p_action in ('assign_seller', 'route_sales') then
    v_target_user_id := nullif(p_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is not null and v_target_user_id <> v_actor and not exists (
      select 1 from public.profiles p
      where p.id = v_target_user_id and p.role = 'seller'
        and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then
      raise exception 'Selecciona un vendedor activo.';
    end if;
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  return public.admin_execute_order_command_legacy(
    p_order_id, p_action, p_payload, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_idempotency_key
  );
end;
$$;

create or replace function public.admin_manage_order(
  p_order_id uuid,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_target_user_id uuid default null,
  p_area_assignments jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_order public.orders;
begin
  if p_action in ('assign_seller', 'route_sales') and p_target_user_id is not null and p_target_user_id <> v_actor
     and not exists (
       select 1 from public.profiles p where p.id = p_target_user_id and p.role = 'seller'
         and coalesce(p.employment_status, true) and p.deleted_at is null
     ) then
    raise exception 'Selecciona un vendedor activo.';
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.operational_status = 'blocked' then
    raise exception 'La orden esta bloqueada. Reanudala antes de cambiar su etapa o responsable.';
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  return public.admin_manage_order_legacy(
    p_order_id, p_action, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_target_user_id, p_area_assignments
  );
end;
$$;

-- Queue a single removed asset in the durable, provider-aware outbox.  Older
-- orders may have only a public Storage URL, while newer R2 assets are tracked
-- by the canonical catalog.  Never send these records to the retired queue:
-- it has no worker and would leave objects behind indefinitely.
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

  -- The catalog is authoritative for R2 and also lets us retain lifecycle
  -- metadata for Storage assets that were registered by newer upload paths.
  select f.* into v_catalog_file
  from public.order_files f
  where f.order_id = p_order_id
    and f.deleted_at is null
    and (
      ('r2://' || f.bucket || '/' || f.object_key) = v_url
      or (
        f.provider = 'supabase'
        and f.bucket = p_default_bucket
        and f.object_key = regexp_replace(
          v_url,
          '^https?://[^/]+/storage/v1/object/[^/]+/[^/]+/([^?]+).*$','\1'
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

-- Dedicated edit command: browser uploads may precede it, but no browser DML
-- determines production metadata or removes durable storage objects.
create or replace function public.admin_edit_order_with_assets(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb,
  p_removed_file_urls text[] default '{}'::text[],
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_old public.orders;
  v_new public.orders;
  v_file jsonb;
  v_url text;
  v_key text;
  v_existing jsonb;
  v_result jsonb;
  v_file_urls jsonb;
  v_reference_images jsonb;
  v_preview_image text;
  v_delivery_date text;
  v_removed_urls text[] := array[]::text[];
  v_request_hash text;
  v_started_at timestamptz := clock_timestamp();
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Falta la clave de idempotencia.';
  end if;
  if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_new_production_files, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de edicion invalida.';
  end if;
  if coalesce(p_changes, '{}'::jsonb) = '{}'::jsonb
     and jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) = 0
     and cardinality(coalesce(p_removed_file_urls, '{}'::text[])) = 0 then
    raise exception 'No hay cambios para guardar.';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if v_key not in ('client_id', 'client_name', 'client_contact', 'invoice_number', 'description', 'material', 'termination_type', 'delivery_date', 'preview_image', 'reference_images') then
      raise exception 'Campo no permitido: %', v_key;
    end if;
  end loop;
  if p_changes ? 'description' and nullif(trim(coalesce(p_changes->>'description', '')), '') is null then
    raise exception 'La descripcion es obligatoria.';
  end if;
  if p_changes ? 'client_id' and (
    nullif(trim(coalesce(p_changes->>'client_id', '')), '') is null or not exists (
      select 1 from public.clients c where c.id = (p_changes->>'client_id')::uuid and c.deleted_at is null
    )
  ) then
    raise exception 'Selecciona un cliente registrado activo.';
  end if;

  v_request_hash := md5(concat_ws('|', p_order_id::text, coalesce(p_changes, '{}'::jsonb)::text,
    coalesce(p_new_production_files, '[]'::jsonb)::text, coalesce(array_to_string(p_removed_file_urls, '|'), '')));
  select result into v_existing from public.admin_order_command_executions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing is null then raise exception 'El comando ya esta en proceso.'; end if;
    return v_existing;
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_old.status in ('cancelled', 'in_Delivered') then
    raise exception 'No se puede editar una orden cancelada o entregada. Reabre o devuelve la orden primero.';
  end if;
  if p_changes ? 'delivery_date' then
    v_delivery_date := nullif(trim(p_changes->>'delivery_date'), '');
    if v_delivery_date is not null and v_delivery_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'La fecha de entrega debe tener formato AAAA-MM-DD.';
    end if;
    if v_delivery_date is distinct from v_old.delivery_date
       and v_delivery_date is not null
       and v_delivery_date::date < current_date then
      raise exception 'La fecha de entrega no puede ser anterior a hoy.';
    end if;
  end if;

  if jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) > 0
     or cardinality(coalesce(p_removed_file_urls, '{}'::text[])) > 0
     or p_changes ? 'preview_image' or p_changes ? 'reference_images' then
    if not ((v_old.order_design_type = 'INTERNAL_DESING' and v_old.status = 'in_Design')
      or (v_old.order_design_type = 'EXTERNAL_DESING' and v_old.status = 'Pending')) then
      raise exception 'Los archivos solo se modifican en Diseno Interno o en Ventas para Diseno Externo.';
    end if;
  end if;

  if p_changes ? 'preview_image' then
    v_preview_image := nullif(trim(coalesce(p_changes->>'preview_image', '')), '');
    if v_preview_image is not null and not (
      (v_preview_image ~ ('^https?://[^/]+/storage/v1/object/(public|sign)/order-previews/orders/' || p_order_id::text || '/preview/')
        and exists (select 1 from storage.objects s where s.bucket_id = 'order-previews'
          and s.name = regexp_replace(v_preview_image, '^https?://[^/]+/storage/v1/object/(public|sign)/order-previews/([^?]+).*$', '\2')
          and s.name like ('orders/' || p_order_id::text || '/preview/%')))
      or exists (select 1 from public.order_files f where f.order_id = p_order_id and f.provider = 'r2'
        and f.category = 'preview' and f.status = 'uploaded' and f.deleted_at is null
        and ('r2://' || f.bucket || '/' || f.object_key) = v_preview_image)
    ) then
      raise exception 'La imagen de preview no pertenece a esta orden.';
    end if;
  else
    v_preview_image := v_old.preview_image;
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
    if jsonb_array_length(v_reference_images) > 3 then raise exception 'Solo se permiten hasta 3 imagenes de referencia.'; end if;
    for v_url in select trim(item.value #>> '{}') from jsonb_array_elements(v_reference_images) item(value) loop
      if nullif(v_url, '') is null or not (
        (v_url ~ ('^https?://[^/]+/storage/v1/object/(public|sign)/order-docs/orders/' || p_order_id::text || '/ref-images/')
          and exists (select 1 from storage.objects s where s.bucket_id = 'order-docs'
            and s.name = regexp_replace(v_url, '^https?://[^/]+/storage/v1/object/(public|sign)/order-docs/([^?]+).*$', '\2')
            and s.name like ('orders/' || p_order_id::text || '/ref-images/%')))
        or exists (select 1 from public.order_files f where f.order_id = p_order_id and f.provider = 'r2'
          and f.category = 'reference' and f.status = 'uploaded' and f.deleted_at is null
          and ('r2://' || f.bucket || '/' || f.object_key) = v_url)
      ) then
        raise exception 'Una imagen de referencia no pertenece a esta orden.';
      end if;
    end loop;
  end if;

  select coalesce(array_agg(distinct trim(value)), array[]::text[]) into v_removed_urls
  from unnest(coalesce(p_removed_file_urls, '{}'::text[])) value where nullif(trim(value), '') is not null;
  v_file_urls := case
    when nullif(trim(coalesce(v_old.order_file_url, '')), '') is null then '[]'::jsonb
    when left(trim(v_old.order_file_url), 1) = '[' then v_old.order_file_url::jsonb
    else jsonb_build_array(v_old.order_file_url)
  end;
  if jsonb_typeof(v_file_urls) <> 'array' then raise exception 'Los archivos actuales de la orden no son validos.'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_new_production_files, '[]'::jsonb)) item
    group by trim(item.value->>'url') having count(*) > 1
  ) then raise exception 'No se permiten archivos de produccion duplicados.'; end if;

  insert into public.admin_order_command_executions(idempotency_key, order_id, actor_id, action, request_hash)
  values (p_idempotency_key, p_order_id, v_actor, 'edit_order', v_request_hash);

  if cardinality(v_removed_urls) > 0 then
    for v_url in
      select f.url
      from public.order_production_files f
      where f.order_id = p_order_id and f.url = any(v_removed_urls)
    loop
      perform public.enqueue_admin_order_asset_deletion(p_order_id, v_url, 'order-docs');
    end loop;
    delete from public.order_production_files where order_id = p_order_id and url = any(v_removed_urls);
    select coalesce(jsonb_agg(to_jsonb(existing_url.value)), '[]'::jsonb) into v_file_urls
    from jsonb_array_elements_text(v_file_urls) existing_url(value) where existing_url.value <> all(v_removed_urls);
  end if;

  for v_file in select value from jsonb_array_elements(coalesce(p_new_production_files, '[]'::jsonb)) loop
    v_url := trim(v_file->>'url');
    if nullif(v_url, '') is null or nullif(trim(v_file->>'public_label'), '') is null or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de produccion invalido.';
    end if;
    if not exists (select 1 from public.production_areas a where a.code = trim(v_file->>'production_area_code') and a.is_active) then
      raise exception 'Selecciona un area de produccion activa.';
    end if;
    if not (v_url ~ ('^https?://[^/]+/storage/v1/object/(public|sign)/order-docs/orders/' || p_order_id::text || '/files/')
      and exists (select 1 from storage.objects s where s.bucket_id = 'order-docs'
        and s.name = regexp_replace(v_url, '^https?://[^/]+/storage/v1/object/(public|sign)/order-docs/([^?]+).*$', '\2')
        and s.name like ('orders/' || p_order_id::text || '/files/%'))) then
      raise exception 'El archivo de produccion no pertenece a esta orden.';
    end if;
    if exists (select 1 from public.order_production_files f where f.order_id = p_order_id and f.url = v_url)
       or exists (select 1 from jsonb_array_elements_text(v_file_urls) current_url(value) where current_url.value = v_url) then
      raise exception 'El archivo de produccion ya existe en la orden.';
    end if;
    insert into public.order_production_files(order_id, url, filename, public_label, production_area_code, status, created_by, updated_by)
    values (p_order_id, v_url, coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'), trim(v_file->>'public_label'),
      trim(v_file->>'production_area_code'), 'pending', v_actor, v_actor);
    v_file_urls := v_file_urls || jsonb_build_array(v_url);
  end loop;

  if v_old.preview_image is not null and v_old.preview_image is distinct from v_preview_image then
    perform public.enqueue_admin_order_asset_deletion(p_order_id, v_old.preview_image, 'order-previews');
  end if;
  for v_url in
    select trim(old_ref.value #>> '{}')
    from jsonb_array_elements(coalesce(v_old.reference_images, '[]'::jsonb)) old_ref(value)
    where not exists (
      select 1 from jsonb_array_elements(v_reference_images) new_ref(value)
      where new_ref.value = old_ref.value
    )
  loop
    perform public.enqueue_admin_order_asset_deletion(p_order_id, v_url, 'order-docs');
  end loop;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    client_id = case when p_changes ? 'client_id' then (p_changes->>'client_id')::uuid else client_id end,
    client_name = case when p_changes ? 'client_name' then p_changes->>'client_name' else client_name end,
    client_contact = case when p_changes ? 'client_contact' then nullif(p_changes->>'client_contact', '') else client_contact end,
    invoice_number = case when p_changes ? 'invoice_number' then p_changes->>'invoice_number' else invoice_number end,
    description = case when p_changes ? 'description' then trim(p_changes->>'description') else description end,
    material = case when p_changes ? 'material' then p_changes->>'material' else material end,
    termination_type = case when p_changes ? 'termination_type' then nullif(p_changes->>'termination_type', '') else termination_type end,
    delivery_date = case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end,
    order_file_url = v_file_urls::text,
    preview_image = v_preview_image,
    reference_images = v_reference_images,
    updated_by = v_actor, last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
    last_admin_intervention_kind = 'edit_order', updated_at = now()
  where id = p_order_id returning * into v_new;

  perform public.record_admin_intervention(
    v_old, v_new, 'update_requirements', 'client_request',
    'Orden editada por Administracion desde la gestion de ordenes.', v_started_at, null
  );
  v_result := jsonb_build_object('order', to_jsonb(v_new), 'action', 'edit_order', 'success', true);
  update public.admin_order_command_executions set result = v_result, completed_at = now() where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.admin_edit_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text) from public, anon;
grant execute on function public.admin_edit_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text) to authenticated;
revoke insert, update, delete on public.order_production_files from public, anon, authenticated;

-- Keep the existing advanced-assets API stable, but give it the same lifecycle
-- rules and idempotent, validated implementation as the main edit form.
create or replace function public.admin_update_order_asset_metadata(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order public.orders;
  v_key text;
begin
  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if v_key not in ('preview_image', 'reference_images') then raise exception 'Campo no permitido: %', v_key; end if;
  end loop;
  v_result := public.admin_edit_order_with_assets(
    p_order_id, p_expected_updated_at, p_changes, '[]'::jsonb, '{}'::text[], gen_random_uuid()::text
  );
  select * into v_order from jsonb_populate_record(null::public.orders, v_result->'order');
  return v_order;
end;
$$;

-- Advanced file management retains its established RPC names, but delegates the
-- actual reconciliation to the same locked edit command used by the main form.
create or replace function public.admin_add_production_file(
  p_order_id uuid,
  p_url text,
  p_filename text,
  p_public_label text,
  p_area_code text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_file public.order_production_files;
  v_order public.orders;
begin
  if nullif(trim(coalesce(p_url, '')), '') is null or nullif(trim(coalesce(p_public_label, '')), '') is null then
    raise exception 'El archivo y su etiqueta son obligatorios.';
  end if;
  v_result := public.admin_edit_order_with_assets(
    p_order_id, p_expected_updated_at, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('url', trim(p_url), 'filename', p_filename, 'public_label', p_public_label, 'production_area_code', p_area_code)),
    '{}'::text[], gen_random_uuid()::text
  );
  select * into v_order from jsonb_populate_record(null::public.orders, v_result->'order');
  select * into v_file from public.order_production_files where order_id = p_order_id and url = trim(p_url);
  return jsonb_build_object('file', to_jsonb(v_file), 'order_updated_at', v_order.updated_at);
end;
$$;

create or replace function public.admin_remove_production_file(
  p_file_id uuid,
  p_reason_detail text,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.order_production_files;
  v_order public.orders;
begin
  perform public.require_active_admin_order_actor();
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'Explica el motivo con al menos 10 caracteres.';
  end if;
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  if v_file.updated_at is distinct from p_expected_updated_at then raise exception 'El archivo cambio mientras lo editabas.'; end if;
  select * into v_order from public.orders where id = v_file.order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  perform public.admin_edit_order_with_assets(
    v_file.order_id, v_order.updated_at, '{}'::jsonb, '[]'::jsonb, array[v_file.url], gen_random_uuid()::text
  );
  return p_file_id;
end;
$$;

-- Administration must return a completed order to Caja before adjusting payment
-- or starting a design/sales correction.  This action retains the established
-- command name and audit/idempotency result shape.
create or replace function public.admin_return_completed_to_quote_command(
  p_order_id uuid,
  p_payload jsonb,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_old public.orders;
  v_new public.orders;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
  v_hash text := md5(concat_ws('|', p_order_id::text, 'return_to_quote', coalesce(p_payload, '{}'::jsonb)::text, p_reason_category, p_reason_detail));
begin
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_old.status <> 'in_Completed' then raise exception 'La orden debe estar en Completado para regresar a Caja.'; end if;
  insert into public.admin_order_command_executions(idempotency_key, order_id, actor_id, action, request_hash)
  values (p_idempotency_key, p_order_id, v_actor, 'return_to_quote', v_hash);
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set status = 'in_Quote', delivery_id = null, production_id = null,
    last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
    last_admin_intervention_kind = 'return_to_quote', updated_at = now()
  where id = p_order_id returning * into v_new;
  perform public.record_admin_intervention(v_old, v_new, 'return_to_quote', p_reason_category, trim(p_reason_detail), v_started_at, null);
  v_result := jsonb_build_object('order', to_jsonb(v_new), 'action', 'return_to_quote', 'success', true);
  update public.admin_order_command_executions set result = v_result, completed_at = now() where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

-- The public executor only needs a small compatibility interception for the
-- newly permitted completed-to-Caja return.  Other action contracts continue
-- through the legacy engine above.
create or replace function public.admin_execute_order_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_target_user_id uuid;
  v_order_status text;
  v_result jsonb;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoria de motivo valida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.'; end if;
  if exists (select 1 from public.admin_order_command_executions e where e.idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  select status into v_order_status from public.orders where id = p_order_id for share;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_action = 'register_payment' and v_order_status <> 'in_Quote' then raise exception 'El pago solo puede modificarse cuando la orden esta en Caja.'; end if;
  if p_action in ('assign_seller', 'route_sales') then
    v_target_user_id := nullif(p_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is not null and v_target_user_id <> v_actor and not exists (
      select 1 from public.profiles p where p.id = v_target_user_id and p.role = 'seller' and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then raise exception 'Selecciona un vendedor activo.'; end if;
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  if p_action = 'return_to_quote' and v_order_status = 'in_Completed' then
    v_result := public.admin_return_completed_to_quote_command(p_order_id, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  else
    v_result := public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  if p_action = 'reopen_cancelled' then
    perform public.notify_many(
      array[v_actor], 'order_updated', 'Orden reactivada por Administracion',
      'La orden #' || left(p_order_id::text, 8) || ' fue reactivada por Administracion.', p_order_id,
      jsonb_build_object('event_kind', 'admin_intervention', 'action', p_action, 'deep_link', '/dashboard?order=' || p_order_id::text)
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.mark_order_as_credit(
  p_order_id uuid, p_due_date timestamptz, p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_role text; v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select role into v_role from public.profiles where id = v_uid and coalesce(employment_status, true) and deleted_at is null;
  if v_uid is null or v_role not in ('admin', 'quote') then raise exception 'Solo caja o admin pueden aprobar pago a credito.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_role <> 'admin' and v_order.quote_id is distinct from v_uid then raise exception 'No tienes acceso a esta orden.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.status <> 'in_Quote' or coalesce(v_order.is_archived, false) or v_order.payment_status <> 'Pending_Payment' then raise exception 'La orden no es elegible para credito.'; end if;
  if v_order.client_id is null or nullif(trim(coalesce(v_order.invoice_number, '')), '') is null then raise exception 'Para vender a credito debes registrar cliente y factura.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set payment_status = 'credito', invoice_payment = null, updated_at = now(), updated_by = v_uid where id = p_order_id returning * into v_updated;
  insert into public.accounts_receivable(order_id, client_id, invoice_number, status, issued_at, due_date, created_by)
  values (p_order_id, v_updated.client_id, nullif(trim(v_updated.invoice_number), ''), 'open', now(), p_due_date, v_uid)
  on conflict(order_id) do update set client_id = excluded.client_id, invoice_number = excluded.invoice_number, due_date = excluded.due_date, status = 'open', updated_at = now();
  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (p_order_id, v_uid, 'credit_granted', v_order.payment_status, 'credito', jsonb_build_object('client_id', v_updated.client_id, 'invoice_number', v_updated.invoice_number, 'due_date', p_due_date));
  return v_updated;
end;
$$;

-- Retired participants must not receive reactivation notifications.  The
-- existing intervention recorder supplies all other participants; this helper
-- preserves that behavior and includes the initiating administrator once.
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
    select p_old as order_row where (p_old).id is not null
    union all select p_new as order_row where (p_new).id is not null
  ), candidate_recipients as (
    select unnest(public.get_admin_user_ids()) as recipient_id
    union all
    select unnest(array[(order_row).created_by, (order_row).seller_id, (order_row).designer_id, (order_row).quote_id, (order_row).production_id, (order_row).delivery_id]) from order_versions
    union all select unnest(public.admin_order_edit_production_recipients(order_row)) from order_versions
  )
  select coalesce(array_agg(distinct candidate.recipient_id), array[]::uuid[])
  from candidate_recipients candidate join public.profiles profile on profile.id = candidate.recipient_id
  where candidate.recipient_id is not null and coalesce(profile.employment_status, true) and profile.deleted_at is null;
$$;

create or replace function public.admin_intervention_action_label(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'assign_seller' then 'Reasignada por Administracion'
    when 'route_sales' then 'Movida a Ventas por Administracion'
    when 'route_design' then 'Movida a Diseno por Administracion'
    when 'route_quote' then 'Movida a Caja por Administracion'
    when 'route_production' then 'Movida a Produccion por Administracion'
    when 'reassign_production' then 'Produccion reasignada por Administracion'
    when 'route_completed' then 'Asignada a Entrega por Administracion'
    when 'production_file_status' then 'Archivo actualizado por Administracion'
    when 'production_file_reopened' then 'Archivo reabierto por Administracion'
    when 'set_designer_assignee' then 'Disenador reasignado por Administracion'
    when 'return_to_design' then 'Regresada a Diseno por Administracion'
    when 'design_assets_updated' then 'Archivos de diseno actualizados por Administracion'
    when 'mark_delivered' then 'Marcada como Entregada por Administracion'
    when 'return_to_completed' then 'Regresada a Completado por Administracion'
    when 'reopen_cancelled' then 'Orden reactivada por Administracion'
    else 'Intervenida por Administracion'
  end
$$;

-- Remaining advanced entrypoints keep their API signatures but no longer rely
-- on a broad role exception.  Every compatibility engine is invoked only after
-- the active/non-retired check and both recognised transaction contexts exist.
do $$
begin
  if to_regprocedure('public.admin_intervene_order_legacy(uuid,text,text,text,timestamptz,uuid,jsonb)') is null
     and to_regprocedure('public.admin_intervene_order(uuid,text,text,text,timestamptz,uuid,jsonb)') is not null then
    alter function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb) rename to admin_intervene_order_legacy;
  end if;
  if to_regprocedure('public.admin_force_file_status_legacy(uuid,text,text,text,timestamptz,uuid)') is null
     and to_regprocedure('public.admin_force_file_status(uuid,text,text,text,timestamptz,uuid)') is not null then
    alter function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) rename to admin_force_file_status_legacy;
  end if;
  if to_regprocedure('public.admin_update_production_file_status_legacy(uuid,text,text,text,timestamptz,uuid)') is null
     and to_regprocedure('public.admin_update_production_file_status(uuid,text,text,text,timestamptz,uuid)') is not null then
    alter function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid) rename to admin_update_production_file_status_legacy;
  end if;
  if to_regprocedure('public.admin_reassign_file_production_area_legacy(uuid,text,uuid,timestamptz)') is null
     and to_regprocedure('public.admin_reassign_file_production_area(uuid,text,uuid,timestamptz)') is not null then
    alter function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) rename to admin_reassign_file_production_area_legacy;
  end if;
  if to_regprocedure('public.admin_save_design_assets_legacy(uuid,jsonb,text,text,text,timestamptz)') is null
     and to_regprocedure('public.admin_save_design_assets(uuid,jsonb,text,text,text,timestamptz)') is not null then
    alter function public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) rename to admin_save_design_assets_legacy;
  end if;
end $$;

create or replace function public.admin_intervene_order(
  p_order_id uuid, p_action text, p_reason_category text, p_reason_detail text,
  p_expected_updated_at timestamptz, p_target_user_id uuid default null, p_area_assignments jsonb default '{}'::jsonb
)
returns public.orders language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', p_action, true);
  return public.admin_intervene_order_legacy(p_order_id, p_action, p_reason_category, p_reason_detail, p_expected_updated_at, p_target_user_id, p_area_assignments);
end;
$$;

create or replace function public.admin_force_file_status(
  p_file_id uuid, p_new_status text, p_reason_category text, p_reason_detail text,
  p_expected_updated_at timestamptz, p_delivery_id uuid default null
)
returns public.order_production_files language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_status', true);
  return public.admin_force_file_status_legacy(p_file_id, p_new_status, p_reason_category, p_reason_detail, p_expected_updated_at, p_delivery_id);
end;
$$;

create or replace function public.admin_update_production_file_status(
  p_file_id uuid, p_next_status text, p_reason_category text, p_reason_detail text,
  p_expected_updated_at timestamptz, p_delivery_id uuid default null
)
returns public.order_production_files language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_status', true);
  return public.admin_update_production_file_status_legacy(p_file_id, p_next_status, p_reason_category, p_reason_detail, p_expected_updated_at, p_delivery_id);
end;
$$;

create or replace function public.admin_reassign_file_production_area(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz
)
returns public.order_production_files language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_reassigned', true);
  return public.admin_reassign_file_production_area_legacy(p_file_id, p_new_area_code, p_new_assigned_user_id, p_expected_updated_at);
end;
$$;

create or replace function public.admin_save_design_assets(
  p_order_id uuid, p_files jsonb, p_preview_url text, p_reason_category text,
  p_reason_detail text, p_expected_updated_at timestamptz
)
returns public.orders language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'design_assets_updated', true);
  return public.admin_save_design_assets_legacy(p_order_id, p_files, p_preview_url, p_reason_category, p_reason_detail, p_expected_updated_at);
end;
$$;

-- Surface the safe completed-to-Caja route in advanced settings without
-- changing the rest of the existing command catalogue.
create or replace function public.admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_order public.orders;
  v_base jsonb;
  v_actions jsonb := '[]'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  v_base := public.get_admin_order_actions(p_order_id);
  if v_order.operational_status = 'blocked' then
    v_actions := jsonb_build_array(jsonb_build_object('key', 'resume_order', 'label', 'Reanudar orden'), jsonb_build_object('key', 'update_block', 'label', 'Actualizar bloqueo'), jsonb_build_object('key', 'set_priority', 'label', 'Cambiar prioridad'), jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar tipo de diseno'));
  else
    v_actions := coalesce(v_base->'actions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('key', 'block_order', 'label', 'Bloquear temporalmente'), jsonb_build_object('key', 'set_priority', 'label', 'Cambiar prioridad'), jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar tipo de diseno'), jsonb_build_object('key', 'update_requirements', 'label', 'Registrar cambio de requisitos'));
    if v_order.commercial_review_required and v_order.status = 'in_Quote' then v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'approve_commercial_review', 'label', 'Aprobar revision comercial')); end if;
    if v_order.status = 'cancelled' then
      v_actions := jsonb_build_array(jsonb_build_object('key', 'reopen_cancelled', 'label', 'Reabrir orden cancelada'), jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar tipo de diseno'));
    elsif v_order.status = 'in_Completed' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'return_to_quote', 'label', 'Regresar a Caja'));
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'cancel_order', 'label', 'Cancelar con motivo'));
    elsif v_order.status <> 'in_Delivered' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'cancel_order', 'label', 'Cancelar con motivo'));
    end if;
  end if;
  return v_base || jsonb_build_object('actions', v_actions, 'operational_status', v_order.operational_status,
    'blocked_reason_category', v_order.blocked_reason_category, 'blocked_reason_detail', v_order.blocked_reason_detail,
    'blocked_owner_id', v_order.blocked_owner_id, 'blocked_expected_resolution_at', v_order.blocked_expected_resolution_at,
    'commercial_review_required', v_order.commercial_review_required);
end;
$$;

revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;
revoke all on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
revoke all on function public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb) to authenticated;
revoke all on function public.admin_add_production_file(uuid, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_add_production_file(uuid, text, text, text, text, timestamptz) to authenticated;
revoke all on function public.admin_remove_production_file(uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_remove_production_file(uuid, text, timestamptz) to authenticated;
revoke all on function public.admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.admin_get_order_command_catalog(uuid) to authenticated;
revoke all on function public.admin_intervene_order_legacy(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
revoke all on function public.admin_force_file_status_legacy(uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) to authenticated;
revoke all on function public.admin_update_production_file_status_legacy(uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid) to authenticated;
revoke all on function public.admin_reassign_file_production_area_legacy(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) to authenticated;
revoke all on function public.admin_save_design_assets_legacy(uuid, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
