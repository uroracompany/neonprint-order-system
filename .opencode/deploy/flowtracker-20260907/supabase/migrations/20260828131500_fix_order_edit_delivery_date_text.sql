-- `orders.delivery_date` is text in the canonical schema. Keep every branch of
-- these edit commands text-typed; casting only validates the user supplied
-- representation and must never be mixed with the persisted column in CASE.

create or replace function public.seller_update_order(
  p_order_id uuid, p_expected_updated_at timestamptz, p_changes jsonb
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_key text;
  v_delivery_date text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id = v_actor and role = 'seller' and coalesce(employment_status, true)) then raise exception 'Solo Ventas puede editar esta orden'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object' then raise exception 'Cambios invalidos'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('client_id','client_name','client_contact','invoice_number','description','material','termination_type','delivery_date','order_file_url','preview_image','reference_images') then raise exception 'Campo no permitido: %', v_key; end if;
  end loop;
  if p_changes ? 'delivery_date' then
    v_delivery_date := nullif(trim(p_changes->>'delivery_date'), '');
    if v_delivery_date is not null and v_delivery_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'La fecha de entrega debe tener formato AAAA-MM-DD.'; end if;
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor then raise exception 'No tienes acceso a esta orden'; end if;
  if coalesce(v_order.is_archived, false) or v_order.status in ('in_Quote', 'cancelled', 'in_Delivered') then raise exception 'La orden no puede editarse en este estado'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    client_id = case when p_changes ? 'client_id' then nullif(p_changes->>'client_id','')::uuid else client_id end,
    client_name = case when p_changes ? 'client_name' then p_changes->>'client_name' else client_name end,
    client_contact = case when p_changes ? 'client_contact' then p_changes->>'client_contact' else client_contact end,
    invoice_number = case when p_changes ? 'invoice_number' then p_changes->>'invoice_number' else invoice_number end,
    description = case when p_changes ? 'description' then p_changes->>'description' else description end,
    material = case when p_changes ? 'material' then p_changes->>'material' else material end,
    termination_type = case when p_changes ? 'termination_type' then p_changes->>'termination_type' else termination_type end,
    delivery_date = case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end,
    order_file_url = case when p_changes ? 'order_file_url' then p_changes->>'order_file_url' else order_file_url end,
    preview_image = case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,
    reference_images = case when p_changes ? 'reference_images' then p_changes->'reference_images' else reference_images end,
    updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_updated;
  return v_updated;
end;
$$;

