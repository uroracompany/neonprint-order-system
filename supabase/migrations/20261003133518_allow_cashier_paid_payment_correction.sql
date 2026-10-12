-- Allow the assigned Caja user to correct an accidental paid state only
-- before production has been authorized, without changing the public RPC API.

create or replace function public.quote_set_order_payment_before_cashier_gate(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_invoice_payment text := nullif(btrim(coalesce(p_invoice_payment, '')), '');
  v_is_correction boolean := false;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'quote'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Solo Caja puede actualizar pagos.';
  end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.quote_id is distinct from v_actor
     or v_order.status <> 'in_Quote'
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_admin, false)
     or coalesce(v_order.is_archived_designer, false)
     or coalesce(v_order.is_archived_quote, false)
     or coalesce(v_order.is_archived_production, false)
     or coalesce(v_order.is_archived_delivery, false)
     or v_order.operational_status = 'blocked'
     or v_order.status = 'cancelled' then
    raise exception 'Solo Caja asignada puede gestionar el pago de una orden disponible en Caja.';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.production_authorized_at is not null or v_order.production_authorized_by is not null then
    raise exception 'El pago no puede modificarse después de autorizar Producción.';
  end if;
  if p_payment_status is null or p_payment_status not in ('Pending_Payment', 'parcial', 'pagado') then
    raise exception 'Estado de pago invalido';
  end if;

  v_is_correction := v_order.payment_status = 'pagado'
    and p_payment_status in ('Pending_Payment', 'parcial');
  if (v_order.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado'))
     or (v_order.payment_status = 'pagado' and p_payment_status <> 'pagado' and not v_is_correction)
     or v_order.payment_status = 'credito' then
    raise exception 'Transicion de pago no permitida';
  end if;

  if v_is_correction then
    v_invoice_payment := null;
  else
    v_invoice_payment := coalesce(v_invoice_payment, v_order.invoice_payment);
  end if;
  if p_payment_status = 'pagado'
     and not public.order_has_confirmable_payment(p_order_id, v_order.invoice_number, v_invoice_payment) then
    raise exception 'Para marcar la orden como pagada debes registrar el código de facturación y adjuntar un comprobante de imagen verificado.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    payment_status = p_payment_status,
    invoice_payment = case
      when v_is_correction or p_payment_status = 'parcial' then null
      when p_payment_status = 'pagado' then v_invoice_payment
      else coalesce(v_invoice_payment, invoice_payment)
    end,
    updated_at = now(),
    updated_by = v_actor
  where id = p_order_id returning * into v_updated;

  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (
    p_order_id,
    v_actor,
    case when v_is_correction then 'payment_corrected' else 'payment_confirmed' end,
    v_order.payment_status,
    v_updated.payment_status,
    case when v_is_correction then
      jsonb_build_object(
        'invoice_number', v_updated.invoice_number,
        'receipt_unlinked', v_order.invoice_payment is not null,
        'corrected_by', v_actor
      )
    else
      jsonb_build_object('invoice_number', v_updated.invoice_number, 'receipt_verified', p_payment_status = 'pagado')
    end
  );
  return v_updated;
end;
$$;

revoke all on function public.quote_set_order_payment_before_cashier_gate(uuid, text, text, timestamptz)
  from public, anon, authenticated;

-- Backstop direct financial writes as well as the RPC. Check the OLD approval
-- before the production-authorization lifecycle trigger can clear it.
create or replace function public.guard_order_financial_write_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_credit_settlement boolean := false;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.payment_status, 'Pending_Payment') <> 'Pending_Payment'
       or new.invoice_payment is not null then
      raise exception 'Una orden nueva no puede incluir cambios de pago o comprobantes; Caja debe gestionarlos después de la asignación.';
    end if;
    return new;
  end if;
  if new.payment_status is not distinct from old.payment_status
     and new.invoice_payment is not distinct from old.invoice_payment
     and new.invoice_number is not distinct from old.invoice_number then
    return new;
  end if;

  if old.production_authorized_at is not null or old.production_authorized_by is not null
     or new.production_authorized_at is not null or new.production_authorized_by is not null then
    raise exception 'Los datos financieros no pueden modificarse después de autorizar Producción.';
  end if;

  select p.role into v_role from public.profiles p
  where p.id = v_actor and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_actor is null or v_role is null then
    raise exception 'No hay un usuario activo autorizado para modificar datos financieros.';
  end if;

  if new.payment_status is distinct from old.payment_status
     or new.invoice_payment is distinct from old.invoice_payment then
    v_credit_settlement := old.payment_status = 'credito'
      and new.payment_status = 'pagado'
      and old.status is not distinct from new.status;
    if v_role <> 'quote' or old.quote_id is distinct from v_actor
       or new.quote_id is distinct from v_actor
       or (not v_credit_settlement and (old.status <> 'in_Quote' or new.status <> 'in_Quote'))
       or old.status = 'cancelled' or new.status = 'cancelled'
       or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
       or coalesce(old.is_archived_admin, false) or coalesce(new.is_archived_admin, false)
       or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
      raise exception 'Solo el responsable asignado de Caja puede modificar el pago o comprobante.';
    end if;
  end if;

  if new.invoice_number is distinct from old.invoice_number then
    if coalesce(new.invoice_assignment_mode, old.invoice_assignment_mode, 'seller') = 'cashier' then
      if v_role <> 'quote' or old.quote_id is distinct from v_actor
         or new.quote_id is distinct from v_actor
         or old.status <> 'in_Quote' or new.status <> 'in_Quote'
         or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
         or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
        raise exception 'Solo la Caja asignada puede registrar este código de facturación.';
      end if;
    elsif coalesce(new.invoice_assignment_mode, old.invoice_assignment_mode, 'seller') = 'seller' then
      if v_role <> 'seller'
         or (old.seller_id is distinct from v_actor and old.created_by is distinct from v_actor)
         or (new.seller_id is distinct from v_actor and new.created_by is distinct from v_actor)
         or old.status not in ('Pending', 'pending') or new.status not in ('Pending', 'pending')
         or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
         or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
        raise exception 'Solo Ventas responsable puede asignar el código cuando la factura pertenece a Ventas.';
      end if;
    else
      raise exception 'Responsabilidad de facturación inválida.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_financial_write_ownership() from public, anon, authenticated;

notify pgrst, 'reload schema';
