-- orders.delivery_date is text. The previous Semi-Admin command cast a new
-- value to date inside a CASE whose persisted branch is text, so PostgreSQL
-- rejected valid updates before any file metadata could be saved.
-- Keep the same command authorization, foreign-order protections, file
-- validation and audit event; only normalize the date in its native type.

create or replace function public.semi_admin_update_order(
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
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders;
  v_new public.orders;
  v_key text;
  v_file jsonb;
  v_foreign boolean;
  v_materials text[];
  v_termination text;
  v_delivery_date text;
begin
  if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object' then
    raise exception 'Solicitud de edicion invalida.';
  end if;
  if jsonb_typeof(coalesce(p_new_production_files, '[]'::jsonb)) <> 'array' then
    raise exception 'Archivos de producción inválidos.';
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if v_old.status in ('in_Quote', 'cancelled', 'in_Delivered') then
    raise exception 'La orden no puede editarse en su estado actual.';
  end if;

  v_foreign := v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in (
      'client_id', 'client_name', 'client_contact', 'invoice_number',
      'description', 'material', 'termination_type', 'delivery_date',
      'order_file_url', 'preview_image', 'reference_images'
    ) then
      raise exception 'Campo no permitido: %', v_key;
    end if;
    if v_foreign and v_key in ('client_id', 'client_name', 'client_contact') then
      raise exception 'No puedes cambiar el cliente de una orden ajena.';
    end if;
  end loop;

  if p_changes ? 'delivery_date' then
    v_delivery_date := nullif(trim(p_changes ->> 'delivery_date'), '');
    if v_delivery_date is not null
      and v_delivery_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'La fecha de entrega debe tener formato AAAA-MM-DD.';
    end if;
  end if;

  if p_changes ? 'client_id'
    and not exists (
      select 1 from public.clients c
      where c.id = nullif(p_changes ->> 'client_id', '')::uuid
        and c.deleted_at is null
    ) then
    raise exception 'Selecciona un cliente registrado activo.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    client_id = case when p_changes ? 'client_id' then nullif(p_changes ->> 'client_id', '')::uuid else client_id end,
    client_name = case when p_changes ? 'client_name' then p_changes ->> 'client_name' else client_name end,
    client_contact = case when p_changes ? 'client_contact' then p_changes ->> 'client_contact' else client_contact end,
    invoice_number = case when p_changes ? 'invoice_number' then p_changes ->> 'invoice_number' else invoice_number end,
    description = case when p_changes ? 'description' then p_changes ->> 'description' else description end,
    material = case when p_changes ? 'material' then p_changes ->> 'material' else material end,
    termination_type = case when p_changes ? 'termination_type' then p_changes ->> 'termination_type' else termination_type end,
    delivery_date=case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end,
    order_file_url = case when p_changes ? 'order_file_url' then p_changes ->> 'order_file_url' else order_file_url end,
    preview_image = case when p_changes ? 'preview_image' then p_changes ->> 'preview_image' else preview_image end,
    reference_images = case when p_changes ? 'reference_images' then p_changes -> 'reference_images' else reference_images end,
    updated_at = now(),
    updated_by = v_actor
  where id = p_order_id
  returning * into v_new;

  for v_file in
    select value from jsonb_array_elements(coalesce(p_new_production_files, '[]'::jsonb))
  loop
    if nullif(trim(v_file ->> 'url'), '') is null
      or nullif(trim(v_file ->> 'public_label'), '') is null
      or nullif(trim(v_file ->> 'production_area_code'), '') is null then
      raise exception 'Archivo de producción inválido.';
    end if;
    if not exists (
      select 1 from public.production_areas
      where code = trim(v_file ->> 'production_area_code') and is_active = true
    ) then
      raise exception 'Área de producción inválida.';
    end if;

    select public.normalize_production_material_names(array_agg(value))
      into v_materials
      from jsonb_array_elements_text(coalesce(v_file -> 'material_names', '[]'::jsonb)) as item(value);
    v_termination := nullif(trim(v_file ->> 'termination_name'), '');
    if v_termination is null or coalesce(cardinality(v_materials), 0) = 0 then
      raise exception 'Cada archivo de producción requiere material y terminación.';
    end if;

    insert into public.order_production_files(
      order_id, url, filename, public_label, production_area_code,
      material_names, termination_name, status, created_by, updated_by
    ) values (
      p_order_id,
      trim(v_file ->> 'url'),
      coalesce(nullif(trim(v_file ->> 'filename'), ''), 'Archivo'),
      trim(v_file ->> 'public_label'),
      trim(v_file ->> 'production_area_code'),
      v_materials,
      v_termination,
      'pending',
      v_actor,
      v_actor
    )
    on conflict (order_id, url) do update set
      filename = excluded.filename,
      public_label = excluded.public_label,
      production_area_code = excluded.production_area_code,
      material_names = excluded.material_names,
      termination_name = excluded.termination_name,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
  values (
    p_order_id,
    v_actor,
    'semi_admin_order_updated',
    v_old.status,
    v_new.status,
    jsonb_build_object('changes', p_changes, 'foreign_order', v_foreign)
  );
  return v_new;
end;
$$;

revoke all on function public.semi_admin_update_order(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.semi_admin_update_order(uuid, timestamptz, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
