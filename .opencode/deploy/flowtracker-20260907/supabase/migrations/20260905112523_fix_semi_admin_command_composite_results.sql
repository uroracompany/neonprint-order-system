-- Composite-returning PostgreSQL functions must be expanded in FROM before
-- assigning them to a table row variable. Selecting the composite value itself
-- makes PL/pgSQL try to coerce its textual row literal into the first column.

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
  if p_action = 'update_order' then
    select * into v_order from public.orders where id = p_order_id;
    if not found then raise exception 'La orden no existe.'; end if;
    if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then
      raise exception 'La orden está archivada o bloqueada.';
    end if;
    if v_order.status in ('in_Design', 'In_Design')
      and not public.semi_admin_can_operate_stage(p_order_id, 'design', null) then
      raise exception 'Asígnate como responsable de Diseño antes de editar esta orden.';
    elsif v_order.status not in ('Pending', 'pending', 'in_Design', 'In_Design') then
      raise exception 'La edición comercial no está disponible en esta etapa.';
    end if;
    select * into v_result from public.semi_admin_update_order(
      p_order_id,
      p_expected_updated_at,
      coalesce(p_payload->'changes', '{}'::jsonb),
      coalesce(p_payload->'new_production_files', '[]'::jsonb)
    );
    return jsonb_build_object('order', to_jsonb(v_result));

  elsif p_action = 'stage_responsibility' then
    select * into v_result from public.semi_admin_assign_stage_responsibility(
      p_order_id,
      p_payload->>'stage',
      nullif(p_payload->>'assignee_id', '')::uuid,
      p_expected_updated_at,
      nullif(p_payload->>'production_area_code', '')
    );
    return jsonb_build_object('order', to_jsonb(v_result));

  elsif p_action in ('send_to_designer', 'send_to_quote') then
    select * into v_result from public.semi_admin_transition_order(
      p_order_id,
      p_action,
      nullif(p_payload->>'target_user_id', '')::uuid,
      null,
      p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));

  elsif p_action = 'send_design_to_quote' then
    select * into v_result from public.semi_admin_send_design_to_quote(
      p_order_id,
      nullif(p_payload->>'quote_id', '')::uuid,
      p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));

  elsif p_action = 'return_design_to_sales' then
    select * into v_result from public.semi_admin_return_design_to_sales(
      p_order_id,
      p_payload->>'reason',
      p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));

  elsif p_action in ('set_payment', 'mark_credit', 'route_production', 'production_specifications') then
    if not public.semi_admin_can_operate_stage(p_order_id, 'quote', null) then
      raise exception 'Asígnate como responsable de Caja antes de operar esta etapa.';
    end if;
    if p_action = 'set_payment' then
      select * into v_result from public.semi_admin_set_order_payment(
        p_order_id, p_payload->>'payment_status', nullif(p_payload->>'invoice_payment', ''), p_expected_updated_at
      );
    elsif p_action = 'mark_credit' then
      select * into v_result from public.semi_admin_mark_order_credit(
        p_order_id, nullif(p_payload->>'due_date', '')::timestamptz, p_expected_updated_at
      );
    elsif p_action = 'route_production' then
      select * into v_result from public.semi_admin_route_order_to_production_v2(
        p_order_id, coalesce(p_payload->'area_assignments', '{}'::jsonb), p_expected_updated_at
      );
    else
      select * into v_result from public.semi_admin_save_order_production_file_specifications(
        p_order_id, p_expected_updated_at, coalesce(p_payload->'specifications', '[]'::jsonb)
      );
    end if;
    return jsonb_build_object('order', to_jsonb(v_result));

  elsif p_action in ('production_file_status', 'reassign_production_file') then
    select * into v_file from public.order_production_files
      where id = nullif(p_payload->>'file_id', '')::uuid;
    if not found or v_file.order_id <> p_order_id then
      raise exception 'El archivo no pertenece a la orden.';
    end if;
    if p_action = 'production_file_status' then
      if not public.semi_admin_can_operate_stage(p_order_id, 'production', v_file.production_area_code) then
        raise exception 'Asígnate como responsable de esta área antes de registrar avances.';
      end if;
      select * into v_file_result from public.semi_admin_update_production_file_status_v2(
        v_file.id, p_payload->>'next_status', p_expected_updated_at, nullif(p_payload->>'delivery_id', '')::uuid
      );
    else
      select * into v_file_result from public.semi_admin_reassign_file_production_area_v2(
        v_file.id, p_payload->>'new_area_code', nullif(p_payload->>'new_assigned_user_id', '')::uuid, p_expected_updated_at
      );
    end if;
    return jsonb_build_object('file', to_jsonb(v_file_result));

  elsif p_action = 'mark_delivered' then
    if not public.semi_admin_can_operate_stage(p_order_id, 'delivery', null) then
      raise exception 'Asígnate como responsable de Entrega antes de confirmar la entrega.';
    end if;
    select * into v_result from public.semi_admin_mark_order_delivered(
      p_order_id, nullif(p_payload->>'delivery_note', ''), p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));
  end if;

  raise exception 'Acción Semi-Administrativa no permitida.';
end;
$$;

revoke all on function public.semi_admin_execute_order_command_base(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
