-- SemiAdmin file lifecycle management.
-- Allows asset-only edits through the existing audited command while keeping
-- production status/reassignment commands unavailable to SemiAdmin.

-- SemiAdmin file management is limited to active participants and lifecycle states.
create or replace function public.semi_admin_can_manage_order_assets(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or coalesce(v_order.is_archived, false)
     or v_order.operational_status = 'blocked'
     or v_order.status in ('cancelled', 'in_Delivered') then
    return false;
  end if;
  if v_order.status not in ('Pending', 'pending', 'in_Design', 'In_Design', 'in_Quote', 'in_Production', 'in_Termination', 'in_Completed') then
    return false;
  end if;
  return v_order.created_by = v_actor
    or v_order.seller_id = v_actor
    or v_order.designer_id = v_actor
    or v_order.quote_id = v_actor
    or v_order.delivery_id = v_actor;
end;
$$;

revoke all on function public.semi_admin_can_manage_order_assets(uuid) from public, anon, authenticated;

create or replace function public.semi_admin_update_order_with_assets(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb,
  p_removed_file_urls text[] default '{}'::text[],
  p_asset_operation text default null,
  p_asset_removal_only boolean default false
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
  v_old_file_urls jsonb;
  v_old_reference_urls jsonb;
  v_final_file_urls jsonb;
  v_final_reference_urls jsonb;
  v_removed_url text;
  v_is_preview boolean;
  v_is_design boolean;
  v_is_reference boolean;
  v_is_production boolean;
  v_default_bucket text;
  v_existing_file public.order_production_files;
begin
  if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_new_production_files, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de edición de activos inválida.';
  end if;
  if p_asset_operation is not null and p_asset_operation <> 'manage_assets' then
    raise exception 'Operación de activos no permitida.';
  end if;
  if p_asset_removal_only and (
    p_asset_operation is distinct from 'manage_assets'
    or jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) > 0
    or exists (
      select 1 from jsonb_object_keys(p_changes) as key(name)
      where key.name not in ('order_file_url', 'preview_image', 'reference_images')
    )
  ) then
    raise exception 'La eliminación de archivos debe ejecutarse como una operación de activos independiente.';
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if v_old.status not in ('Pending', 'pending', 'in_Design', 'In_Design', 'in_Quote', 'in_Production', 'in_Termination', 'in_Completed') then
    raise exception 'La orden no puede editarse en su estado actual.';
  end if;
  if v_old.status in ('in_Quote', 'in_Production', 'in_Termination', 'in_Completed')
     and p_asset_operation is distinct from 'manage_assets' then
    raise exception 'En esta etapa solo se permiten operaciones de gestión de archivos.';
  end if;
  if v_old.seller_id is distinct from v_actor
     and v_old.created_by is distinct from v_actor
     and v_old.designer_id is distinct from v_actor
     and v_old.quote_id is distinct from v_actor
     and v_old.delivery_id is distinct from v_actor then
    raise exception 'No tienes acceso a gestionar los archivos de esta orden.';
  end if;

  v_foreign := v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor;
  for v_key in select jsonb_object_keys(p_changes) loop
    if p_asset_operation = 'manage_assets'
       and v_key not in ('order_file_url', 'preview_image', 'reference_images') then
      raise exception 'La gestión de archivos solo puede modificar archivos y referencias.';
    end if;
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
    if v_delivery_date is not null and v_delivery_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'La fecha de entrega debe tener formato AAAA-MM-DD.';
    end if;
  end if;
  if p_changes ? 'client_id' and not exists (
    select 1 from public.clients c
    where c.id = nullif(p_changes ->> 'client_id', '')::uuid and c.deleted_at is null
  ) then
    raise exception 'Selecciona un cliente registrado activo.';
  end if;

  v_old_file_urls := coalesce(nullif(v_old.order_file_url, ''), '[]')::jsonb;
  v_old_reference_urls := coalesce(v_old.reference_images, '[]'::jsonb);
  if jsonb_typeof(v_old_file_urls) <> 'array' or jsonb_typeof(v_old_reference_urls) <> 'array' then
    raise exception 'Los archivos guardados de la orden son inválidos.';
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
    delivery_date = case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end,
    order_file_url = case when p_changes ? 'order_file_url' then p_changes ->> 'order_file_url' else order_file_url end,
    preview_image = case when p_changes ? 'preview_image' then nullif(p_changes ->> 'preview_image', '') else preview_image end,
    reference_images = case when p_changes ? 'reference_images' then p_changes -> 'reference_images' else reference_images end,
    updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_new;

  v_final_file_urls := coalesce(nullif(v_new.order_file_url, ''), '[]')::jsonb;
  v_final_reference_urls := coalesce(v_new.reference_images, '[]'::jsonb);
  if jsonb_typeof(v_final_file_urls) <> 'array' or jsonb_typeof(v_final_reference_urls) <> 'array' then
    raise exception 'Los archivos finales de la orden son inválidos.';
  end if;

  -- In productive stages the existing standalone assets are append-only.  A
  -- SemiAdmin may add a new design/reference, but cannot replace or remove a
  -- standalone asset by omitting it from the submitted collection.  Replacing
  -- an existing asset must go through p_removed_file_urls, which is guarded
  -- below and only permits pending production rows.
  if v_old.status in ('in_Production', 'in_Termination', 'in_Completed')
     and p_asset_operation = 'manage_assets' then
    if p_changes ? 'order_file_url' and not (v_old_file_urls <@ v_final_file_urls) then
      raise exception 'El archivo está en proceso y no puede reemplazarse ni eliminarse en esta etapa.';
    end if;
    if p_changes ? 'reference_images' and not (v_old_reference_urls <@ v_final_reference_urls) then
      raise exception 'La imagen de referencia está en proceso y no puede reemplazarse ni eliminarse en esta etapa.';
    end if;
    if p_changes ? 'preview_image'
       and nullif(trim(coalesce(v_old.preview_image, '')), '') is not null
       and v_new.preview_image is distinct from v_old.preview_image then
      raise exception 'La vista previa está en proceso y no puede reemplazarse ni eliminarse en esta etapa.';
    end if;
  end if;

  -- A missing work order is valid only for the explicit removal command.  A
  -- normal save from Gestionar archivos cannot bypass this backend guard.
  if p_changes ? 'preview_image'
    and nullif(trim(coalesce(v_new.preview_image, '')), '') is null
    and not (
      p_asset_removal_only
      and coalesce(array_length(p_removed_file_urls, 1), 0) > 0
      and v_old.preview_image = any(p_removed_file_urls)
    ) then
    raise exception 'La Orden de Trabajo es obligatoria. Adjunta la Orden de Trabajo antes de continuar.';
  end if;

  for v_removed_url in
    select distinct nullif(trim(item), '')
    from unnest(coalesce(p_removed_file_urls, '{}'::text[])) as item
    where nullif(trim(item), '') is not null
  loop
    v_is_preview := v_old.preview_image = v_removed_url;
    v_is_design := exists (select 1 from jsonb_array_elements_text(v_old_file_urls) value where value = v_removed_url);
    v_is_reference := exists (select 1 from jsonb_array_elements_text(v_old_reference_urls) value where value = v_removed_url);
    v_is_production := exists (
      select 1 from public.order_production_files file
      where file.order_id = p_order_id and file.url = v_removed_url
    );
    if not (v_is_preview or v_is_design or v_is_reference or v_is_production) then
      raise exception 'El archivo eliminado no pertenece a esta orden.';
    end if;
    if v_old.status in ('in_Production', 'in_Termination', 'in_Completed')
       and (
         (v_is_production and exists (
           select 1 from public.order_production_files active_file
           where active_file.order_id = p_order_id
             and active_file.url = v_removed_url
             and lower(coalesce(active_file.status, 'pending')) <> 'pending'
         ))
         or (not v_is_production and (v_is_preview or v_is_design or v_is_reference))
       ) then
      raise exception 'El archivo está en proceso y no puede reemplazarse ni eliminarse en esta etapa.';
    end if;
    if (v_is_preview and v_new.preview_image = v_removed_url)
      or (v_is_design and exists (select 1 from jsonb_array_elements_text(v_final_file_urls) value where value = v_removed_url))
      or (v_is_reference and exists (select 1 from jsonb_array_elements_text(v_final_reference_urls) value where value = v_removed_url)) then
      raise exception 'El archivo eliminado sigue adjunto a la orden.';
    end if;

    v_default_bucket := case when v_is_preview then 'order-previews' else 'order-docs' end;
    perform public.enqueue_admin_order_asset_deletion(p_order_id, v_removed_url, v_default_bucket);
    delete from public.order_production_files where order_id = p_order_id and url = v_removed_url;
  end loop;

  for v_file in select value from jsonb_array_elements(coalesce(p_new_production_files, '[]'::jsonb)) loop
    if nullif(trim(v_file ->> 'url'), '') is null
      or nullif(trim(v_file ->> 'public_label'), '') is null
      or nullif(trim(v_file ->> 'production_area_code'), '') is null then
      raise exception 'Archivo de producción inválido.';
    end if;
    if not exists (select 1 from public.production_areas where code = trim(v_file ->> 'production_area_code') and is_active = true) then
      raise exception 'Área de producción inválida.';
    end if;
    select public.normalize_production_material_names(array_agg(value)) into v_materials
      from jsonb_array_elements_text(coalesce(v_file -> 'material_names', '[]'::jsonb)) as item(value);
    v_termination := nullif(trim(v_file ->> 'termination_name'), '');
    if v_termination is null or coalesce(cardinality(v_materials), 0) = 0 then
      raise exception 'Cada archivo de producción requiere material y terminación.';
    end if;
    -- The URL is the immutable identity of a production file.  In active
    -- stages an existing non-pending row can only receive specification or
    -- metadata updates; status/identity fields are never accepted from the
    -- client, so replacing/deleting it still requires the pending-only path.
    if v_old.status in ('in_Production', 'in_Termination', 'in_Completed')
       and exists (
         select 1 from public.order_production_files existing_file
         where existing_file.order_id = p_order_id
           and existing_file.url = trim(v_file ->> 'url')
           and lower(coalesce(existing_file.status, 'pending')) <> 'pending'
       )
       and (v_file ? 'status' or v_file ? 'id' or v_file ? 'order_id') then
      raise exception 'No se puede cambiar la identidad o el estado de un archivo que está en proceso.';
    end if;
    select * into v_existing_file
    from public.order_production_files existing_file
    where existing_file.order_id = p_order_id
      and existing_file.url = trim(v_file ->> 'url')
    for update;
    if found
       and v_old.status in ('in_Production', 'in_Termination', 'in_Completed')
       and lower(coalesce(v_existing_file.status, 'pending')) <> 'pending'
       and v_existing_file.production_area_code is distinct from trim(v_file ->> 'production_area_code') then
      raise exception 'No se puede reasignar el área de un archivo que está en proceso.';
    end if;
    insert into public.order_production_files(
      order_id, url, filename, public_label, production_area_code,
      material_names, termination_name, status, created_by, updated_by
    ) values (
      p_order_id, trim(v_file ->> 'url'), coalesce(nullif(trim(v_file ->> 'filename'), ''), 'Archivo'),
      trim(v_file ->> 'public_label'), trim(v_file ->> 'production_area_code'),
      v_materials, v_termination, 'pending', v_actor, v_actor
    ) on conflict (order_id, url) do update set
      filename = excluded.filename, public_label = excluded.public_label,
      production_area_code = excluded.production_area_code, material_names = excluded.material_names,
      termination_name = excluded.termination_name, updated_by = excluded.updated_by, updated_at = now();
  end loop;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
  values (p_order_id, v_actor, 'semi_admin_order_updated', v_old.status, v_new.status,
    jsonb_build_object('changes', p_changes, 'foreign_order', v_foreign,
      'removed_asset_urls', to_jsonb(coalesce(p_removed_file_urls, '{}'::text[])),
      'asset_operation', p_asset_operation, 'asset_removal_only', p_asset_removal_only));
  return v_new;
end;
$$;

create or replace function public.semi_admin_execute_order_command_base(
  p_order_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_file public.order_production_files;
  v_order public.orders;
  v_result public.orders;
  v_file_result public.order_production_files;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Solicitud Semi-Administrativa inválida.';
  end if;
  if p_action = 'update_order' then
    if jsonb_typeof(coalesce(p_payload -> 'removed_file_urls', '[]'::jsonb)) <> 'array' then
      raise exception 'Las URLs de archivos eliminados son inválidas.';
    end if;
    select * into v_order from public.orders where id = p_order_id;
    if not found then raise exception 'La orden no existe.'; end if;
    if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then
      raise exception 'La orden está archivada o bloqueada.';
    end if;
    if not public.semi_admin_can_manage_order_assets(p_order_id) then
      raise exception 'No tienes acceso a gestionar los archivos de esta orden.';
    end if;
    select * into v_result from public.semi_admin_update_order_with_assets(
      p_order_id, p_expected_updated_at,
      coalesce(p_payload -> 'changes', '{}'::jsonb),
      coalesce(p_payload -> 'new_production_files', '[]'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'removed_file_urls', '[]'::jsonb))), '{}'::text[]),
      nullif(p_payload ->> 'asset_operation', ''),
      coalesce((p_payload ->> 'asset_removal_only')::boolean, false)
    );
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action = 'stage_responsibility' then
    select * into v_result from public.semi_admin_assign_stage_responsibility(p_order_id, p_payload->>'stage', nullif(p_payload->>'assignee_id', '')::uuid, p_expected_updated_at, nullif(p_payload->>'production_area_code', ''));
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action in ('send_to_designer', 'send_to_quote') then
    select * into v_result from public.semi_admin_transition_order(p_order_id, p_action, nullif(p_payload->>'target_user_id', '')::uuid, null, p_expected_updated_at);
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action = 'send_design_to_quote' then
    select * into v_result from public.semi_admin_send_design_to_quote(p_order_id, nullif(p_payload->>'quote_id', '')::uuid, p_expected_updated_at);
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action = 'return_design_to_sales' then
    select * into v_result from public.semi_admin_return_design_to_sales(p_order_id, p_payload->>'reason', p_expected_updated_at);
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action in ('set_payment', 'mark_credit', 'route_production', 'production_specifications') then
    if not public.semi_admin_can_operate_stage(p_order_id, 'quote', null) then raise exception 'Asígnate como responsable de Caja antes de operar esta etapa.'; end if;
    if p_action = 'set_payment' then
      select * into v_result from public.semi_admin_set_order_payment(p_order_id, p_payload->>'payment_status', nullif(p_payload->>'invoice_payment', ''), p_expected_updated_at);
    elsif p_action = 'mark_credit' then
      select * into v_result from public.semi_admin_mark_order_credit(p_order_id, nullif(p_payload->>'due_date', '')::timestamptz, p_expected_updated_at);
    elsif p_action = 'route_production' then
      select * into v_result from public.semi_admin_route_order_to_production_v2(p_order_id, coalesce(p_payload->'area_assignments', '{}'::jsonb), p_expected_updated_at);
    else
      select * into v_result from public.semi_admin_save_order_production_file_specifications(p_order_id, p_expected_updated_at, coalesce(p_payload->'specifications', '[]'::jsonb));
    end if;
    return jsonb_build_object('order', to_jsonb(v_result));
  elsif p_action in ('production_file_status', 'reassign_production_file') then
    select * into v_file from public.order_production_files where id = nullif(p_payload->>'file_id', '')::uuid;
    if not found or v_file.order_id <> p_order_id then raise exception 'El archivo no pertenece a la orden.'; end if;
    if p_action = 'production_file_status' then
      if not public.semi_admin_can_operate_stage(p_order_id, 'production', v_file.production_area_code) then raise exception 'Asígnate como responsable de esta área antes de registrar avances.'; end if;
      select * into v_file_result from public.semi_admin_update_production_file_status_v2(v_file.id, p_payload->>'next_status', p_expected_updated_at, nullif(p_payload->>'delivery_id', '')::uuid);
    else
      select * into v_file_result from public.semi_admin_reassign_file_production_area_v2(v_file.id, p_payload->>'new_area_code', nullif(p_payload->>'new_assigned_user_id', '')::uuid, p_expected_updated_at);
    end if;
    return jsonb_build_object('file', to_jsonb(v_file_result));
  elsif p_action = 'mark_delivered' then
    if not public.semi_admin_can_operate_stage(p_order_id, 'delivery', null) then raise exception 'Asígnate como responsable de Entrega antes de confirmar la entrega.'; end if;
    select * into v_result from public.semi_admin_mark_order_delivered(p_order_id, nullif(p_payload->>'delivery_note', ''), p_expected_updated_at);
    return jsonb_build_object('order', to_jsonb(v_result));
  end if;
  raise exception 'Acción Semi-Administrativa no permitida.';
