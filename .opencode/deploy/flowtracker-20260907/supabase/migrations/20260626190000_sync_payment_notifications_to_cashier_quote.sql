-- Route payment notifications to the cashier/quote user related to the order.
-- This keeps the existing notification format while avoiding role-wide quote broadcasts.

create or replace function public.order_cashier_quote_recipients(
  p_order public.orders
)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct p_order.quote_id), array[]::uuid[])
  from public.profiles p
  where p.id = p_order.quote_id
    and p.role = 'quote'
    and coalesce(p.employment_status, true) = true
$$;

create or replace function public.admin_order_edit_notice_recipients(
  p_area text,
  p_order public.orders,
  p_actor_id uuid
)
returns uuid[]
language plpgsql
stable
set search_path = public
as $$
declare
  base_recipients uuid[] := array[p_order.seller_id, p_order.created_by, p_order.designer_id]
    || public.admin_order_edit_production_recipients(p_order);
  recipients uuid[] := array[]::uuid[];
begin
  if p_area = 'quote' then
    recipients := base_recipients
      || public.order_cashier_quote_recipients(p_order);
  elsif p_area = 'design' then
    recipients := base_recipients || public.get_role_user_ids('designer');
  elsif p_area = 'production' then
    recipients := base_recipients
      || public.admin_order_edit_production_recipients(p_order);
  elsif p_area = 'delivery' then
    recipients := base_recipients
      || array[p_order.delivery_id]
      || public.get_role_user_ids('delivery');
  elsif p_area = 'assignment' then
    recipients := base_recipients || array[
      p_order.quote_id,
      p_order.delivery_id
    ];
  else
    recipients := base_recipients;
  end if;

  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
    into recipients
  from unnest(coalesce(recipients, array[]::uuid[])) as recipient_id
  where recipient_id is not null
    and recipient_id is distinct from p_actor_id;

  return recipients;
end;
$$;

do $$
declare
  v_definition text;
  v_original_condition text := 'if new.payment_status is distinct from old.payment_status then';
  v_credit_condition text := 'if new.payment_status is distinct from old.payment_status
    and new.payment_status <> ''credito'' then';
  v_payment_asset_condition text := 'if (new.payment_status is distinct from old.payment_status
    or new.invoice_payment is distinct from old.invoice_payment)
    and new.payment_status <> ''credito'' then';
begin
  select pg_get_functiondef('public.handle_order_change_notification()'::regprocedure)
  into v_definition;

  if v_definition like '%' || v_original_condition || '%' then
    v_definition := replace(v_definition, v_original_condition, v_payment_asset_condition);
  elsif v_definition like '%' || v_credit_condition || '%' then
    v_definition := replace(v_definition, v_credit_condition, v_payment_asset_condition);
  elsif v_definition not like '%' || v_payment_asset_condition || '%' then
    raise exception 'Could not patch handle_order_change_notification payment condition';
  end if;

  v_definition := replace(
    v_definition,
    'perform public.notify_many(
      array_remove(quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins, null),
      ''order_updated'',
      ''Pago actualizado'',',
    'perform public.notify_many(
      array_remove(public.order_cashier_quote_recipients(new) || array[new.seller_id, new.created_by, actor_id] || admins, null),
      ''order_updated'',
      ''Pago actualizado'','
  );

  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.mark_order_as_credit(uuid, timestamptz)'::regprocedure)
  into v_definition;

  v_definition := replace(
    v_definition,
    'v_recipients := array_remove(public.get_admin_user_ids() || public.get_role_user_ids(''quote''), null);',
    'v_recipients := array_remove(public.get_admin_user_ids() || public.order_cashier_quote_recipients(v_updated_order), null);'
  );

  if v_definition like '%get_role_user_ids(''quote'')%' then
    raise exception 'Could not patch mark_order_as_credit quote recipients';
  end if;

  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
  v_scoped_settled_recipients text := 'select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
  into v_recipients
  from (
    select unnest(public.get_admin_user_ids()) as recipient_id
    union all
    select o.quote_id as recipient_id
    from public.orders o
    join public.profiles p
      on p.id = o.quote_id
      and p.role = ''quote''
      and coalesce(p.employment_status, true) = true
    where o.id = any(v_settled_order_ids)
  ) scoped_recipients
  where recipient_id is not null;';
begin
  select pg_get_functiondef('public.settle_credit_orders(uuid[], text, text)'::regprocedure)
  into v_definition;

  v_definition := replace(
    v_definition,
    'v_recipients := array_remove(public.get_admin_user_ids() || public.get_role_user_ids(''quote''), null);',
    v_scoped_settled_recipients
  );

  if v_definition like '%get_role_user_ids(''quote'')%' then
    raise exception 'Could not patch settle_credit_orders quote recipients';
  end if;

  execute v_definition;
end;
$$;

revoke all on function public.order_cashier_quote_recipients(public.orders) from public;
revoke all on function public.order_cashier_quote_recipients(public.orders) from anon;
revoke all on function public.order_cashier_quote_recipients(public.orders) from authenticated;

revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from public;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from anon;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from authenticated;

revoke all on function public.handle_order_change_notification() from public;
revoke all on function public.handle_order_change_notification() from anon;
revoke all on function public.handle_order_change_notification() from authenticated;

revoke all on function public.mark_order_as_credit(uuid, timestamptz) from public;
revoke all on function public.mark_order_as_credit(uuid, timestamptz) from anon;
grant execute on function public.mark_order_as_credit(uuid, timestamptz) to authenticated;

revoke all on function public.settle_credit_orders(uuid[], text, text) from public;
revoke all on function public.settle_credit_orders(uuid[], text, text) from anon;
grant execute on function public.settle_credit_orders(uuid[], text, text) to authenticated;