create or replace function public.seller_update_order_with_files(
  p_order_id uuid, p_expected_updated_at timestamptz, p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb, p_removed_file_urls text[] default '{}'::text[]
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_file jsonb;
  v_key text;
  v_delivery_date text;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and role = 'seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede editar esta orden'; end if;
  if p_expected_updated_at is null or jsonb_typeof(coalesce(p_changes,'{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_new_production_files,'[]'::jsonb)) <> 'array' then raise exception 'ORDER_STALE'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('client_id','client_name','client_contact','invoice_number','description','material','termination_type','delivery_date','order_file_url','preview_image','reference_images') then raise exception 'Campo no permitido: %', v_key; end if;
  end loop;
  if p_changes ? 'delivery_date' then
    v_delivery_date := nullif(trim(p_changes->>'delivery_date'), '');
    if v_delivery_date is not null and v_delivery_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'La fecha de entrega debe tener formato AAAA-MM-DD.'; end if;
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if coalesce(v_order.is_archived,false) or v_order.status in ('in_Quote', 'cancelled', 'in_Delivered') then raise exception 'La orden no puede editarse en este estado'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set
    client_id = case when p_changes ? 'client_id' then nullif(p_changes->>'client_id','')::uuid else client_id end,
    client_name = case when p_changes ? 'client_name' then p_changes->>'client_name' else client_name end,
    client_contact = case when p_changes ? 'client_contact' then p_changes->>'client_contact' else client_contact end,
    invoice_number = case when p_changes ? 'invoice_number' then p_changes->>'invoice_number' else invoice_number end,
    description = case when p_changes ? 'description' then p_changes->>'description' else description end,
    material = case when p_changes ? 'material' then p_changes->>'material' else material end,
    termination_type = case when p_changes ? 'termination_type' then p_changes->>'termination_type' else termination_type end,
    delivery_date = case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end,
    order_file_url = case when p_changes ? 'order_file_url' then p_changes->>'order_file_url' else order_file_url end,
    preview_image = case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,
    reference_images = case when p_changes ? 'reference_images' then p_changes->'reference_images' else reference_images end,
    updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_updated;
  for v_file in select value from jsonb_array_elements(p_new_production_files) loop
    if nullif(trim(v_file->>'url'),'') is null or nullif(trim(v_file->>'public_label'),'') is null or nullif(trim(v_file->>'production_area_code'),'') is null then raise exception 'Archivo de produccion invalido'; end if;
    insert into public.order_production_files(order_id,url,filename,public_label,production_area_code,status,created_by,updated_by)
    values (p_order_id,trim(v_file->>'url'),coalesce(nullif(trim(v_file->>'filename'),''),'Archivo'),trim(v_file->>'public_label'),trim(v_file->>'production_area_code'),'pending',v_actor,v_actor);
  end loop;
  if coalesce(array_length(p_removed_file_urls,1),0) > 0 then
    insert into public.order_asset_deletion_outbox(order_id,provider,bucket,target_kind,object_path)
    select p_order_id, case when f.url like 'r2://%' then 'r2' else 'supabase' end, 'order-docs', 'object',
      case when f.url like 'r2://%' then split_part(f.url,'/',4) else regexp_replace(f.url, '^.*/order-docs/', '') end
    from public.order_production_files f where f.order_id = p_order_id and f.url = any(p_removed_file_urls)
    on conflict (provider,bucket,target_kind,object_path) do nothing;
    delete from public.order_production_files where order_id = p_order_id and url = any(p_removed_file_urls);
  end if;
  return v_updated;
end;
$$;

revoke all on function public.seller_update_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.seller_update_order(uuid, timestamptz, jsonb) to authenticated;
revoke all on function public.seller_update_order_with_files(uuid, timestamptz, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.seller_update_order_with_files(uuid, timestamptz, jsonb, jsonb, text[]) to authenticated;

-- The legacy advanced command also owns commercial requirement changes. Route
-- those two actions through a text-safe implementation instead of allowing its
-- historical date/text expression to reject every edit at SQL parse time.
create or replace function public.admin_update_order_requirements_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_existing jsonb;
  v_result jsonb;
  v_changes jsonb := coalesce(p_payload->'changes', '{}'::jsonb);
  v_target_type text;
  v_impact text;
  v_delivery_date text;
  v_revision integer;
  v_started_at timestamptz := clock_timestamp();
  v_request_hash text := md5(concat_ws('|', p_order_id::text, p_action, coalesce(p_payload, '{}'::jsonb)::text, p_reason_category, p_reason_detail));
begin
  if p_action not in ('reclassify_design', 'update_requirements') then raise exception 'Accion administrativa no compatible.'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoria de motivo valida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.'; end if;
  if jsonb_typeof(v_changes) <> 'object' then raise exception 'Los cambios de requisitos deben ser un objeto.'; end if;

  select result into v_existing from public.admin_order_command_executions where idempotency_key = p_idempotency_key;
  if found then
    if v_existing is null then raise exception 'El comando ya esta en proceso.'; end if;
    return v_existing;
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.'; end if;
  v_target_type := coalesce(p_payload->>'design_type', v_old.order_design_type);
  v_impact := coalesce(p_payload->>'impact_mode', 'preserve_stage');
  if v_target_type not in ('INTERNAL_DESING', 'EXTERNAL_DESING') then raise exception 'Selecciona un tipo de diseno valido.'; end if;
  if v_impact not in ('preserve_stage', 'restart_flow') then raise exception 'Selecciona un impacto valido.'; end if;
  if v_changes ? 'delivery_date' then
    v_delivery_date := nullif(trim(v_changes->>'delivery_date'), '');
    if v_delivery_date is not null and v_delivery_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'La fecha de entrega debe tener formato AAAA-MM-DD.'; end if;
  end if;

  insert into public.admin_order_command_executions(idempotency_key, order_id, actor_id, action, request_hash)
  values (p_idempotency_key, p_order_id, v_actor, p_action, v_request_hash);
  select coalesce(max(revision_number), 0) + 1 into v_revision from public.order_requirement_revisions where order_id = p_order_id;
  insert into public.order_requirement_revisions(order_id, revision_number, actor_id, reason_category, reason_detail, impact_mode, previous_values, new_values)
  values (
    p_order_id, v_revision, v_actor, p_reason_category, trim(p_reason_detail), v_impact,
    jsonb_build_object('description', v_old.description, 'material', v_old.material, 'termination_type', v_old.termination_type, 'delivery_date', v_old.delivery_date, 'order_design_type', v_old.order_design_type),
    v_changes || jsonb_build_object('order_design_type', v_target_type)
  );

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    client_id = case when v_changes ? 'client_id' then nullif(v_changes->>'client_id', '')::uuid else client_id end,
    client_name = case when v_changes ? 'client_name' then v_changes->>'client_name' else client_name end,
    client_contact = case when v_changes ? 'client_contact' then v_changes->>'client_contact' else client_contact end,
    invoice_number = case when v_changes ? 'invoice_number' then v_changes->>'invoice_number' else invoice_number end,
    description = case when v_changes ? 'description' then v_changes->>'description' else description end,
    material = case when v_changes ? 'material' then v_changes->>'material' else material end,
    termination_type = case when v_changes ? 'termination_type' then v_changes->>'termination_type' else termination_type end,
    delivery_date = case when v_changes ? 'delivery_date' then v_delivery_date else delivery_date end,
    order_file_url = case when v_changes ? 'order_file_url' then v_changes->>'order_file_url' else order_file_url end,
    preview_image = case when v_changes ? 'preview_image' then nullif(v_changes->>'preview_image', '') else preview_image end,
    reference_images = case when v_changes ? 'reference_images' then v_changes->'reference_images' else reference_images end,
    order_design_type = v_target_type,
    status = case when v_impact = 'restart_flow' and v_target_type = 'INTERNAL_DESING' then 'in_Design' when v_impact = 'restart_flow' then 'in_Quote' else status end,
    designer_id = case when v_target_type = 'EXTERNAL_DESING' then null else designer_id end,
    quote_id = case when v_impact = 'restart_flow' and v_target_type = 'INTERNAL_DESING' then null else quote_id end,
    production_id = case when v_impact = 'restart_flow' then null else production_id end,
    delivery_id = case when v_impact = 'restart_flow' then null else delivery_id end,
    operational_status = case when status = 'cancelled' and v_impact = 'restart_flow' then 'active' else operational_status end,
    commercial_review_required = case when v_impact = 'restart_flow' then true else commercial_review_required end,
    cancellation_reason = case when status = 'cancelled' and v_impact = 'restart_flow' then null else cancellation_reason end,
    status_changed_at = case when v_impact = 'restart_flow' then now() else status_changed_at end,
    last_admin_intervention_at = now(), last_admin_intervention_by = v_actor, last_admin_intervention_kind = p_action,
    updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_new;
  if v_impact = 'restart_flow' then
    update public.order_production_files set status = 'pending', assigned_to = null, updated_at = now() where order_id = p_order_id;
  end if;
  perform public.record_admin_intervention(v_old, v_new, p_action, p_reason_category, trim(p_reason_detail), v_started_at, null);
  v_result := jsonb_build_object('order', to_jsonb(v_new), 'action', p_action, 'success', true);
  update public.admin_order_command_executions set result = v_result, completed_at = now() where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb, p_reason_category text,
  p_reason_detail text, p_expected_updated_at timestamptz, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_target_user_id uuid;
  v_order_status text;
begin
  if p_action in ('reclassify_design', 'update_requirements') then
    return public.admin_update_order_requirements_command(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoria de motivo valida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.'; end if;
  if exists (select 1 from public.admin_order_command_executions e where e.idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  if p_action = 'register_payment' then
    select status into v_order_status from public.orders where id = p_order_id for share;
    if not found then raise exception 'La orden no existe.'; end if;
    if v_order_status <> 'in_Quote' then raise exception 'El pago solo puede modificarse cuando la orden esta en Caja.'; end if;
  end if;
  if p_action in ('assign_seller', 'route_sales') then
    v_target_user_id := nullif(p_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is not null and v_target_user_id <> v_actor and not exists (
      select 1 from public.profiles p where p.id = v_target_user_id and p.role = 'seller' and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then raise exception 'Selecciona un vendedor activo.'; end if;
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  return public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
end;
$$;

revoke all on function public.admin_update_order_requirements_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_update_order_requirements_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;
revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;
