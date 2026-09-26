-- Prevent duplicate success toasts when an order is marked as payment on credit.
-- mark_order_as_credit already emits the credit_granted notification; the generic
-- payment_updated notification from the order trigger should not fire for credito.

do $$
declare
  v_definition text;
  v_original_condition text := 'if new.payment_status is distinct from old.payment_status then';
  v_credit_condition text := 'if new.payment_status is distinct from old.payment_status
    and new.payment_status <> ''credito'' then';
begin
  select pg_get_functiondef('public.handle_order_change_notification()'::regprocedure)
  into v_definition;

  if v_definition like '%' || v_credit_condition || '%' then
    return;
  end if;

  if v_definition not like '%' || v_original_condition || '%' then
    raise exception 'Could not patch handle_order_change_notification payment notification condition';
  end if;

  v_definition := replace(v_definition, v_original_condition, v_credit_condition);
  execute v_definition;
end;
$$;

revoke all on function public.handle_order_change_notification() from public;
revoke all on function public.handle_order_change_notification() from anon;
revoke all on function public.handle_order_change_notification() from authenticated;

