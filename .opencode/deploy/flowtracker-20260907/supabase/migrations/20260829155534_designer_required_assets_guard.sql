-- A design-stage order may lose either mandatory asset while it is being
-- corrected.  The removals remain explicit, versioned commands and Storage is
-- cleaned only through the existing durable outbox.

create or replace function public.designer_remove_order_preview(
  p_order_id uuid,
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
  v_preview public.order_files%rowtype;
  v_updated public.orders%rowtype;
begin
  if p_order_id is null or p_expected_updated_at is null then
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
    raise exception 'Solo Diseno activo puede retirar la orden de trabajo.';
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
  if nullif(trim(coalesce(v_order.preview_image, '')), '') is null then
    raise exception 'La orden no tiene una orden de trabajo para retirar.';
  end if;

  select f.* into v_preview
  from public.order_files f
  where f.order_id = p_order_id
    and f.category = 'preview'
    and f.status = 'uploaded'
    and f.deleted_at is null
    and f.bucket = 'order-previews'
    and f.object_key like ('orders/' || p_order_id::text || '/preview/%')
    and (
      ('r2://' || f.bucket || '/' || f.object_key) = v_order.preview_image
      or ('supabase://' || f.bucket || '/' || f.object_key) = v_order.preview_image
      or (
        f.provider = 'supabase'
        and f.object_key = regexp_replace(
          v_order.preview_image,
          '^https?://[^/]+/storage/v1/object/(?:public|sign)/order-previews/([^?]+).*$',
          '\1'
        )
      )
    )
  limit 1
  for update;

  if not found then
    raise exception 'La orden de trabajo no tiene un registro seguro de almacenamiento.';
  end if;

  perform public.enqueue_admin_order_asset_deletion(
    p_order_id,
    v_order.preview_image,
    'order-previews'
  );

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set preview_image = null,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  insert into public.order_events(
    order_id, actor_id, event_type, old_status, new_status,
    old_payment_status, new_payment_status, changes
  ) values (
    p_order_id, v_actor, 'designer_preview_removed', v_order.status, v_updated.status,
    v_order.payment_status, v_updated.payment_status,
    jsonb_build_object('file_id', v_preview.id, 'url', v_order.preview_image)
  );

  return v_updated;
end;
$$;

-- The client predicate is only a usability aid.  This command is the final
-- authority before a design order advances to Caja.
create or replace function public.designer_send_order_to_quote(
  p_order_id uuid,
  p_quote_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_file_urls jsonb;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'designer'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Solo Diseno activo puede enviar a Caja';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
     or v_order.designer_id is distinct from v_actor
     or v_order.status <> 'in_Design'
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_designer, false) then
    raise exception 'La orden no esta disponible en Diseno';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_quote_id
      and p.role = 'quote'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Caja no disponible';
  end if;

  if nullif(trim(coalesce(v_order.preview_image, '')), '') is null
     or not exists (
       select 1
       from public.order_files f
       where f.order_id = p_order_id
         and f.category = 'preview'
         and f.status = 'uploaded'
         and f.deleted_at is null
         and f.bucket = 'order-previews'
         and f.object_key like ('orders/' || p_order_id::text || '/preview/%')
         and (
           ('r2://' || f.bucket || '/' || f.object_key) = v_order.preview_image
           or ('supabase://' || f.bucket || '/' || f.object_key) = v_order.preview_image
           or (
             f.provider = 'supabase'
             and f.object_key = regexp_replace(
               v_order.preview_image,
               '^https?://[^/]+/storage/v1/object/(?:public|sign)/order-previews/([^?]+).*$',
                '\1'
             )
           )
         )
     ) then
    raise exception 'Falta una orden de trabajo valida. Adjuntala antes de enviar a Caja.';
  end if;

  v_file_urls := case
    when nullif(trim(coalesce(v_order.order_file_url, '')), '') is null then '[]'::jsonb
    when left(trim(v_order.order_file_url), 1) = '[' then v_order.order_file_url::jsonb
    else jsonb_build_array(v_order.order_file_url)
  end;
  if jsonb_typeof(v_file_urls) <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements_text(v_file_urls) item(value)
       join public.order_production_files pf
         on pf.order_id = p_order_id
        and pf.url = item.value
       join public.order_files f
         on f.order_id = p_order_id
        and f.category = 'design'
        and f.status = 'uploaded'
        and f.deleted_at is null
        and (
          f.id = pf.order_file_id
          or ('r2://' || f.bucket || '/' || f.object_key) = pf.url
          or ('supabase://' || f.bucket || '/' || f.object_key) = pf.url
        )
     ) then
    raise exception 'Falta un archivo de diseno valido. Adjuntalo antes de enviar a Caja.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'in_Quote',
      quote_id = p_quote_id,
      return_reason = null,
      returned_to_designer_at = null,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  return v_updated;
