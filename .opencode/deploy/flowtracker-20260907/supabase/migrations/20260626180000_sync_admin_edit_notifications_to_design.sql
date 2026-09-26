-- Synchronize admin edit notifications between Sales and assigned Design.
-- The message payload stays unchanged; this only expands the recipient list.

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

create or replace function public.admin_order_edit_production_recipients(
  p_order public.orders
)
returns uuid[]
language sql
stable
set search_path = public
as $$
  with legacy_assignee as (
    select p_order.production_id as recipient_id
    where p_order.production_id is not null
  ),
  area_assignees as (
    select opa.assigned_to as recipient_id
    from public.order_production_assignments opa
    join public.production_areas pa
      on pa.code = opa.production_area_code
      and pa.is_active = true
    join public.profiles p
      on p.id = opa.assigned_to
      and p.role = pa.producer_role
      and coalesce(p.employment_status, true) = true
    where opa.order_id = p_order.id
  ),
  file_assignees as (
    select opf.assigned_to as recipient_id
    from public.order_production_files opf
    join public.production_areas pa
      on pa.code = opf.production_area_code
      and pa.is_active = true
    join public.profiles p
      on p.id = opf.assigned_to
      and p.role = pa.producer_role
      and coalesce(p.employment_status, true) = true
    where opf.order_id = p_order.id
      and opf.assigned_to is not null
  )
  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
  from (
    select recipient_id from legacy_assignee
    union all
    select recipient_id from area_assignees
    union all
    select recipient_id from file_assignees
  ) recipients
  where recipient_id is not null
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

revoke all on function public.order_cashier_quote_recipients(public.orders) from public;
revoke all on function public.order_cashier_quote_recipients(public.orders) from anon;
revoke all on function public.order_cashier_quote_recipients(public.orders) from authenticated;

revoke all on function public.admin_order_edit_production_recipients(public.orders) from public;
revoke all on function public.admin_order_edit_production_recipients(public.orders) from anon;
revoke all on function public.admin_order_edit_production_recipients(public.orders) from authenticated;

revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from public;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from anon;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from authenticated;
