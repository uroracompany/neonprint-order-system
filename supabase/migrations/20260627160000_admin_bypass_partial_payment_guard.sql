-- Admin puede cambiar estado de pago de parcial a cualquier estado
-- La restriccion de solo permitir parcial->pagado se mantiene para no-admin (caja)

create or replace function public.enforce_partial_payment_order_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := public.current_profile_is_admin();
  v_role text := coalesce(public.current_profile_role(), '');
begin
  if tg_op = 'UPDATE'
    and old.payment_status = 'parcial'
    and new.payment_status not in ('parcial', 'pagado')
    and v_role <> 'admin' then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'parcial'
    and new.payment_status = 'pagado'
    and nullif(trim(coalesce(new.invoice_payment, '')), '') is null then
    raise exception 'Debes adjuntar la factura para marcar como pagado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'credito'
    and new.payment_status not in ('credito', 'pagado') then
    raise exception 'Una orden a credito solo puede mantenerse a credito o cambiarse a pagado mediante un cierre registrado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'credito'
    and new.payment_status = 'pagado'
    and not exists (
      select 1
      from public.accounts_receivable ar
      where ar.order_id = new.id
        and ar.status = 'paid'
    ) then
    raise exception 'Debes cerrar la cuenta por cobrar antes de marcar el credito como pagado.';
  end if;

  if new.payment_status = 'parcial' then
    new.invoice_payment := null;
  end if;

  if new.payment_status = 'credito' then
    if (
        tg_op = 'INSERT'
        or (tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status)
      )
      and v_role not in ('admin', 'quote') then
      raise exception 'Solo caja o admin pueden aprobar pago a credito.';
    end if;

    if new.client_id is null then
      raise exception 'Para vender a credito debes registrar y vincular este cliente.';
    end if;

    if nullif(trim(coalesce(new.invoice_number, '')), '') is null then
      raise exception 'La orden debe tener un numero de facturacion para vender a credito.';
    end if;

    new.invoice_payment := null;
  end if;

  if new.status = 'in_Delivered' and new.payment_status not in ('pagado', 'credito') then
    raise exception 'No se puede entregar la orden hasta que este totalmente pagada o aprobada a credito.';
  end if;

  if new.payment_status = 'parcial' and new.status = 'cancelled' then
    raise exception 'No se puede cancelar una orden con pago parcial.';
  end if;

  if new.payment_status = 'credito'
    and new.status = 'cancelled'
    and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden a credito.';
  end if;

  if new.payment_status = 'pagado'
    and new.status = 'cancelled'
    and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden pagada.';
  end if;

  if new.payment_status = 'parcial' and (
    coalesce(new.is_archived, false)
    or coalesce(new.is_archived_admin, false)
    or coalesce(new.is_archived_designer, false)
    or coalesce(new.is_archived_quote, false)
    or coalesce(new.is_archived_delivery, false)
    or coalesce(new.is_archived_production, false)
  ) then
    raise exception 'No se puede archivar una orden con pago parcial.';
  end if;

  return new;
end;
$$;
