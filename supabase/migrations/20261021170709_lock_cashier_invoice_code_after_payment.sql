-- A cashier-owned invoice code is editable only while the payment remains
-- unconfirmed. This guard also covers direct UPDATEs and the existing RPC.
create or replace function public.guard_cashier_invoice_code_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invoice_number is not distinct from old.invoice_number then
    return new;
  end if;

  if coalesce(old.invoice_assignment_mode, 'seller') = 'cashier'
     or coalesce(new.invoice_assignment_mode, 'seller') = 'cashier' then
    if old.payment_status is distinct from 'Pending_Payment'
       or new.payment_status is distinct from 'Pending_Payment' then
      raise exception 'El código de facturación de Caja no puede cambiarse después de confirmar el pago.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_cashier_invoice_code_pending() from public, anon, authenticated;

drop trigger if exists trg_guard_cashier_invoice_code_pending on public.orders;
create trigger trg_guard_cashier_invoice_code_pending
before update of invoice_number on public.orders
for each row
execute function public.guard_cashier_invoice_code_pending();