end;
$$;

create or replace function public.semi_admin_execute_order_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_assignee uuid;
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
begin
  if p_action = 'register_payment' then
    select * into v_new from public.semi_admin_register_order_payment(
      p_order_id, p_payload->>'payment_status', nullif(p_payload->>'invoice_payment', ''), nullif(p_payload->>'invoice_number', ''), p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_new));
  end if;
  if p_action = 'update_order' then
    select * into v_new from public.semi_admin_update_order_with_assets(
      p_order_id,
      p_expected_updated_at,
      coalesce(p_payload -> 'changes', '{}'::jsonb),
      coalesce(p_payload -> 'new_production_files', '[]'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'removed_file_urls', '[]'::jsonb))), '{}'::text[]),
      nullif(p_payload ->> 'asset_operation', ''),
      coalesce((p_payload ->> 'asset_removal_only')::boolean, false)
    );
    return jsonb_build_object('order', to_jsonb(v_new));
  end if;
  if p_action in ('set_payment', 'mark_credit') then raise exception 'Usa el comando de pago autorizado.'; end if;
  if p_action in ('production_file_status', 'reassign_production_file', 'production_specifications', 'manage_specifications', 'manage_design_assets')
     or (p_action = 'stage_responsibility' and p_payload->>'stage' = 'production') then
    raise exception 'Semi-Administración no puede gestionar Producción.';
  end if;

  if p_action in ('return_quote_to_design', 'stage_responsibility') then
    select * into v_old from public.orders where id = p_order_id for update;
    if not found then raise exception 'La orden no existe.'; end if;
    if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
    if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' or v_old.status = 'cancelled' then raise exception 'La orden no está disponible.'; end if;
    if v_old.designer_id is distinct from v_actor and v_old.quote_id is distinct from v_actor
       and v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor then raise exception 'No tienes acceso a esta orden.'; end if;

    if p_action = 'return_quote_to_design' then
      if v_old.status <> 'in_Quote' or v_old.payment_status <> 'Pending_Payment' then raise exception 'Solo Caja con pago pendiente puede regresar la orden a Diseño.'; end if;
      if v_old.designer_id is null then raise exception 'La orden requiere un diseñador asignado antes de regresar a Diseño.'; end if;
      if v_reason is null or char_length(v_reason) < 10 then raise exception 'Indica un motivo de al menos 10 caracteres.'; end if;
      perform set_config('app.neonprint_order_command', 'on', true);
      update public.orders set status = 'in_Design', return_reason = v_reason, updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_new;
      insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
      values (p_order_id, v_actor, 'semi_admin_return_quote_to_design', v_old.status, v_new.status,
        jsonb_build_object('reason', v_reason, 'old_designer_id', v_old.designer_id, 'new_designer_id', v_new.designer_id));
      return jsonb_build_object('order', to_jsonb(v_new));
    end if;

    if p_payload->>'stage' = 'quote' then
      if v_old.status <> 'in_Quote' or v_old.payment_status <> 'Pending_Payment' then raise exception 'La responsabilidad de Caja solo cambia con pago pendiente.'; end if;
      v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
      if v_assignee is null or not exists (select 1 from public.profiles p where p.id = v_assignee and p.role in ('quote', 'semi_admin') and coalesce(p.employment_status, true) and p.deleted_at is null) then
        raise exception 'Selecciona un responsable activo de Caja.';
      end if;
      perform set_config('app.neonprint_order_command', 'on', true);
      update public.orders set quote_id = v_assignee, updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_new;
      insert into public.order_events(order_id, actor_id, event_type, changes)
      values (p_order_id, v_actor, 'semi_admin_stage_responsibility_changed',
        jsonb_build_object('stage', 'quote', 'previous_responsible_id', v_old.quote_id, 'responsible_id', v_new.quote_id, 'self_assigned', v_new.quote_id = v_actor));
      return jsonb_build_object('order', to_jsonb(v_new));
    end if;
  end if;
  return public.semi_admin_execute_order_command_base(p_order_id, p_action, p_payload, p_expected_updated_at);
