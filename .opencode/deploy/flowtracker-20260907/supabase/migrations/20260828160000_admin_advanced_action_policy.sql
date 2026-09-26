-- Single, stage-aware policy for the administrative command catalogue.  The
-- catalogue is UX only; every public wrapper below re-checks the same policy.

create or replace function public.admin_order_action_policy(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_base jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_key text;
  v_capabilities jsonb := '[]'::jsonb;
begin
  perform public.require_active_admin_order_actor();
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  if v_order.operational_status = 'blocked' then
    v_actions := jsonb_build_array(
      jsonb_build_object('key', 'resume_order', 'label', 'Reanudar orden', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'block_control'), 'impact', 'block_control'),
      jsonb_build_object('key', 'update_block', 'label', 'Actualizar bloqueo', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'block_control'), 'impact', 'block_control')
    );
    return jsonb_build_object('order_id', v_order.id, 'expected_updated_at', v_order.updated_at, 'design_type', v_order.order_design_type, 'operational_status', v_order.operational_status, 'actions', v_actions, 'unavailable_actions', v_unavailable);
  end if;

  if v_order.status = 'cancelled' then
    v_actions := jsonb_build_array(jsonb_build_object('key', 'reopen_cancelled', 'label', 'Reabrir orden cancelada', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'lifecycle_transition'), 'impact', 'stage_transfer'));
    return jsonb_build_object('order_id', v_order.id, 'expected_updated_at', v_order.updated_at, 'design_type', v_order.order_design_type, 'operational_status', v_order.operational_status, 'actions', v_actions, 'unavailable_actions', v_unavailable);
  end if;

  if v_order.status = 'in_Delivered' then
    v_actions := jsonb_build_array(jsonb_build_object('key', 'return_to_completed', 'label', 'Volver a Completado', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'lifecycle_transition'), 'impact', 'stage_transfer'));
    return jsonb_build_object('order_id', v_order.id, 'expected_updated_at', v_order.updated_at, 'design_type', v_order.order_design_type, 'operational_status', v_order.operational_status, 'actions', v_actions, 'unavailable_actions', v_unavailable);
  end if;

  v_base := public.get_admin_order_actions(p_order_id);
  for v_key in select item->>'key' from jsonb_array_elements(coalesce(v_base->'actions', '[]'::jsonb)) item loop
    if v_key <> 'manage_files' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'label', case v_key when 'register_payment' then 'Registrar pago' else null end,
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', case when v_key = 'register_payment' then 'commercial_review' else 'order_transition' end,
          'target_role', case v_key when 'route_quote' then 'quote' when 'set_quote_assignee' then 'quote' when 'route_sales' then 'seller' when 'assign_seller' then 'seller' when 'route_design' then 'designer' when 'set_designer_assignee' then 'designer' else null end,
          'target_required', v_key in ('route_sales', 'assign_seller'),
          'requires_area_assignments', v_key in ('route_production', 'reassign_production')),
        'impact', case when v_key in ('route_quote', 'route_sales', 'route_design', 'route_production', 'return_to_quote', 'return_to_design', 'mark_delivered', 'return_to_completed') then 'stage_transfer' else 'assignment_change' end));
    end if;
  end loop;

  -- These controls used to be appended globally.  They are deliberately
  -- constrained to stages where their effect is operationally understandable.
  v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'block_order', 'label', 'Bloquear temporalmente', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'block_control'), 'impact', 'block_control'));
  if v_order.status in ('Pending', 'in_Design', 'in_Quote') then
    v_actions := v_actions || jsonb_build_array(
      jsonb_build_object('key', 'set_priority', 'label', 'Cambiar prioridad', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'commercial_update'), 'impact', 'informational'),
      jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar diseño', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'commercial_update', 'impact_modes', jsonb_build_array('preserve_stage', 'restart_flow')), 'impact', 'workflow_correction'),
      jsonb_build_object('key', 'update_requirements', 'label', 'Cambiar requisitos', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'commercial_update', 'impact_modes', jsonb_build_array('preserve_stage', 'restart_flow')), 'impact', 'workflow_correction')
    );
  end if;
  if v_order.status = 'in_Quote' and v_order.commercial_review_required then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'approve_commercial_review', 'label', 'Aprobar revisión comercial', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'commercial_review'), 'impact', 'commercial_update'));
  end if;
  if v_order.status <> 'in_Delivered' then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'cancel_order', 'label', 'Cancelar orden', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'lifecycle_transition'), 'impact', 'lifecycle_transition'));
  end if;
  if v_order.status = 'in_Completed' then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'return_to_quote', 'label', 'Regresar a Caja', 'available', true, 'requires_reason', true, 'reason_min_length', 10, 'requirements', jsonb_build_object('capability', 'order_transition'), 'impact', 'stage_transfer'));
  end if;

  if (v_order.order_design_type = 'EXTERNAL_DESING' and v_order.status = 'Pending') or (v_order.order_design_type = 'INTERNAL_DESING' and v_order.status = 'in_Design') then
    v_capabilities := v_capabilities || jsonb_build_array('manage_design_assets');
  elsif v_order.status not in ('Pending', 'in_Design') and v_order.status <> 'in_Delivered' then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'manage_files', 'label', 'Modificar activos de diseño', 'available', false, 'disabled_reason', 'Los activos de diseño solo se modifican en su etapa de origen.', 'next_safe_step', case when v_order.order_design_type = 'INTERNAL_DESING' then 'Devuelve la orden a Caja y luego a Diseño.' else 'Devuelve la orden a Caja y luego a Ventas.' end));
  end if;
  if v_order.status in ('in_Production', 'in_Termination') then v_capabilities := v_capabilities || jsonb_build_array('manage_production_files'); end if;
  if v_order.status in ('Pending', 'in_Design', 'in_Quote', 'in_Production', 'in_Termination') then v_capabilities := v_capabilities || jsonb_build_array('reassign_production_file_area'); end if;
  if jsonb_array_length(v_capabilities) > 0 then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'manage_files', 'label', 'Gestionar archivos', 'available', true, 'requires_reason', false, 'requirements', jsonb_build_object('capability', 'manage_files', 'capabilities', v_capabilities), 'impact', 'asset_management'));
  end if;

  return jsonb_build_object('order_id', v_order.id, 'expected_updated_at', v_order.updated_at, 'design_type', v_order.order_design_type, 'operational_status', v_order.operational_status, 'actions', v_actions, 'unavailable_actions', v_unavailable,
    'blocked_reason_category', v_order.blocked_reason_category, 'blocked_reason_detail', v_order.blocked_reason_detail, 'blocked_owner_id', v_order.blocked_owner_id, 'blocked_expected_resolution_at', v_order.blocked_expected_resolution_at, 'commercial_review_required', v_order.commercial_review_required);
