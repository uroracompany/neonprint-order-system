-- Caja-only Semi-Admin commands and internal operational audit projection.
-- This migration is deliberately later than 20260906110000 and leaves the
-- previous client/cancellation/payment reconciliation intact.

create or replace function public.semi_admin_register_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_invoice_number text,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_invoice_payment text;
  v_invoice_number text;
begin
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' or v_old.status = 'cancelled' then
    raise exception 'La orden no está disponible para actualizar el pago.';
  end if;
  if v_old.status <> 'in_Quote' then raise exception 'El pago de Semi-Administración solo se gestiona en Caja.'; end if;
  if v_old.designer_id is distinct from v_actor and v_old.quote_id is distinct from v_actor
     and v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor then
    raise exception 'Debes ser responsable de Diseño/Caja o creador de la orden para gestionar el pago.';
  end if;
  if p_payment_status not in ('Pending_Payment', 'parcial', 'pagado', 'credito') then
    raise exception 'Selecciona un estado de pago válido.';
  end if;
  if v_old.payment_status = 'pagado' and p_payment_status not in ('pagado', 'Pending_Payment') then
    raise exception 'Un pago confirmado solo puede conservarse o corregirse a pago pendiente en Caja.';
  end if;
  if v_old.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado') then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;
  if v_old.payment_status = 'credito' and p_payment_status not in ('credito', 'pagado') then
    raise exception 'Una orden a crédito solo puede mantenerse a crédito o cambiarse a pagado mediante un cierre registrado.';
  end if;

  v_invoice_payment := coalesce(nullif(btrim(coalesce(p_invoice_payment, '')), ''), v_old.invoice_payment);
  v_invoice_number := coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), v_old.invoice_number);
  if p_payment_status = 'pagado' and nullif(btrim(coalesce(v_invoice_payment, '')), '') is null
     and nullif(btrim(coalesce(v_invoice_number, '')), '') is null then
    raise exception 'Debes adjuntar la factura o ingresar un número de comprobante para marcar como pagado.';
  end if;
  if p_payment_status = 'credito' and (v_old.client_id is null or nullif(btrim(coalesce(v_invoice_number, '')), '') is null) then
    raise exception 'Para vender a crédito debes registrar cliente y factura.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    payment_status = p_payment_status,
    invoice_payment = case when p_payment_status in ('Pending_Payment', 'parcial', 'credito') then null else v_invoice_payment end,
    invoice_number = v_invoice_number,
    updated_at = now(),
    updated_by = v_actor
  where id = p_order_id
  returning * into v_new;

  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (p_order_id, v_actor, 'semi_admin_payment_updated', v_old.payment_status, v_new.payment_status,
    jsonb_build_object(
      'evidence', case when nullif(btrim(coalesce(v_new.invoice_payment, '')), '') is not null then 'receipt' else 'receipt_number' end,
      'invoice_number_applied', nullif(btrim(coalesce(v_new.invoice_number, '')), ''),
      'correction', case when v_old.payment_status = 'pagado' and v_new.payment_status = 'Pending_Payment' then 'paid_to_pending_in_quote' else null end
    ));
  return v_new;
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
  return jsonb_set(jsonb_set(v_catalog, '{actions}', v_actions, true), '{unavailable_actions}', v_unavailable, true);
end;
$$;

revoke all on function public.semi_admin_register_order_payment(uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz), public.semi_admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz), public.semi_admin_get_order_command_catalog(uuid) to authenticated;

notify pgrst, 'reload schema';