end;
$$;

create or replace function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_catalog jsonb;
  v_actions jsonb;
  v_unavailable jsonb;
  v_responsible boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  v_catalog := public.semi_admin_get_order_command_catalog_base(p_order_id);
  if coalesce((v_catalog->>'locked')::boolean, false) then return v_catalog; end if;
  v_responsible := v_order.designer_id = v_actor or v_order.quote_id = v_actor or v_order.seller_id = v_actor or v_order.created_by = v_actor;
  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
  from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) action
  where action->>'key' not in ('register_payment', 'grant_credit');
  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_unavailable
  from jsonb_array_elements(coalesce(v_catalog->'unavailable_actions', '[]'::jsonb)) action;

  if v_order.status = 'in_Quote' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action
    where action->>'key' not in ('manage_specifications', 'manage_design_assets', 'production_file_status', 'reassign_production_file', 'manage_production', 'stage_responsibility', 'return_quote_to_design')
      and (v_order.payment_status in ('pagado', 'parcial', 'credito') or action->>'key' <> 'route_production');
    if v_responsible and not coalesce(v_order.is_archived, false) and v_order.operational_status is distinct from 'blocked' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'register_payment', 'title', 'Gestionar pago'));
      if v_order.payment_status = 'Pending_Payment' then
        v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'stage_responsibility', 'title', 'Cambiar responsable de Caja'));
        if v_order.designer_id is not null then
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'return_quote_to_design', 'title', 'Regresar a Diseño'));
        else
          v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'return_quote_to_design', 'title', 'Regresar a Diseño', 'next_safe_step', 'Asigna un diseñador antes de regresar la orden.'));
        end if;
      end if;
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'payment_operations', 'title', 'Gestión de pago', 'next_safe_step', 'Solo el responsable o creador Semi-Admin puede gestionar Caja.'));
    end if;
    if v_order.payment_status = 'Pending_Payment' then
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'route_production', 'title', 'Preparación para Producción', 'next_safe_step', 'Registra el pago antes de preparar el envío a Producción.'));
    end if;
  elsif v_catalog->>'active_stage' = 'production' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions from jsonb_array_elements(v_actions) action
    where action->>'key' not in ('stage_responsibility', 'reassign_production_file', 'manage_production', 'production_file_status');
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'production_operations', 'title', 'Producción', 'next_safe_step', 'Producción se gestiona exclusivamente por el operador asignado.'));
  end if;
  if public.semi_admin_can_manage_order_assets(p_order_id)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(v_actions, '[]'::jsonb)) action
       where action->>'key' = 'manage_design_assets'
     ) then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'key', 'manage_design_assets',
      'title', 'Gestionar diseños y archivos'
    ));
  end if;
  return jsonb_set(jsonb_set(v_catalog, '{actions}', v_actions, true), '{unavailable_actions}', v_unavailable, true);
end;
$$;

revoke all on function public.semi_admin_update_order_with_assets(uuid,timestamptz,jsonb,jsonb,text[],text,boolean) from public, anon, authenticated;
revoke all on function public.semi_admin_execute_order_command_base(uuid,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz), public.semi_admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz), public.semi_admin_get_order_command_catalog(uuid) to authenticated;

notify pgrst, 'reload schema';
