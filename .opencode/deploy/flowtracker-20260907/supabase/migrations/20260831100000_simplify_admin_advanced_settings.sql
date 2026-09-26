-- Keep the Administration panel contextual. The same catalogue is also the
-- authorization boundary used by the public administrative wrappers.

create or replace function public.admin_order_action_policy(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_legacy jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_internal_actions jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
begin
  perform public.require_active_admin_order_actor();
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  if v_order.operational_status = 'blocked' then
    v_legacy := public.admin_order_action_policy_legacy(p_order_id);
    return v_legacy || jsonb_build_object('internal_actions', '[]'::jsonb);
  end if;

  if v_order.status = 'Pending' then
    v_actions := jsonb_build_array(
      jsonb_build_object(
        'key', 'assign_seller',
        'label', case when v_order.seller_id is null then 'Asignar vendedor' else 'Cambiar vendedor' end,
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition', 'target_role', 'seller', 'target_required', false),
        'impact', 'assignment_change'
      )
    );
    if v_order.order_design_type = 'INTERNAL_DESING' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'key', 'route_design', 'label', 'Enviar a Diseño',
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition', 'target_role', 'designer', 'target_required', true),
        'impact', 'stage_transfer'
      ));
    else
      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'key', 'manage_files', 'label', 'Gestionar archivos',
        'available', true, 'requires_reason', false,
        'requirements', jsonb_build_object('capability', 'manage_files', 'capabilities', jsonb_build_array('manage_design_assets')),
        'impact', 'asset_management'
      ));
    end if;
  elsif v_order.status = 'in_Design' and v_order.order_design_type = 'INTERNAL_DESING' then
    v_actions := jsonb_build_array(
      jsonb_build_object(
        'key', 'assign_seller',
        'label', case when v_order.seller_id is null then 'Asignar vendedor' else 'Cambiar vendedor' end,
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition', 'target_role', 'seller', 'target_required', false),
        'impact', 'assignment_change'
      ),
      jsonb_build_object(
        'key', 'set_designer_assignee', 'label', 'Cambiar diseñador',
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition', 'target_role', 'designer', 'target_required', true),
        'impact', 'assignment_change'
      ),
      jsonb_build_object(
        'key', 'manage_files', 'label', 'Gestionar archivos',
        'available', true, 'requires_reason', false,
        'requirements', jsonb_build_object('capability', 'manage_files', 'capabilities', jsonb_build_array('manage_design_assets')),
        'impact', 'asset_management'
      )
    );
  elsif v_order.status = 'in_Quote' then
    v_actions := jsonb_build_array(
      jsonb_build_object(
        'key', 'set_quote_assignee', 'label', 'Gestionar responsable de Caja',
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition', 'target_role', 'quote', 'target_required', false),
        'impact', 'assignment_change'
      ),
      jsonb_build_object(
        'key', 'register_payment', 'label', 'Registrar pago',
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'commercial_review'),
        'impact', 'commercial_update'
      ),
      jsonb_build_object(
        'key', 'route_production', 'label', 'Enviar a Producción',
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition', 'requires_area_assignments', true),
        'impact', 'stage_transfer'
      ),
      jsonb_build_object(
        'key', case when v_order.order_design_type = 'INTERNAL_DESING' then 'return_to_design' else 'route_sales' end,
        'label', case when v_order.order_design_type = 'INTERNAL_DESING' then 'Regresar a Diseño' else 'Regresar a Ventas' end,
        'available', true, 'requires_reason', true, 'reason_min_length', 10,
        'requirements', jsonb_build_object('capability', 'order_transition'),
        'impact', 'stage_transfer'
      )
    );
  else
    -- Lifecycle corrections remain available in their own stages, but this
    -- commercial/configuration surface never exposes priorities, cancellation,
    -- seller/designer reassignment, or production-file management.
    v_legacy := public.admin_order_action_policy_legacy(p_order_id);
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_actions
    from jsonb_array_elements(coalesce(v_legacy->'actions', '[]'::jsonb)) item
    where item->>'key' not in ('assign_seller', 'set_designer_assignee', 'manage_files', 'set_priority', 'cancel_order');
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_unavailable
    from jsonb_array_elements(coalesce(v_legacy->'unavailable_actions', '[]'::jsonb)) item
    where item->>'key' not in ('manage_files', 'set_priority', 'cancel_order');
  end if;

  if v_order.status not in ('cancelled', 'in_Delivered') then
    v_internal_actions := jsonb_build_array(jsonb_build_object(
      'key', 'edit_order', 'requirements', jsonb_build_object('capability', 'commercial_edit')
    ));
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'expected_updated_at', v_order.updated_at,
    'design_type', v_order.order_design_type,
    'operational_status', v_order.operational_status,
    'actions', v_actions,
    'unavailable_actions', v_unavailable,
    'internal_actions', v_internal_actions,
    'blocked_reason_category', v_order.blocked_reason_category,
    'blocked_reason_detail', v_order.blocked_reason_detail,
    'blocked_owner_id', v_order.blocked_owner_id,
    'blocked_expected_resolution_at', v_order.blocked_expected_resolution_at,
    'commercial_review_required', v_order.commercial_review_required
  );
