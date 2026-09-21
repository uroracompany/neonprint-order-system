-- Narrow Semi-Administración exceptions: client registration, cancellation of
-- owned unpaid pre-production orders, and the already-authorized payment command.

create or replace function public.semi_admin_create_client(p_client jsonb)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_name text := nullif(btrim(coalesce(p_client->>'name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_client->>'phone', '')), '');
  v_email text := nullif(btrim(coalesce(p_client->>'email', '')), '');
  v_address text := nullif(btrim(coalesce(p_client->>'address', '')), '');
  v_notes text := nullif(btrim(coalesce(p_client->>'notes', '')), '');
  v_client public.clients;
begin
  if v_name is null or length(v_name) < 2 then
    raise exception 'Escribe el nombre del cliente.';
  end if;
  if v_phone is null or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 3 then
    raise exception 'Escribe un número de teléfono válido.';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Escribe un correo válido.';
  end if;

  insert into public.clients (name, phone, email, address, notes, created_by)
  values (v_name, v_phone, v_email, v_address, v_notes, v_actor)
  returning * into v_client;
  return v_client;
end;
$$;

create or replace function public.semi_admin_cancel_owned_unpaid_order(
  p_order_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor then
    raise exception 'No tienes acceso a esta orden.';
  end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then
    raise exception 'La orden no está disponible para cancelar.';
  end if;
  if v_order.status not in ('Pending', 'in_Design', 'in_Quote') then
    raise exception 'Solo se pueden cancelar órdenes previas a Producción.';
  end if;
  if v_order.payment_status <> 'Pending_Payment' then
    raise exception 'Solo se pueden cancelar órdenes con pago pendiente.';
  end if;
  if v_reason is null then raise exception 'Debes indicar el motivo de cancelacion.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'cancelled',
      cancellation_reason = v_reason,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  insert into public.order_events (order_id, actor_id, event_type, old_status, new_status, changes)
  values (p_order_id, v_actor, 'semi_admin_owned_unpaid_order_cancelled', v_order.status, v_updated.status,
    jsonb_build_object('reason', v_reason));
  return v_updated;
end;
$$;

-- Keep all payment and credit lifecycle guards. The sole new credit exception
-- is the transaction-local marker set by semi_admin_register_order_payment
-- after it has checked the actor, responsibility, client, invoice and version.
create or replace function public.enforce_partial_payment_order_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := public.current_profile_is_admin();
  v_role text := coalesce(public.current_profile_role(), '');
  v_authorized_semi_admin_credit boolean := v_role = 'semi_admin'
    and current_setting('app.neonprint_order_command', true) = 'on';
  v_has_payment_evidence boolean := nullif(btrim(coalesce(new.invoice_payment, '')), '') is not null
    or nullif(btrim(coalesce(new.invoice_number, '')), '') is not null;
begin
  if tg_op = 'UPDATE' and old.payment_status = 'parcial' and new.payment_status not in ('parcial', 'pagado') and v_role <> 'admin' then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'parcial' and new.payment_status = 'pagado' and not v_has_payment_evidence then
    raise exception 'Debes adjuntar la factura o ingresar un número de comprobante para marcar como pagado.';
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'credito' and new.payment_status not in ('credito', 'pagado')
    and not (old.status = 'cancelled' and new.status <> 'cancelled' and new.payment_status = 'Pending_Payment') then
    raise exception 'Una orden a crédito solo puede mantenerse a crédito o cambiarse a pagado mediante un cierre registrado.';
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'credito' and new.payment_status = 'pagado'
    and not exists (select 1 from public.accounts_receivable ar where ar.order_id = new.id and ar.status = 'resolved') then
    raise exception 'Debes cerrar el seguimiento de crédito antes de marcar la orden como pagada.';
  end if;
  if new.payment_status = 'parcial' then new.invoice_payment := null; end if;
  if new.payment_status = 'credito' then
    if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status))
      and v_role not in ('admin', 'quote') and not v_authorized_semi_admin_credit then
      raise exception 'Solo Caja o Administración pueden aprobar pago a crédito.';
    end if;
    if new.client_id is null or nullif(btrim(coalesce(new.invoice_number, '')), '') is null then
      raise exception 'Para vender a crédito debes registrar cliente y factura.';
    end if;
    new.invoice_payment := null;
  end if;
  if new.status = 'in_Delivered' and new.payment_status not in ('pagado', 'credito') then
    raise exception 'No se puede entregar la orden hasta que este totalmente pagada o aprobada a crédito.';
  end if;
  if new.payment_status = 'parcial' and new.status = 'cancelled' then
    raise exception 'No se puede cancelar una orden con pago parcial.';
  end if;
  if new.payment_status = 'credito' and new.status = 'cancelled' and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden a crédito.';
  end if;
  if new.payment_status = 'pagado' and new.status = 'cancelled' and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden pagada.';
  end if;
  return new;
end;
$$;

revoke all on function public.semi_admin_create_client(jsonb) from public, anon;
revoke all on function public.semi_admin_cancel_owned_unpaid_order(uuid, text, timestamptz) from public, anon;
grant execute on function public.semi_admin_create_client(jsonb) to authenticated;
grant execute on function public.semi_admin_cancel_owned_unpaid_order(uuid, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
