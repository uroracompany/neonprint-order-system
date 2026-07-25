-- Keep the client catalog consistent with linked operational records.
-- Admin edits to a registered client must not leave order snapshots stale, and
-- deleting a client with history must not orphan orders or credit records.

create or replace function public.sync_orders_from_updated_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.name is not distinct from new.name
    and old.phone is not distinct from new.phone then
    return new;
  end if;

  perform set_config('app.admin_intervention_context', 'client_directory_sync', true);

  update public.orders
  set
    client_name = new.name,
    client_contact = new.phone
  where client_id = new.id
    and (
      client_name is distinct from new.name
      or client_contact is distinct from new.phone
    );

  return new;
end;
$$;

revoke all on function public.sync_orders_from_updated_client() from public;
revoke all on function public.sync_orders_from_updated_client() from anon;
revoke all on function public.sync_orders_from_updated_client() from authenticated;

drop trigger if exists trg_sync_orders_from_updated_client on public.clients;
create trigger trg_sync_orders_from_updated_client
  after update of name, phone on public.clients
  for each row
  execute function public.sync_orders_from_updated_client();

create or replace function public.prevent_client_delete_with_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.orders o where o.client_id = old.id) then
    raise exception 'No se puede eliminar un cliente con ordenes registradas.';
  end if;

  if exists (select 1 from public.accounts_receivable ar where ar.client_id = old.id) then
    raise exception 'No se puede eliminar un cliente con historial de credito.';
  end if;

  if to_regclass('public.credit_custom_reminders') is not null
    and exists (select 1 from public.credit_custom_reminders cr where cr.client_id = old.id) then
    raise exception 'No se puede eliminar un cliente con recordatorios de credito.';
  end if;

  return old;
end;
$$;

revoke all on function public.prevent_client_delete_with_relations() from public;
revoke all on function public.prevent_client_delete_with_relations() from anon;
revoke all on function public.prevent_client_delete_with_relations() from authenticated;

drop trigger if exists trg_prevent_client_delete_with_open_receivables on public.clients;
drop trigger if exists trg_prevent_client_delete_with_relations on public.clients;
create trigger trg_prevent_client_delete_with_relations
  before delete on public.clients
  for each row
  execute function public.prevent_client_delete_with_relations();

create or replace function public.admin_list_client_orders(
  p_client_id uuid,
  p_page integer default 1,
  p_page_size integer default 7,
  p_search text default null,
  p_status_filter text default 'all',
  p_payment_filter text default 'all',
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  id uuid,
  invoice_number text,
  description text,
  status text,
  payment_status text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 7), 1), 50);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.current_profile_is_admin() then
    raise exception 'Solo administradores pueden consultar las ordenes de un cliente.';
  end if;

  if coalesce(p_status_filter, 'all') not in (
    'all',
    'Pending',
    'in_Design',
    'in_Quote',
    'in_Production',
    'in_Termination',
    'in_Delivered',
    'in_Completed',
    'cancelled'
  )
    or coalesce(p_payment_filter, 'all') not in ('all', 'Pending_Payment', 'parcial', 'credito', 'pagado') then
    raise exception 'Uno o mas filtros de ordenes del cliente no son validos.';
  end if;

  return query
  with filtered as (
    select
      o.id,
      o.invoice_number,
      o.description,
      o.status,
      o.payment_status,
      o.created_at,
      o.updated_at
    from public.orders o
    where o.client_id = p_client_id
      and (
        v_search is null
        or o.id::text ilike '%' || v_search || '%'
        or coalesce(o.invoice_number, '') ilike '%' || v_search || '%'
        or coalesce(o.description, '') ilike '%' || v_search || '%'
        or lower(coalesce(o.status, '')) ilike '%' || lower(v_search) || '%'
        or lower(coalesce(o.payment_status, '')) ilike '%' || lower(v_search) || '%'
      )
      and (
        p_status_filter = 'all'
        or lower(o.status) = lower(p_status_filter)
      )
      and (
        p_payment_filter = 'all'
        or lower(o.payment_status) = lower(p_payment_filter)
      )
      and (p_date_from is null or o.created_at >= p_date_from::timestamptz)
      and (p_date_to is null or o.created_at < (p_date_to + 1)::timestamptz)
  )
  select
    f.id, f.invoice_number, f.description, f.status, f.payment_status,
    f.created_at, f.updated_at,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.created_at desc
  limit v_page_size
  offset (v_page - 1) * v_page_size;