end;
$$;

create or replace function public.assert_admin_order_action_allowed(p_order_id uuid, p_key text, p_capability text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_policy jsonb; v_action jsonb;
begin
  perform public.require_active_admin_order_actor();
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  v_policy := public.admin_order_action_policy(p_order_id);
  select item into v_action from jsonb_array_elements(coalesce(v_policy->'actions', '[]'::jsonb)) item where item->>'key' = p_key limit 1;
  if v_action is null then
    raise exception 'La acción administrativa no está disponible en la etapa actual.';
  end if;
  if p_capability is not null and not (
    coalesce(v_action->'requirements'->'capabilities', '[]'::jsonb) ? p_capability
    or coalesce(v_action->'requirements'->>'capability', '') = p_capability
  ) then raise exception 'La capacidad administrativa no está disponible en la etapa actual.'; end if;
  return v_action;
end;
$$;

create or replace function public.admin_get_order_command_catalog(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.admin_order_action_policy(p_order_id)
$$;

create or replace function public.admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb, p_reason_category text, p_reason_detail text, p_expected_updated_at timestamptz, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text; v_result jsonb;
begin
  perform public.require_active_admin_order_actor();
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null or char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El motivo administrativo no es válido.'; end if;
  if exists (select 1 from public.admin_order_command_executions where idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  perform public.assert_admin_order_action_allowed(p_order_id, p_action);
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  if p_action = 'return_to_quote' and v_status = 'in_Completed' then
    v_result := public.admin_return_completed_to_quote_command(p_order_id, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  else
    v_result := public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  return v_result;
end;
$$;

create or replace function public.admin_reassign_file_production_area(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz, p_reason_category text, p_reason_detail text
) returns public.order_production_files language plpgsql security definer set search_path = '' as $$
declare v_old_file public.order_production_files; v_new_file public.order_production_files; v_old_order public.orders; v_new_order public.orders; v_started timestamptz := clock_timestamp();
begin
  perform public.require_active_admin_order_actor();
  if public.admin_intervention_reason_label(p_reason_category) is null or char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El motivo administrativo no es válido.'; end if;
  select * into v_old_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo de producción no existe.'; end if;
  select * into v_old_order from public.orders where id = v_old_file.order_id for update;
  if v_old_file.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform public.assert_admin_order_action_allowed(v_old_order.id, 'manage_files', 'reassign_production_file_area');
  if v_old_file.status = 'completed' then raise exception 'No se puede cambiar el área de un archivo finalizado.'; end if;
  if p_new_assigned_user_id is null or not exists (select 1 from public.profiles p join public.production_areas a on a.producer_role = p.role where p.id = p_new_assigned_user_id and a.code = p_new_area_code and a.is_active and coalesce(p.employment_status, true) and p.deleted_at is null) then raise exception 'Selecciona un responsable activo del área de Producción.'; end if;
  if v_old_file.production_area_code = p_new_area_code and v_old_file.assigned_to is not distinct from p_new_assigned_user_id then raise exception 'El área y responsable no han cambiado.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_reassigned', true);
  select * into v_new_file from public.admin_reassign_file_production_area_legacy(p_file_id, p_new_area_code, p_new_assigned_user_id, p_expected_updated_at);
  select * into v_new_order from public.orders where id = v_old_order.id;
  perform public.record_admin_intervention(v_old_order, v_new_order, 'reassign_production', p_reason_category, trim(p_reason_detail), v_started,
    jsonb_build_array(jsonb_build_object('field', 'production_file_assignment', 'file_id', v_old_file.id, 'label', coalesce(v_old_file.public_label, v_old_file.filename, 'Archivo de Producción'), 'old_assigned_to', v_old_file.assigned_to, 'new_assigned_to', v_new_file.assigned_to, 'old_area_code', v_old_file.production_area_code, 'new_area_code', v_new_file.production_area_code)));
  return v_new_file;
end;
$$;

create or replace function public.admin_reassign_file_production_area(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz
) returns public.order_production_files language plpgsql security definer set search_path = '' as $$
begin
  return public.admin_reassign_file_production_area(p_file_id, p_new_area_code, p_new_assigned_user_id, p_expected_updated_at, 'assignment_correction', 'Cambio de área solicitado por una versión compatible de Configuración avanzada.');
end;
$$;

create or replace function public.admin_force_file_status(
  p_file_id uuid, p_new_status text, p_reason_category text, p_reason_detail text, p_expected_updated_at timestamptz, p_delivery_id uuid default null
) returns public.order_production_files language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid;
begin
  perform public.require_active_admin_order_actor();
  select order_id into v_order_id from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo de producción no existe.'; end if;
  perform public.assert_admin_order_action_allowed(v_order_id, 'manage_files', 'manage_production_files');
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_status', true);
  return public.admin_force_file_status_legacy(p_file_id, p_new_status, p_reason_category, p_reason_detail, p_expected_updated_at, p_delivery_id);
end;
$$;

create or replace function public.admin_update_production_file_status(
  p_file_id uuid, p_next_status text, p_reason_category text, p_reason_detail text, p_expected_updated_at timestamptz, p_delivery_id uuid default null
) returns public.order_production_files language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid;
begin
  perform public.require_active_admin_order_actor();
  select order_id into v_order_id from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo de producción no existe.'; end if;
  perform public.assert_admin_order_action_allowed(v_order_id, 'manage_files', 'manage_production_files');
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_status', true);
  return public.admin_update_production_file_status_legacy(p_file_id, p_next_status, p_reason_category, p_reason_detail, p_expected_updated_at, p_delivery_id);
end;
$$;

create or replace function public.admin_save_design_assets(
  p_order_id uuid, p_files jsonb, p_preview_url text, p_reason_category text, p_reason_detail text, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform public.assert_admin_order_action_allowed(p_order_id, 'manage_files', 'manage_design_assets');
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'design_assets_updated', true);
  return public.admin_save_design_assets_legacy(p_order_id, p_files, p_preview_url, p_reason_category, p_reason_detail, p_expected_updated_at);
end;
$$;

revoke all on function public.admin_order_action_policy(uuid), public.assert_admin_order_action_allowed(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.admin_get_order_command_catalog(uuid) to authenticated;
revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;
revoke all on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz), public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz), public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz, text, text) to authenticated;
revoke all on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid), public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid), public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid), public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid), public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
