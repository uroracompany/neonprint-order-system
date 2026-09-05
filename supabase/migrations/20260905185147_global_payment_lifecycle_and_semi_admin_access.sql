-- Payment is a global lifecycle invariant.  Every authorized command eventually
-- updates public.orders, so this trigger protects every caller rather than only
-- one UI or RPC.
create or replace function public.enforce_order_payment_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_post_production boolean := new.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered');
  v_has_evidence boolean := nullif(btrim(coalesce(new.invoice_payment, '')), '') is not null
    or nullif(btrim(coalesce(new.invoice_number, '')), '') is not null;
begin
  if new.payment_status not in ('Pending_Payment', 'parcial', 'pagado', 'credito') then
    raise exception 'Estado de pago inválido.';
  end if;

  if new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'pagado' and not v_has_evidence then
      raise exception 'Para marcar la orden como pagada debes adjuntar un comprobante/factura o ingresar un número de comprobante.';
    end if;
    if v_post_production and not (old.payment_status = 'parcial' and new.payment_status = 'pagado') then
      raise exception 'Después de enviar la orden a Producción solo se permite completar Pago parcial a Pagado.';
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'in_Production'
     and new.payment_status = 'Pending_Payment' then
    raise exception 'La orden no puede pasar a Producción mientras el pago permanezca pendiente.';
  end if;

  if new.status is distinct from old.status and new.status = 'in_Delivered'
     and new.payment_status not in ('pagado', 'credito') then
    raise exception 'Una orden con pago parcial o pendiente no puede marcarse como entregada.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_order_payment_lifecycle on public.orders;
create trigger enforce_order_payment_lifecycle
before update of payment_status, status, invoice_payment, invoice_number on public.orders
for each row execute function public.enforce_order_payment_lifecycle();

-- Semi-Admin can register payment only for an order assigned to that actor as
-- Diseño/Caja or created by that actor. This payment-only exception stays
-- deliberately separate from the broad command base.
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
  v_old public.orders;
  v_new public.orders;
  v_invoice_payment text;
begin
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' or v_old.status = 'cancelled' then
    raise exception 'La orden no está disponible para actualizar el pago.';
  end if;
  if v_old.designer_id is distinct from v_actor
     and v_old.quote_id is distinct from v_actor
     and v_old.seller_id is distinct from v_actor
     and v_old.created_by is distinct from v_actor then
    raise exception 'Debes ser responsable de Diseño/Caja o creador de la orden para gestionar el pago.';
  end if;
  if p_payment_status not in ('Pending_Payment', 'parcial', 'pagado', 'credito') then
    raise exception 'Selecciona un estado de pago válido.';
  end if;
  if v_old.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered')
     and not (v_old.payment_status = 'parcial' and p_payment_status = 'pagado') then
    raise exception 'Después de enviar la orden a Producción solo se permite completar Pago parcial a Pagado.';
  end if;
  if p_payment_status = 'credito' and (v_old.client_id is null or nullif(btrim(coalesce(nullif(p_invoice_number, ''), v_old.invoice_number, '')), '') is null) then
    raise exception 'Para vender a crédito debes registrar cliente y factura.';
  end if;

  v_invoice_payment := coalesce(nullif(btrim(coalesce(p_invoice_payment, '')), ''), v_old.invoice_payment);
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    payment_status = p_payment_status,
    invoice_payment = case when p_payment_status in ('Pending_Payment', 'parcial', 'credito') then null else v_invoice_payment end,
    invoice_number = coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), invoice_number),
    updated_at = now(),
    updated_by = v_actor
  where id = p_order_id returning * into v_new;

  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (p_order_id, v_actor, 'semi_admin_payment_updated', v_old.payment_status, v_new.payment_status,
    jsonb_build_object('evidence', case when nullif(btrim(coalesce(v_new.invoice_payment, '')), '') is not null then 'receipt' else 'receipt_number' end));
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
  v_result public.orders;
begin
  perform public.require_active_semi_admin_actor();
  if p_action = 'register_payment' then
    select * into v_result from public.semi_admin_register_order_payment(
      p_order_id, p_payload->>'payment_status', nullif(p_payload->>'invoice_payment', ''), nullif(p_payload->>'invoice_number', ''), p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));
  end if;
  if p_action in ('set_payment', 'mark_credit') then
    raise exception 'Usa el comando de pago autorizado.';
  end if;
  if p_action in ('production_file_status', 'reassign_production_file')
    or (p_action = 'stage_responsibility' and p_payload->>'stage' = 'production') then
    raise exception 'Semi-Administración no puede gestionar Producción.';
  end if;
  if p_action = 'mark_delivered' then
    select * into v_result from public.semi_admin_mark_order_delivered(
      p_order_id, nullif(p_payload->>'delivery_note', ''), p_expected_updated_at
    );
    return jsonb_build_object('order', to_jsonb(v_result));
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
  v_catalog jsonb;
  v_actions jsonb;
  v_unavailable jsonb;
  v_order public.orders;
  v_can_manage_payment boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  v_catalog := public.semi_admin_get_order_command_catalog_base(p_order_id);
  if coalesce((v_catalog->>'locked')::boolean, false) then return v_catalog; end if;
  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
  from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) action
  where action->>'key' not in ('register_payment', 'grant_credit');
  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_unavailable
  from jsonb_array_elements(coalesce(v_catalog->'unavailable_actions', '[]'::jsonb)) action;

  v_can_manage_payment := (
      v_order.designer_id = v_actor
      or v_order.quote_id = v_actor
      or v_order.seller_id = v_actor
      or v_order.created_by = v_actor
    )
    and v_order.status <> 'cancelled'
    and not coalesce(v_order.is_archived, false)
    and (v_order.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered') or v_order.payment_status = 'parcial');
  if v_can_manage_payment then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'register_payment', 'title', 'Gestionar pago'));
  else
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
      'key', 'payment_operations', 'title', 'Gestión de pago',
      'next_safe_step', 'Solo el responsable o creador Semi-Admin puede actualizar el pago; después de Producción únicamente se completa Pago parcial a Pagado.'
    ));
  end if;

  if v_catalog->>'active_stage' = 'production' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action
    where action->>'key' not in ('stage_responsibility', 'reassign_production_file', 'manage_production');
    v_catalog := jsonb_set(v_catalog, '{can_operate_current_stage}', 'false'::jsonb, true);
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
      'key', 'production_operations', 'title', 'Producción',
      'next_safe_step', 'Producción se gestiona exclusivamente por el operador asignado.'
    ));
  end if;

  if v_catalog->>'active_stage' = 'delivery' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action where action->>'key' <> 'mark_delivered';
    if v_order.payment_status in ('pagado', 'credito') then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega'));
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'delivery_operations', 'title', 'Acciones de Entrega',
        'next_safe_step', 'La orden debe estar pagada o a crédito antes de entregarse.'
      ));
    end if;
  end if;
  return jsonb_set(jsonb_set(v_catalog, '{actions}', v_actions, true), '{unavailable_actions}', v_unavailable, true);
end;
$$;

revoke all on function public.enforce_order_payment_lifecycle(), public.semi_admin_register_order_payment(uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz), public.semi_admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz), public.semi_admin_get_order_command_catalog(uuid) to authenticated;

notify pgrst, 'reload schema';