end;
$$;

-- The legacy implementation owns the low-level transitions and audit trail.
-- This public wrapper makes policy enforcement unavoidable for direct callers.
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
  v_target_user_id uuid := p_target_user_id;
begin
  perform public.assert_admin_order_action_allowed(p_order_id, p_action);
  if p_action = 'assign_seller' and v_target_user_id = v_actor then
    v_target_user_id := null;
  end if;
  return public.admin_manage_order_legacy(
    p_order_id, p_action, p_reason_category, p_reason_detail,
    p_expected_updated_at, v_target_user_id, p_area_assignments
  );
end;
$$;

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
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoría de motivo válida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.'; end if;

  -- Preserve retries exactly: the recorded idempotent command remains readable
  -- even after an order moves to a different stage.
  if exists (select 1 from public.admin_order_command_executions where idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(p_order_id, p_action, v_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;

  perform public.assert_admin_order_action_allowed(p_order_id, p_action);
  if p_action = 'assign_seller' then
    v_target_user_id := nullif(v_payload->>'target_user_id', '')::uuid;
    if v_target_user_id = v_actor then
      v_payload := jsonb_set(v_payload, '{target_user_id}', 'null'::jsonb, true);
    elsif v_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = v_target_user_id and p.role = 'seller'
        and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then
      raise exception 'Selecciona un vendedor activo.';
    end if;
  elsif p_action in ('route_design', 'set_designer_assignee') then
    v_target_user_id := nullif(v_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is null then raise exception 'Selecciona un diseñador responsable.'; end if;
    if v_target_user_id <> v_actor and not exists (
      select 1 from public.profiles p
      where p.id = v_target_user_id and p.role = 'designer'
        and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then
      raise exception 'Selecciona un diseñador activo o Administración (yo).';
    end if;
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  return public.admin_execute_order_command_legacy(p_order_id, p_action, v_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
end;
$$;

create or replace function public.order_business_changed_fields(old_row public.orders, new_row public.orders)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare fields jsonb := '[]'::jsonb;
begin
  if old_row.client_id is distinct from new_row.client_id or old_row.client_name is distinct from new_row.client_name or old_row.client_contact is distinct from new_row.client_contact then fields := fields || jsonb_build_array(jsonb_build_object('field', 'client', 'label', 'Cliente')); end if;
  if old_row.invoice_number is distinct from new_row.invoice_number then fields := fields || jsonb_build_array(jsonb_build_object('field', 'invoice_number', 'label', 'Facturación')); end if;
  if old_row.description is distinct from new_row.description then fields := fields || jsonb_build_array(jsonb_build_object('field', 'description', 'label', 'Descripción')); end if;
  if old_row.material is distinct from new_row.material then fields := fields || jsonb_build_array(jsonb_build_object('field', 'material', 'label', 'Material')); end if;
  if old_row.termination_type is distinct from new_row.termination_type then fields := fields || jsonb_build_array(jsonb_build_object('field', 'termination_type', 'label', 'Terminación')); end if;
  if old_row.delivery_date is distinct from new_row.delivery_date then fields := fields || jsonb_build_array(jsonb_build_object('field', 'delivery_date', 'label', 'Fecha de entrega')); end if;
  if old_row.order_file_url is distinct from new_row.order_file_url then fields := fields || jsonb_build_array(jsonb_build_object('field', 'order_file_url', 'label', 'Archivos de diseño')); end if;
  if old_row.preview_image is distinct from new_row.preview_image then fields := fields || jsonb_build_array(jsonb_build_object('field', 'preview_image', 'label', 'Orden de trabajo')); end if;
  if old_row.reference_images is distinct from new_row.reference_images then fields := fields || jsonb_build_array(jsonb_build_object('field', 'reference_images', 'label', 'Imágenes de referencia')); end if;
  if old_row.status is distinct from new_row.status then fields := fields || jsonb_build_array(jsonb_build_object('field', 'status', 'label', 'Etapa')); end if;
  if old_row.payment_status is distinct from new_row.payment_status or old_row.invoice_payment is distinct from new_row.invoice_payment then fields := fields || jsonb_build_array(jsonb_build_object('field', 'payment', 'label', 'Pago')); end if;
  if old_row.seller_id is distinct from new_row.seller_id then fields := fields || jsonb_build_array(jsonb_build_object('field', 'seller_id', 'label', 'Vendedor responsable')); end if;
  if old_row.designer_id is distinct from new_row.designer_id or old_row.quote_id is distinct from new_row.quote_id or old_row.production_id is distinct from new_row.production_id or old_row.delivery_id is distinct from new_row.delivery_id then fields := fields || jsonb_build_array(jsonb_build_object('field', 'assignment', 'label', 'Responsable de etapa')); end if;
  if old_row.return_reason is distinct from new_row.return_reason or old_row.cancellation_reason is distinct from new_row.cancellation_reason then fields := fields || jsonb_build_array(jsonb_build_object('field', 'workflow_note', 'label', 'Nota operativa')); end if;
  return fields;
end;
$$;

create or replace function public.admin_order_edit_value(p_order public.orders, p_field text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with assignment_values(sort_order, value) as (
    values
      (1, case when p_order.designer_id is not null then 'Diseño: ' || public.admin_order_profile_name(p_order.designer_id) end),
      (2, case when p_order.quote_id is not null then 'Caja: ' || public.admin_order_profile_name(p_order.quote_id) end),
      (3, case when p_order.production_id is not null then 'Producción: ' || public.admin_order_profile_name(p_order.production_id) end),
      (4, case when p_order.delivery_id is not null then 'Entrega: ' || public.admin_order_profile_name(p_order.delivery_id) end)
  )
  select case
    when p_field = 'client' then nullif(concat_ws(' / ', p_order.client_name, p_order.client_contact), '')
    when p_field = 'invoice_number' then p_order.invoice_number
    when p_field = 'description' then p_order.description
    when p_field = 'material' then p_order.material
    when p_field = 'termination_type' then p_order.termination_type
    when p_field = 'delivery_date' then p_order.delivery_date::text
    when p_field = 'seller_id' then coalesce(public.admin_order_profile_name(p_order.seller_id), 'Administración')
    when p_field = 'files' then 'Archivos de la orden'
    when p_field = 'order_file_url' then case when nullif(p_order.order_file_url, '') is null then 'Sin archivos adjuntos' else 'Archivos adjuntos cargados' end
    when p_field = 'preview_image' then case when nullif(p_order.preview_image, '') is null then 'Sin orden de trabajo' else 'Orden de trabajo cargada' end
    when p_field = 'reference_images' then case when jsonb_array_length(coalesce(p_order.reference_images, '[]'::jsonb)) = 0 then 'Sin imágenes de referencia' else 'Imágenes de referencia cargadas' end
    when p_field = 'status' then case p_order.status
      when 'Pending' then 'Pendiente' when 'in_Design' then 'Diseño' when 'in_Quote' then 'Caja'
      when 'in_Production' then 'Producción' when 'in_Termination' then 'Terminación'
      when 'in_Delivered' then 'Entregado' when 'in_Completed' then 'Completada'
      when 'cancelled' then 'Cancelada' else coalesce(p_order.status, 'Sin estado') end
    when p_field in ('payment', 'payment_status') then case lower(coalesce(p_order.payment_status, ''))
      when 'pending_payment' then 'Pendiente' when 'pending payment' then 'Pendiente'
      when 'pendiente' then 'Pendiente' when 'parcial' then 'Pago parcial'
      when 'pagado' then 'Pagado' when 'paid' then 'Pagado'
      when 'credito' then 'Pago a crédito' when 'crédito' then 'Pago a crédito'
      when 'credit' then 'Pago a crédito' else 'Estado de pago no disponible' end
    when p_field = 'order_design_type' then case p_order.order_design_type
      when 'INTERNAL_DESING' then 'Diseño interno' when 'EXTERNAL_DESING' then 'Diseño externo'
      else coalesce(p_order.order_design_type, 'Sin tipo de diseño') end
    when p_field = 'assignment' then coalesce((select nullif(string_agg(value, ' / ' order by sort_order), '') from assignment_values where value is not null), 'Sin responsable')
    when p_field = 'workflow_note' then coalesce(p_order.return_reason, p_order.cancellation_reason)
    else null
  end
$$;

-- Payment messages deliberately reach only Caja and the current commercial
-- seller. Other generic changes go to the current stage owner and seller,
-- never to historical owners retained in assignment columns.
create or replace function public.admin_intervention_direct_recipients(
  p_old public.orders, p_new public.orders, p_action text, p_actor_id uuid
)
returns table(user_id uuid, template_key text, priority text, requires_ack boolean, role_context text)
language sql stable security definer set search_path = '' as $$
  with candidates(user_id, template_key, priority, requires_ack, role_context) as (
    select p_new.seller_id, 'assignment_received', 'action_required', true, 'seller'
      where p_action = 'assign_seller' and p_new.seller_id is distinct from p_old.seller_id
    union all select p_old.seller_id, 'assignment_removed', 'important', false, 'seller'
      where p_action = 'assign_seller' and p_old.seller_id is not null and p_new.seller_id is distinct from p_old.seller_id
    union all select p_new.designer_id, 'assignment_received', 'action_required', true, 'designer'
      where p_action in ('route_design', 'set_designer_assignee') and p_new.designer_id is distinct from p_old.designer_id
    union all select p_old.designer_id, 'assignment_removed', 'important', false, 'designer'
      where p_action = 'set_designer_assignee' and p_old.designer_id is not null and p_new.designer_id is distinct from p_old.designer_id
    union all select p_new.quote_id, 'assignment_received', 'action_required', true, 'quote'
      where p_action = 'set_quote_assignee' and p_new.quote_id is distinct from p_old.quote_id
    union all select p_old.quote_id, 'assignment_removed', 'important', false, 'quote'
      where p_action = 'set_quote_assignee' and p_old.quote_id is not null and p_new.quote_id is distinct from p_old.quote_id
    union all select p_new.seller_id, 'workflow_changed', 'important', false, 'seller'
      where p_action = 'route_design' and p_new.seller_id is not null
    union all select p_new.seller_id, 'workflow_changed', 'important', false, 'seller'
      where p_action = 'set_designer_assignee' and p_new.seller_id is not null
    union all select p_new.designer_id, 'workflow_changed', 'important', false, 'designer'
      where p_action = 'design_assets_updated' and p_new.status = 'in_Design'
    union all select p_new.seller_id, 'workflow_changed', 'important', false, 'seller'
      where p_action = 'design_assets_updated' and p_new.seller_id is not null
    union all select p_new.seller_id, 'workflow_changed', 'important', false, 'seller'
      where p_action = 'edit_order' and p_new.seller_id is not null
    union all select p_new.designer_id, 'workflow_changed', 'important', false, 'designer'
      where p_action = 'edit_order' and p_new.status = 'in_Design' and p_new.designer_id is not null
    union all select p_new.quote_id, 'workflow_changed', 'important', false, 'quote'
      where p_action = 'edit_order' and p_new.status = 'in_Quote' and p_new.quote_id is not null
    union all select p_new.quote_id, 'payment_changed', 'important', false, 'quote'
      where p_action = 'register_payment' and p_new.quote_id is not null
    union all select p_new.seller_id, 'payment_changed', 'important', false, 'seller'
      where p_action = 'register_payment' and p_new.seller_id is not null
  ), ranked as (
    select distinct on (user_id) user_id, template_key, priority, requires_ack, role_context,
      case priority when 'action_required' then 3 when 'important' then 2 else 1 end as rank
    from candidates where user_id is not null and user_id is distinct from p_actor_id
    order by user_id, rank desc, requires_ack desc
  )
  select r.user_id, r.template_key, r.priority, r.requires_ack, r.role_context
  from ranked r join public.profiles p on p.id = r.user_id
  where coalesce(p.employment_status, true) and p.deleted_at is null
$$;

create or replace function public.write_admin_intervention_notice(
  p_event_id uuid, p_order public.orders, p_recipient_id uuid, p_template_key text,
  p_priority text, p_requires_ack boolean, p_action text, p_reason_label text,
  p_reason_detail text, p_changed_fields jsonb, p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_review_id uuid;
  v_name text;
  v_role text;
  v_order_code text := coalesce(p_order.order_code::text, left(p_order.id::text, 8));
  v_previous_seller text := 'Administración';
  v_current_seller text := coalesce(public.admin_order_profile_name(p_order.seller_id), 'Administración');
  v_designer text := coalesce(public.admin_order_profile_name(p_order.designer_id), 'Administración');
  v_title text;
  v_message text;
  v_deep_link text;
begin
  select coalesce(nullif(trim(p.name), ''), p.email, 'usuario'), p.role into v_name, v_role
  from public.profiles p where p.id = p_recipient_id and coalesce(p.employment_status, true) and p.deleted_at is null;
  if not found or p_recipient_id is null or p_recipient_id = p_actor_id then return null; end if;
  select coalesce(nullif(item->>'old_value', ''), 'Administración') into v_previous_seller
  from jsonb_array_elements(coalesce(p_changed_fields, '[]'::jsonb)) item where item->>'field' = 'seller_id' limit 1;
  v_title := case p_template_key
    when 'assignment_received' then 'Administración te asignó como responsable'
    when 'assignment_removed' then 'La orden fue reasignada'
    when 'payment_changed' then 'Administración actualizó el pago de la orden'
    else 'Administración actualizó tu orden'
  end;
  v_message := case
    when p_action = 'assign_seller' and p_template_key = 'assignment_received' then
      'Hola, ' || v_name || '. Administración te asignó la orden #' || v_order_code || '. Responsable anterior: ' || v_previous_seller || '.'
    when p_action = 'assign_seller' and p_template_key = 'assignment_removed' then
      'Hola, ' || v_name || '. La orden #' || v_order_code || ' ya no está bajo tu responsabilidad. Ahora la atiende ' || v_current_seller || '.'
    when p_action in ('route_design', 'set_designer_assignee') and p_template_key = 'assignment_received' then
      'Hola, ' || v_name || '. Administración te asignó la orden #' || v_order_code || ' para Diseño. Responsable comercial: ' || v_current_seller || '.'
    when p_action = 'set_designer_assignee' and p_template_key = 'assignment_removed' then
      'Hola, ' || v_name || '. Administración cambió el responsable de Diseño de la orden #' || v_order_code || '. Ahora la atiende ' || v_designer || '.'
    when p_action = 'route_design' then
      'Hola, ' || v_name || '. Administración envió la orden #' || v_order_code || ' a Diseño. Responsable de Diseño: ' || v_designer || '.'
    when p_action = 'register_payment' then
      'Hola, ' || v_name || '. Administración actualizó el pago de la orden #' || v_order_code || '. Revisa la información antes de continuar.'
    else 'Hola, ' || v_name || '. Administración actualizó la orden #' || v_order_code || '. Cambios: ' || coalesce((select string_agg(item->>'label', ', ') from jsonb_array_elements(coalesce(p_changed_fields, '[]'::jsonb)) item), 'información de la orden') || '.'
  end;
  v_deep_link := case v_role when 'seller' then '/page-seller?order=' || p_order.id::text when 'designer' then '/designer?order=' || p_order.id::text when 'quote' then '/quote?order=' || p_order.id::text else '/dashboard?order=' || p_order.id::text end;
  insert into public.order_event_reviews(order_event_id, order_id, user_id, label, source_module, event_key, changed_fields, summary, metadata)
  values (p_event_id, p_order.id, p_recipient_id, v_title, 'admin', 'admin_intervention_notice', coalesce(p_changed_fields, '[]'::jsonb), v_message,
    jsonb_build_object('event_kind', 'admin_intervention_notice', 'template_key', p_template_key, 'priority', p_priority, 'requires_ack', p_requires_ack, 'action', p_action, 'actor_id', p_actor_id, 'reason_label', p_reason_label, 'reason_detail', p_reason_detail, 'deep_link', v_deep_link, 'order_code', v_order_code, 'client_name', p_order.client_name))
  on conflict (order_event_id, user_id) do update set label = excluded.label, summary = excluded.summary, changed_fields = excluded.changed_fields, metadata = excluded.metadata
  returning id into v_review_id;
  if not exists (select 1 from public.notifications n where n.user_id = p_recipient_id and n.metadata->>'review_id' = v_review_id::text and n.deleted_at is null) then
    insert into public.notifications(user_id, type, title, message, order_id, metadata)
    values (p_recipient_id, 'order_updated', v_title, v_message, p_order.id, jsonb_build_object('event_kind', 'admin_intervention_notice', 'event_id', p_event_id, 'review_id', v_review_id, 'template_key', p_template_key, 'priority', p_priority, 'requires_ack', p_requires_ack, 'action', p_action, 'actor_id', p_actor_id, 'reason_label', p_reason_label, 'reason_detail', p_reason_detail, 'deep_link', v_deep_link));
  end if;
  return v_review_id;
end;
$$;

revoke all on function public.admin_order_action_policy(uuid), public.assert_admin_order_action_allowed(uuid, text, text), public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb), public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_order_action_policy(uuid), public.assert_admin_order_action_allowed(uuid, text, text), public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb), public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