end;
$$;

revoke all on function public.admin_list_client_orders(uuid, integer, integer, text, text, text, date, date) from public;
revoke all on function public.admin_list_client_orders(uuid, integer, integer, text, text, text, date, date) from anon;
grant execute on function public.admin_list_client_orders(uuid, integer, integer, text, text, text, date, date) to authenticated;

create or replace function public.admin_get_client_detail(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.current_profile_is_admin() then
    raise exception 'Solo administradores pueden consultar el detalle de clientes.';
  end if;

  select jsonb_build_object(
    'client', to_jsonb(c),
    'stats', jsonb_build_object(
      'total_orders', coalesce(os.total_orders, 0),
      'urgent_911_orders', coalesce(os.urgent_911_orders, 0),
      'normal_orders', coalesce(os.normal_orders, 0),
      'internal_design_orders', coalesce(os.internal_design_orders, 0),
      'external_design_orders', coalesce(os.external_design_orders, 0),
      'active_orders', coalesce(os.active_orders, 0),
      'completed_orders', coalesce(os.completed_orders, 0),
      'cancelled_orders', coalesce(os.cancelled_orders, 0),
      'last_order_at', os.last_order_at,
      'active_credit_count', coalesce(cs.active_credit_count, 0),
      'credit_history_count', coalesce(cs.credit_history_count, 0),
      'settled_credit_count', coalesce(cs.settled_credit_count, 0),
      'oldest_pending_credit_at', cs.oldest_pending_credit_at,
      'is_frequent', coalesce(os.completed_orders, 0) >= 5,
      'is_inactive', (
        (os.last_order_at is not null and os.last_order_at < now() - interval '180 days')
        or (os.last_order_at is null and c.created_at < now() - interval '180 days')
      )
    ),
    'recent_orders', coalesce(recent.items, '[]'::jsonb)
  )
  into v_result
  from public.clients c
  left join lateral (
    select
      count(*)::bigint as total_orders,
      count(*) filter (where o.order_type = 'orden 911')::bigint as urgent_911_orders,
      count(*) filter (where o.order_type = 'orden normal')::bigint as normal_orders,
      count(*) filter (where o.order_design_type = 'INTERNAL_DESING')::bigint as internal_design_orders,
      count(*) filter (where o.order_design_type = 'EXTERNAL_DESING')::bigint as external_design_orders,
      count(*) filter (where lower(coalesce(o.status, '')) not in ('cancelled', 'in_completed', 'in_delivered'))::bigint as active_orders,
      count(*) filter (where lower(coalesce(o.status, '')) in ('in_completed', 'in_delivered'))::bigint as completed_orders,
      count(*) filter (where lower(coalesce(o.status, '')) = 'cancelled')::bigint as cancelled_orders,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.client_id = c.id
  ) os on true
  left join lateral (
    select
      count(*) filter (where ar.status in ('open', 'partial'))::bigint as active_credit_count,
      count(*) filter (where ar.status <> 'void')::bigint as credit_history_count,
      count(*) filter (where ar.status = 'paid')::bigint as settled_credit_count,
      min(coalesce(ar.issued_at, ar.created_at)) filter (where ar.status in ('open', 'partial')) as oldest_pending_credit_at
    from public.accounts_receivable ar
    where ar.client_id = c.id
  ) cs on true
  left join lateral (
    select jsonb_agg(to_jsonb(recent_order) order by recent_order.created_at desc) as items
    from (
      select o.id, o.invoice_number, o.description, o.status, o.payment_status, o.created_at, o.updated_at
      from public.orders o
      where o.client_id = c.id
      order by o.created_at desc
      limit 8
    ) recent_order
  ) recent on true
  where c.id = p_client_id;

  if v_result is null then
    raise exception 'El cliente solicitado no existe.';
  end if;

  return v_result;
end;
$$;

revoke all on function public.admin_get_client_detail(uuid) from public;
revoke all on function public.admin_get_client_detail(uuid) from anon;
grant execute on function public.admin_get_client_detail(uuid) to authenticated;
