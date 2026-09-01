-- Reference images remain a legacy JSONB list on orders, but their identity,
-- owner and Storage lifecycle live in order_files.  Do not accept URL-only
-- browser mutations: this command validates the manifest before changing it.
create or replace function public.designer_manage_reference_images(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_additions jsonb default '[]'::jsonb,
  p_remove_file_ids uuid[] default '{}'::uuid[]
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
  v_reference_images jsonb;
  v_final_images jsonb := '[]'::jsonb;
  v_addition text;
  v_file public.order_files%rowtype;
  v_removed_file public.order_files%rowtype;
  v_file_id uuid;
  v_removed_ids uuid[] := '{}'::uuid[];
  v_existing_count integer;
begin
  if p_order_id is null or p_expected_updated_at is null
     or jsonb_typeof(coalesce(p_additions, '[]'::jsonb)) <> 'array'
     or coalesce(array_length(p_remove_file_ids, 1), 0) is distinct from (
       select count(distinct value) from unnest(coalesce(p_remove_file_ids, '{}'::uuid[])) value
     ) then
    raise exception 'ORDER_STALE';
  end if;
  -- A nullable optional argument must never turn the complete legacy JSONB
  -- reference list into NULL.  Empty means no additions, not replace all.
  p_additions := coalesce(p_additions, '[]'::jsonb);

  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor
      and p.role = 'designer'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Solo Diseno activo puede gestionar imagenes de referencia.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.designer_id is distinct from v_actor
     or v_order.status <> 'in_Design'
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_designer, false) then
    raise exception 'La orden no esta disponible en Diseno.';
  end if;

  v_reference_images := coalesce(v_order.reference_images, '[]'::jsonb);
  if jsonb_typeof(v_reference_images) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_reference_images) e where jsonb_typeof(e) <> 'string' or nullif(trim(e #>> '{}'), '') is null) then
    raise exception 'Las imagenes de referencia actuales no son validas.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_reference_images) e group by e having count(*) > 1)
     or exists (select 1 from jsonb_array_elements_text(p_additions) e group by e having count(*) > 1) then
    raise exception 'No se permiten imagenes de referencia duplicadas.';
  end if;

  -- Lock every requested removal and prove that it is this designer's own,
  -- currently referenced, canonical reference asset.
  foreach v_file_id in array coalesce(p_remove_file_ids, '{}'::uuid[]) loop
    select * into v_removed_file
    from public.order_files f
    where f.id = v_file_id
      and f.order_id = p_order_id
      and f.category = 'reference'
      and f.status = 'uploaded'
      and f.deleted_at is null
      and f.uploaded_by = v_actor
    for update;
    if not found then
      raise exception 'La imagen de referencia no puede eliminarse.';
    end if;
    if not exists (
      select 1 from jsonb_array_elements_text(v_reference_images) image_ref
      where image_ref = case when v_removed_file.provider = 'supabase'
        then 'supabase://' || v_removed_file.bucket || '/' || v_removed_file.object_key
        else 'r2://' || v_removed_file.bucket || '/' || v_removed_file.object_key end
    ) then
      raise exception 'La imagen de referencia no esta asociada a la orden.';
    end if;
    v_removed_ids := array_append(v_removed_ids, v_removed_file.id);
  end loop;

  -- An upload has already created its manifest through the server gateway.
  -- Accept it only once, only in the reference folder and only from this actor.
  for v_addition in select trim(value) from jsonb_array_elements_text(p_additions) value loop
    if v_addition = '' then raise exception 'La imagen de referencia no es valida.'; end if;
    select * into v_file
    from public.order_files f
    where f.order_id = p_order_id
      and f.category = 'reference'
      and f.status = 'uploaded'
      and f.deleted_at is null
      and (
        (f.provider = 'supabase'
          and f.bucket = 'order-docs'
          and f.object_key like ('orders/' || p_order_id::text || '/ref-images/%'))
        or (f.provider = 'r2'
          and f.object_key like ('orders/' || p_order_id::text || '/reference/%'))
      )
      and f.uploaded_by = v_actor
      and v_addition = case when f.provider = 'supabase'
        then 'supabase://' || f.bucket || '/' || f.object_key
        else 'r2://' || f.bucket || '/' || f.object_key end
    for update;
    if not found then
      raise exception 'La imagen de referencia no tiene un registro seguro.';
    end if;
    if exists (select 1 from jsonb_array_elements_text(v_reference_images) existing_ref where existing_ref = v_addition) then
      raise exception 'La imagen de referencia ya esta asociada a la orden.';
    end if;
  end loop;

  select count(*) into v_existing_count
  from jsonb_array_elements_text(v_reference_images) image_ref
  where not exists (
    select 1 from public.order_files f
    where f.id = any(v_removed_ids)
      and image_ref = case when f.provider = 'supabase'
        then 'supabase://' || f.bucket || '/' || f.object_key
        else 'r2://' || f.bucket || '/' || f.object_key end
  );
  if v_existing_count + jsonb_array_length(p_additions) > 3 then
    raise exception 'Solo se permiten hasta 3 imagenes de referencia por orden.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ref) order by ord), '[]'::jsonb) into v_final_images
  from jsonb_array_elements_text(v_reference_images) with ordinality values_list(ref, ord)
  where not exists (
    select 1 from public.order_files f
    where f.id = any(v_removed_ids)
      and ref = case when f.provider = 'supabase'
        then 'supabase://' || f.bucket || '/' || f.object_key
        else 'r2://' || f.bucket || '/' || f.object_key end
  );
  v_final_images := v_final_images || p_additions;

  foreach v_file_id in array v_removed_ids loop
    select * into v_removed_file from public.order_files where id = v_file_id for update;
    insert into public.order_asset_deletion_outbox(order_id, provider, bucket, target_kind, object_path)
    values (p_order_id, v_removed_file.provider, v_removed_file.bucket, 'object', v_removed_file.object_key)
    on conflict (provider, bucket, target_kind, object_path) do nothing;
    update public.order_files set status = 'deleted', deleted_at = now() where id = v_file_id;
  end loop;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set reference_images = v_final_images,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes)
  values (
    p_order_id, v_actor, 'designer_reference_images_managed', v_order.status, v_updated.status,
    v_order.payment_status, v_updated.payment_status,
    jsonb_build_object('added', p_additions, 'removed_file_ids', to_jsonb(v_removed_ids))
  );
  return v_updated;
end;
$$;

revoke all on function public.designer_manage_reference_images(uuid, timestamptz, jsonb, uuid[]) from public, anon;
grant execute on function public.designer_manage_reference_images(uuid, timestamptz, jsonb, uuid[]) to authenticated;
notify pgrst, 'reload schema';