end;
$$;

-- The generic asset command is additive only. Persisted removals and preview
-- replacement must go through their dedicated audited commands above.
create or replace function public.designer_update_order_assets(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_current_urls jsonb;
  v_next_urls jsonb;
  v_current_references jsonb;
  v_next_references jsonb;
  v_file jsonb;
  v_url text;
  v_key text;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'designer'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo Diseno activo puede actualizar archivos.'; end if;
  if p_expected_updated_at is null
     or jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_new_production_files, '[]'::jsonb)) <> 'array' then
    raise exception 'ORDER_STALE';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('order_file_url', 'preview_image', 'reference_images') then
      raise exception 'Campo no permitido: %', v_key;
    end if;
  end loop;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.designer_id is distinct from v_actor
     or v_order.status <> 'in_Design' or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_designer, false) then
    raise exception 'La orden no esta disponible en Diseno.';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;

  v_current_urls := case when nullif(trim(coalesce(v_order.order_file_url, '')), '') is null then '[]'::jsonb
    when left(trim(v_order.order_file_url), 1) = '[' then v_order.order_file_url::jsonb
    else jsonb_build_array(v_order.order_file_url) end;
  v_next_urls := case when p_changes ? 'order_file_url' then p_changes->'order_file_url' else v_current_urls end;
  -- Existing clients send this legacy field as JSON text inside p_changes. Keep
  -- accepting only a text value that itself decodes to an array; all other
  -- shapes remain rejected below.
  if jsonb_typeof(v_next_urls) = 'string' then
    begin
      v_next_urls := (v_next_urls #>> '{}')::jsonb;
    exception when others then
      raise exception 'Los archivos de diseno no son validos.';
    end;
  end if;
  if jsonb_typeof(v_current_urls) <> 'array' or jsonb_typeof(v_next_urls) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_next_urls) item where jsonb_typeof(item) <> 'string') then
    raise exception 'Los archivos de diseno no son validos.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_current_urls) old_item(value)
    where not exists (select 1 from jsonb_array_elements_text(v_next_urls) next_item(value) where next_item.value = old_item.value)) then
    raise exception 'Usa el comando de retirada para eliminar un archivo existente.';
  end if;

  for v_file in select value from jsonb_array_elements(p_new_production_files) loop
    v_url := nullif(trim(v_file->>'url'), '');
    if v_url is null or nullif(trim(v_file->>'public_label'), '') is null
       or nullif(trim(v_file->>'production_area_code'), '') is null
       or exists (select 1 from jsonb_array_elements_text(v_current_urls) item(value) where item.value = v_url)
       or not exists (select 1 from jsonb_array_elements_text(v_next_urls) item(value) where item.value = v_url)
       or not exists (select 1 from public.order_files f where f.order_id = p_order_id
         and f.category = 'design' and f.status = 'uploaded' and f.deleted_at is null
         and f.bucket = 'order-docs' and f.object_key like ('orders/' || p_order_id::text || '/files/%')
         and (('r2://' || f.bucket || '/' || f.object_key) = v_url
           or ('supabase://' || f.bucket || '/' || f.object_key) = v_url)) then
      raise exception 'Archivo de diseno invalido o no asociado a la orden.';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements_text(v_next_urls) item(value)
    where not exists (select 1 from jsonb_array_elements_text(v_current_urls) old_item(value) where old_item.value = item.value)
      and not exists (select 1 from jsonb_array_elements(p_new_production_files) new_file where nullif(trim(new_file.value->>'url'), '') = item.value)) then
    raise exception 'Los nuevos archivos deben incluir su metadata de produccion.';
  end if;

  if p_changes ? 'preview_image' and nullif(trim(coalesce(v_order.preview_image, '')), '') is not null
     and (p_changes->>'preview_image') is distinct from v_order.preview_image then
    raise exception 'Usa el comando de retirada para reemplazar la orden de trabajo existente.';
  end if;
  if p_changes ? 'preview_image' and nullif(trim(coalesce(p_changes->>'preview_image', '')), '') is not null
     and not exists (select 1 from public.order_files f where f.order_id = p_order_id
       and f.category = 'preview' and f.status = 'uploaded' and f.deleted_at is null
       and f.bucket = 'order-previews' and f.object_key like ('orders/' || p_order_id::text || '/preview/%')
       and (('r2://' || f.bucket || '/' || f.object_key) = p_changes->>'preview_image'
         or ('supabase://' || f.bucket || '/' || f.object_key) = p_changes->>'preview_image')) then
    raise exception 'La orden de trabajo no tiene un registro seguro de almacenamiento.';
  end if;

  v_current_references := coalesce(v_order.reference_images, '[]'::jsonb);
  v_next_references := case when p_changes ? 'reference_images' then p_changes->'reference_images' else v_current_references end;
  if jsonb_typeof(v_current_references) <> 'array' or jsonb_typeof(v_next_references) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_next_references) item where jsonb_typeof(item) <> 'string')
     or exists (select 1 from jsonb_array_elements_text(v_current_references) old_item(value)
       where not exists (select 1 from jsonb_array_elements_text(v_next_references) next_item(value) where next_item.value = old_item.value)) then
    raise exception 'Usa el comando de retirada para eliminar una referencia existente.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_next_references) item(value)
    where not exists (select 1 from jsonb_array_elements_text(v_current_references) old_item(value) where old_item.value = item.value)
      and not exists (select 1 from public.order_files f where f.order_id = p_order_id
        and f.category = 'reference' and f.status = 'uploaded' and f.deleted_at is null
        and (('r2://' || f.bucket || '/' || f.object_key) = item.value
          or ('supabase://' || f.bucket || '/' || f.object_key) = item.value))) then
    raise exception 'La referencia no tiene un registro seguro de almacenamiento.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set order_file_url = case when p_changes ? 'order_file_url' then v_next_urls::text else order_file_url end,
    preview_image = case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,
    reference_images = case when p_changes ? 'reference_images' then v_next_references else reference_images end,
    updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_updated;
  for v_file in select value from jsonb_array_elements(p_new_production_files) loop
    insert into public.order_production_files(order_id, url, filename, public_label, production_area_code, status, created_by, updated_by)
    values (p_order_id, trim(v_file->>'url'), coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'), trim(v_file->>'public_label'), trim(v_file->>'production_area_code'), 'pending', v_actor, v_actor)
    on conflict (order_id, url) do update set filename = excluded.filename, public_label = excluded.public_label,
      production_area_code = excluded.production_area_code, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return v_updated;
end;
$$;

revoke all on function public.designer_remove_order_preview(uuid, timestamptz) from public, anon;
grant execute on function public.designer_remove_order_preview(uuid, timestamptz) to authenticated;
revoke all on function public.designer_send_order_to_quote(uuid, uuid) from public, anon;
grant execute on function public.designer_send_order_to_quote(uuid, uuid) to authenticated;
revoke all on function public.designer_update_order_assets(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.designer_update_order_assets(uuid, timestamptz, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
