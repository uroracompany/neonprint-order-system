-- A repeated URL in a single semi-admin creation request must update the
-- canonical production-file record instead of violating the unique key.
create or replace function public.semi_admin_create_order_with_client(
  p_idempotency_key uuid, p_order jsonb, p_client jsonb default null,
  p_production_files jsonb default '[]'::jsonb, p_asset_refs jsonb default '[]'::jsonb
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_client_id uuid;
  v_order public.orders;
  v_order_id uuid;
  v_file jsonb;
  v_asset jsonb;
  v_hash text;
  v_command public.order_creation_commands%rowtype;
  v_reservation public.order_asset_preupload_reservations%rowtype;
  v_materials text[];
  v_termination text;
begin
  if p_idempotency_key is null
    or jsonb_typeof(coalesce(p_order, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_production_files, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_asset_refs, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de creacion invalida';
  end if;

  v_hash := md5(coalesce(p_order, '{}'::jsonb)::text || coalesce(p_client, 'null'::jsonb)::text || coalesce(p_production_files, '[]'::jsonb)::text || coalesce(p_asset_refs, '[]'::jsonb)::text);
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

  insert into public.order_creation_commands(actor_id, idempotency_key, request_hash)
    values(v_actor, p_idempotency_key, v_hash);
  v_client_id := nullif(p_order->>'client_id', '')::uuid;
  if v_client_id is null and jsonb_typeof(coalesce(p_client, 'null'::jsonb)) = 'object' then
    if nullif(trim(p_client->>'name'), '') is null or nullif(trim(p_client->>'phone'), '') is null then
      raise exception 'El nuevo cliente requiere nombre y teléfono.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      lower(trim(p_client->>'name')) || '|' || regexp_replace(p_client->>'phone', '\D', '', 'g'), 0));
    select c.id into v_client_id from public.clients c
      where c.deleted_at is null and lower(trim(c.name)) = lower(trim(p_client->>'name'))
        and regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_client->>'phone', '\D', '', 'g')
      limit 1 for update;
    if v_client_id is null then
      insert into public.clients(name, phone, email, address, notes, created_by)
      values (trim(p_client->>'name'), trim(p_client->>'phone'), nullif(trim(p_client->>'email'), ''),
        nullif(trim(p_client->>'address'), ''), nullif(trim(p_client->>'notes'), ''), v_actor)
      returning id into v_client_id;
    end if;
  end if;
  if v_client_id is null or not exists (select 1 from public.clients c where c.id = v_client_id and c.deleted_at is null) then
    raise exception 'Cada orden debe tener un cliente registrado activo.';
  end if;

  v_order_id := coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid());
  perform set_config('app.neonprint_order_command', 'on', true);
  insert into public.orders(id, client_id, client_name, client_contact, invoice_number, description, material,
    termination_type, order_type, order_design_type, delivery_date, status, payment_status, seller_id, created_by,
    order_file_url, preview_image, reference_images, updated_by)
  values (v_order_id, v_client_id, p_order->>'client_name', nullif(p_order->>'client_contact', ''), p_order->>'invoice_number',
    p_order->>'description', p_order->>'material', nullif(p_order->>'termination_type', ''), p_order->>'order_type',
    p_order->>'order_design_type', nullif(p_order->>'delivery_date', '')::date, 'Pending', 'Pending_Payment', v_actor, v_actor,
    p_order->>'order_file_url', p_order->>'preview_image', coalesce(p_order->'reference_images', '[]'::jsonb), v_actor)
  returning * into v_order;

  for v_file in select value from jsonb_array_elements(p_production_files) loop
    if nullif(trim(v_file->>'url'), '') is null
       or nullif(trim(v_file->>'public_label'), '') is null
       or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de producción inválido.';
    end if;
    if not exists (select 1 from public.production_areas where code = trim(v_file->>'production_area_code') and is_active = true) then
      raise exception 'Área de producción inválida.';
    end if;
    select public.normalize_production_material_names(array_agg(value)) into v_materials
      from jsonb_array_elements_text(coalesce(v_file->'material_names', '[]'::jsonb)) as item(value);
    v_termination := nullif(trim(v_file->>'termination_name'), '');
    if v_termination is null or coalesce(cardinality(v_materials), 0) = 0 then
      raise exception 'Cada archivo de producción requiere material y terminación.';
    end if;
    insert into public.order_production_files(
      order_id, url, filename, public_label, production_area_code, material_names, termination_name, status, created_by, updated_by
    ) values (
      v_order_id, trim(v_file->>'url'), coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'),
      trim(v_file->>'public_label'), trim(v_file->>'production_area_code'), v_materials, v_termination, 'pending', v_actor, v_actor
    ) on conflict (order_id, url) do update set
      filename = excluded.filename,
      public_label = excluded.public_label,
      production_area_code = excluded.production_area_code,
      material_names = excluded.material_names,
      termination_name = excluded.termination_name,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  for v_asset in select value from jsonb_array_elements(coalesce(p_asset_refs, '[]'::jsonb)) loop
    if nullif(trim(v_asset->>'bucket'), '') is null
       or nullif(trim(v_asset->>'objectKey'), '') is null
       or (v_asset->>'objectKey') !~ ('^orders/' || v_order_id::text || '/')
       or coalesce(v_asset->>'category', '') not in ('design', 'preview', 'reference')
       or coalesce(v_asset->>'provider', '') not in ('supabase', 'r2')
       or (v_asset->>'provider') = 'supabase' and v_asset->>'bucket' not in ('order-docs', 'order-previews')
       or nullif(trim(v_asset->>'reservationId'), '') is null then
      raise exception 'Referencia de archivo previo inválida.';
    end if;
    select * into v_reservation from public.order_asset_preupload_reservations
      where id = nullif(v_asset->>'reservationId', '')::uuid
        and actor_id = v_actor and order_id = v_order_id and idempotency_key = p_idempotency_key
        and provider = v_asset->>'provider' and bucket = trim(v_asset->>'bucket')
        and object_key = trim(v_asset->>'objectKey') and category = v_asset->>'category'
        and status = 'reserved' and expires_at > now() for update;
    if not found then raise exception 'La reserva del archivo previo no es válida o expiró.'; end if;
    insert into public.order_files(order_id, provider, bucket, object_key, original_filename, content_type, size_bytes, category, status, uploaded_by)
      values(v_order_id, v_asset->>'provider', trim(v_asset->>'bucket'), trim(v_asset->>'objectKey'),
        nullif(trim(v_asset->>'originalFilename'), ''), nullif(trim(v_asset->>'contentType'), ''),
        nullif(v_asset->>'sizeBytes', '')::bigint, v_asset->>'category', 'uploaded', v_actor)
      on conflict(provider, bucket, object_key) do nothing;
    update public.order_asset_preupload_reservations set status = 'bound', bound_at = now() where id = v_reservation.id;
  end loop;

  update public.order_creation_commands set order_id = v_order_id, status = 'completed', updated_at = now()
    where actor_id = v_actor and idempotency_key = p_idempotency_key;
  insert into public.order_events(order_id, actor_id, event_type, changes)
    values (v_order.id, v_actor, 'semi_admin_order_created', jsonb_build_object('role', 'semi_admin', 'client_id', v_client_id));
  return v_order;
end;
$$;

-- Design remains attributable to the person who attached the order assets.
-- The guard uses canonical catalog records and legacy order fields so a client
-- cannot bypass it by calling the responsibility command directly.
create or replace function public.semi_admin_assign_stage_responsibility(
  p_order_id uuid,
  p_stage text,
  p_assignee_id uuid,
  p_expected_updated_at timestamptz,
  p_production_area_code text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_assignee_role text;
  v_previous uuid;
  v_area text := nullif(trim(p_production_area_code), '');
begin
  if p_stage not in ('design', 'quote', 'production', 'delivery') then raise exception 'Etapa inválida.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' or v_order.status in ('cancelled', 'in_Delivered') then raise exception 'La orden no está disponible para reasignación.'; end if;
  select role into v_assignee_role from public.profiles where id = p_assignee_id and coalesce(employment_status, true) and deleted_at is null;
  if v_assignee_role is null then raise exception 'Selecciona un usuario activo.'; end if;

  if p_stage = 'design' then
    if v_order.status not in ('in_Design', 'In_Design') then raise exception 'La responsabilidad de Diseño solo se asigna durante Diseño.'; end if;
    if v_assignee_role not in ('designer', 'semi_admin') then raise exception 'Diseño requiere un Diseñador o Semi-Administrador.'; end if;
    if (
      (nullif(trim(coalesce(v_order.order_file_url, '')), '') is not null and trim(v_order.order_file_url) <> '[]')
      or nullif(trim(coalesce(v_order.preview_image, '')), '') is not null
      or exists (select 1 from public.order_files file where file.order_id = v_order.id and file.category in ('design', 'preview', 'reference') and file.status = 'uploaded' and file.deleted_at is null)
      or exists (select 1 from public.order_production_files file where file.order_id = v_order.id)
    ) then
      raise exception 'No se puede reasignar Diseño mientras la orden tenga archivos u Orden de Trabajo. Elimina todos los archivos antes de reasignar.';
    end if;
    v_previous := v_order.designer_id;
    update public.orders set designer_id = p_assignee_id, updated_by = v_actor, updated_at = now() where id = v_order.id returning * into v_order;
  elsif p_stage = 'quote' then
    if v_order.status <> 'in_Quote' then raise exception 'La responsabilidad de Caja solo se asigna durante Caja.'; end if;
    if v_assignee_role not in ('quote', 'semi_admin') then raise exception 'Caja requiere un usuario de Caja o Semi-Administrador.'; end if;
    v_previous := v_order.quote_id;
    update public.orders set quote_id = p_assignee_id, updated_by = v_actor, updated_at = now() where id = v_order.id returning * into v_order;
  elsif p_stage = 'delivery' then
    if v_order.status <> 'in_Completed' then raise exception 'La responsabilidad de Entrega solo se asigna cuando la orden está completada.'; end if;
    if v_assignee_role not in ('delivery', 'semi_admin') then raise exception 'Entrega requiere un Delivery o Semi-Administrador.'; end if;
    v_previous := v_order.delivery_id;
    update public.orders set delivery_id = p_assignee_id, updated_by = v_actor, updated_at = now() where id = v_order.id returning * into v_order;
  else
    if v_order.status not in ('in_Production', 'in_Termination') or v_area is null then raise exception 'Indica un área participante de Producción.'; end if;
    if not exists(select 1 from public.order_production_files where order_id = v_order.id and production_area_code = v_area) then raise exception 'El área no participa en esta orden.'; end if;
    if v_assignee_role <> 'semi_admin' and not exists(select 1 from public.production_areas where code = v_area and producer_role = v_assignee_role and is_active) then raise exception 'El responsable no pertenece al área seleccionada.'; end if;
    select assigned_to into v_previous from public.order_production_assignments where order_id = v_order.id and production_area_code = v_area for update;
    update public.order_production_assignments set assigned_to = p_assignee_id, assigned_by = v_actor, updated_at = now() where order_id = v_order.id and production_area_code = v_area;
    if not found then insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by) values(v_order.id, v_area, p_assignee_id, v_actor); end if;
    update public.order_production_files set assigned_to = p_assignee_id, updated_by = v_actor, updated_at = now() where order_id = v_order.id and production_area_code = v_area and status <> 'completed';
    update public.orders set updated_by = v_actor, updated_at = now() where id = v_order.id returning * into v_order;
  end if;

  insert into public.order_events(order_id, actor_id, event_type, changes) values(v_order.id, v_actor, 'semi_admin_stage_responsibility_changed', jsonb_build_object('stage', p_stage, 'production_area_code', v_area, 'previous_responsible_id', v_previous, 'responsible_id', p_assignee_id, 'self_assigned', p_assignee_id = v_actor));
  perform public.notify_many(array_remove(array[p_assignee_id], v_actor), 'order_assigned', 'Responsabilidad de etapa asignada', 'Se te asignó la responsabilidad de ' || case p_stage when 'design' then 'Diseño' when 'quote' then 'Caja' when 'delivery' then 'Entrega' else 'Producción (' || v_area || ')' end || '.', v_order.id, jsonb_build_object('event_kind', 'stage_responsibility_assigned', 'stage', p_stage, 'production_area_code', v_area, 'assigned_by', v_actor));
  return v_order;
end;
$$;

revoke all on function public.semi_admin_create_order_with_client(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.semi_admin_create_order_with_client(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.semi_admin_assign_stage_responsibility(uuid, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.semi_admin_assign_stage_responsibility(uuid, text, uuid, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';

