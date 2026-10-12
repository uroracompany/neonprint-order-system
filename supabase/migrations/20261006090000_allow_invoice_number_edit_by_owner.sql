-- Allow the responsible seller or Semi-Admin to maintain the invoice number
-- during their editable stages, while keeping Caja as the only operational
-- owner of cashier-assigned codes. Administrative edits remain gated by the
-- audited admin command context.

create or replace function public.guard_order_financial_write_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_command text := current_setting('app.neonprint_order_command', true);
  v_invoice_mode text := coalesce(new.invoice_assignment_mode, old.invoice_assignment_mode, 'seller');
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
    -- The admin RPC validates the active actor, locks the row, checks the
    -- expected version, and records the intervention before setting this
    -- transaction-local command context. This branch does not authorize any
    -- payment or receipt mutation.
    if v_role = 'admin' and v_command = 'on' then
      null;
    elsif v_invoice_mode = 'cashier' then
      if v_role <> 'quote' or old.quote_id is distinct from v_actor
         or new.quote_id is distinct from v_actor
         or old.status <> 'in_Quote' or new.status <> 'in_Quote'
         or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
         or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
        raise exception 'Solo la Caja asignada puede registrar este código de facturación.';
      end if;
    elsif v_invoice_mode = 'seller' then
      if v_role = 'seller' then
        if (old.seller_id is distinct from v_actor and old.created_by is distinct from v_actor)
           or (new.seller_id is distinct from v_actor and new.created_by is distinct from v_actor)
           or old.status not in ('Pending', 'pending') or new.status not in ('Pending', 'pending')
           or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
           or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
          raise exception 'Solo Ventas responsable puede asignar el código cuando la factura pertenece a Ventas.';
        end if;
      elsif v_role = 'semi_admin' then
        if (old.seller_id is distinct from v_actor and old.created_by is distinct from v_actor)
           or (new.seller_id is distinct from v_actor and new.created_by is distinct from v_actor)
           or old.status not in ('Pending', 'pending', 'in_Design', 'In_Design')
           or new.status not in ('Pending', 'pending', 'in_Design', 'In_Design')
           or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
           or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
          raise exception 'Semi-Admin solo puede editar el código propio mientras la orden esté en Ventas o Diseño.';
        end if;
      else
        raise exception 'Solo Ventas o Semi-Admin responsable puede asignar el código cuando la factura pertenece a Ventas.';
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
