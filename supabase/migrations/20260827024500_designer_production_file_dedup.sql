-- The legacy order_file_url trigger creates the production-file row before this
-- command reaches its explicit metadata insert. Treat that expected row as the
-- same logical asset, while retaining the designer's routing metadata.
create or replace function public.designer_update_order_assets(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_file jsonb;
  v_key text;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles
    where id = v_actor and role = 'designer' and coalesce(employment_status, true)
  ) then
    raise exception 'Solo Diseno puede actualizar archivos';
  end if;

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
  if not found
    or v_order.designer_id is distinct from v_actor
    or v_order.status <> 'in_Design'
    or coalesce(v_order.is_archived, false) then
    raise exception 'La orden no esta disponible en Diseno';
  end if;

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set order_file_url = case when p_changes ? 'order_file_url' then p_changes->>'order_file_url' else order_file_url end,
      preview_image = case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,
      reference_images = case when p_changes ? 'reference_images' then p_changes->'reference_images' else reference_images end,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  for v_file in select value from jsonb_array_elements(p_new_production_files) loop
    if nullif(trim(v_file->>'url'), '') is null
      or nullif(trim(v_file->>'public_label'), '') is null
      or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de produccion invalido';
    end if;

    insert into public.order_production_files (
      order_id, url, filename, public_label, production_area_code,
      status, created_by, updated_by
    ) values (
      p_order_id,
      trim(v_file->>'url'),
      coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'),
      trim(v_file->>'public_label'),
      trim(v_file->>'production_area_code'),
      'pending',
      v_actor,
      v_actor
    ) on conflict (order_id, url) do update
      set filename = excluded.filename,
          public_label = excluded.public_label,
          production_area_code = excluded.production_area_code,
          updated_by = excluded.updated_by,
          updated_at = now();
  end loop;

  return v_updated;
end;
$$;
