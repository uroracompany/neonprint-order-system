-- Server-side client directory for the administrator dashboard.
-- Keeps pagination, filtering and aggregate metrics inside PostgreSQL so the
-- browser never needs to download every client/order to render this module.

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_clients_email_trgm
  on public.clients using gin ((coalesce(email, '')) gin_trgm_ops);

create index if not exists idx_orders_client_created_at
  on public.orders (client_id, created_at desc)
  where client_id is not null;

create index if not exists idx_orders_client_status_created_at
  on public.orders (client_id, status, created_at desc)
  where client_id is not null;

create or replace function public.admin_list_clients(
  p_page integer default 1,
  p_page_size integer default 7,
  p_search text default null,
  p_credit_filter text default 'all',
  p_activity_filter text default 'all',
  p_frequency_filter text default 'all',
  p_registered_from date default null,
  p_registered_to date default null,
  p_sort text default 'recent_activity_desc'
)
returns table (
  id uuid,
  name text,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  total_orders bigint,
  active_orders bigint,
  completed_orders bigint,
  cancelled_orders bigint,
  last_order_at timestamptz,
  active_credit_count bigint,
  credit_history_count bigint,
  settled_credit_count bigint,
  oldest_pending_credit_at timestamptz,
  is_frequent boolean,
  is_inactive boolean,
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
    raise exception 'Solo administradores pueden consultar el directorio de clientes.';
  end if;

  if coalesce(p_credit_filter, 'all') not in ('all', 'with_credit', 'without_credit')
    or coalesce(p_activity_filter, 'all') not in ('all', 'with_active', 'without_active', 'inactive')
    or coalesce(p_frequency_filter, 'all') not in ('all', 'frequent', 'not_frequent')
    or coalesce(p_sort, 'recent_activity_desc') not in ('recent_activity_desc', 'name_asc', 'name_desc', 'registered_desc', 'registered_asc') then
    raise exception 'Uno o más filtros del directorio no son válidos.';
  end if;

  return query
  with order_stats as (
    select
      o.client_id,
      count(*)::bigint as total_orders,
      count(*) filter (where lower(coalesce(o.status, '')) not in ('cancelled', 'in_completed', 'in_delivered'))::bigint as active_orders,
      count(*) filter (where lower(coalesce(o.status, '')) in ('in_completed', 'in_delivered'))::bigint as completed_orders,
      count(*) filter (where lower(coalesce(o.status, '')) = 'cancelled')::bigint as cancelled_orders,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.client_id is not null
    group by o.client_id
  ),
  credit_stats as (
    select
      ar.client_id,
      count(*) filter (where ar.status in ('open', 'partial'))::bigint as active_credit_count,
      count(*) filter (where ar.status <> 'void')::bigint as credit_history_count,
      count(*) filter (where ar.status = 'paid')::bigint as settled_credit_count,
      min(coalesce(ar.issued_at, ar.created_at)) filter (where ar.status in ('open', 'partial')) as oldest_pending_credit_at
    from public.accounts_receivable ar
    group by ar.client_id
  ),
  enriched as (
    select
      c.id,
      c.name,
      c.phone,
      c.email,
      c.address,
      c.notes,
      c.created_at,
      c.updated_at,
      coalesce(os.total_orders, 0::bigint) as total_orders,
      coalesce(os.active_orders, 0::bigint) as active_orders,
      coalesce(os.completed_orders, 0::bigint) as completed_orders,
      coalesce(os.cancelled_orders, 0::bigint) as cancelled_orders,
      os.last_order_at,
      coalesce(cs.active_credit_count, 0::bigint) as active_credit_count,
      coalesce(cs.credit_history_count, 0::bigint) as credit_history_count,
      coalesce(cs.settled_credit_count, 0::bigint) as settled_credit_count,
      cs.oldest_pending_credit_at,
      coalesce(os.completed_orders, 0) >= 5 as is_frequent,
      (
        (os.last_order_at is not null and os.last_order_at < now() - interval '180 days')
        or (os.last_order_at is null and c.created_at < now() - interval '180 days')
      ) as is_inactive
    from public.clients c
    left join order_stats os on os.client_id = c.id
    left join credit_stats cs on cs.client_id = c.id
  ),
  filtered as (
    select e.*
    from enriched e
    where (
      v_search is null
      or e.name ilike '%' || v_search || '%'
      or e.phone ilike '%' || v_search || '%'
      or coalesce(e.email, '') ilike '%' || v_search || '%'
      or e.id::text ilike '%' || v_search || '%'
    )
      and (p_registered_from is null or e.created_at >= p_registered_from::timestamptz)
      and (p_registered_to is null or e.created_at < (p_registered_to + 1)::timestamptz)
      and (
        p_credit_filter = 'all'
        or (p_credit_filter = 'with_credit' and e.credit_history_count > 0)
        or (p_credit_filter = 'without_credit' and e.credit_history_count = 0)
      )
      and (
        p_activity_filter = 'all'
        or (p_activity_filter = 'with_active' and e.active_orders > 0)
        or (p_activity_filter = 'without_active' and e.active_orders = 0 and not e.is_inactive)
        or (p_activity_filter = 'inactive' and e.is_inactive)
      )
      and (
        p_frequency_filter = 'all'
        or (p_frequency_filter = 'frequent' and e.is_frequent)
        or (p_frequency_filter = 'not_frequent' and not e.is_frequent)
      )
  )
  select
    f.id, f.name, f.phone, f.email, f.address, f.notes, f.created_at, f.updated_at,
    f.total_orders, f.active_orders, f.completed_orders, f.cancelled_orders, f.last_order_at,
    f.active_credit_count, f.credit_history_count, f.settled_credit_count,
    f.oldest_pending_credit_at, f.is_frequent, f.is_inactive,
    count(*) over()::bigint as total_count
  from filtered f
  order by
    case when p_sort = 'name_asc' then lower(f.name) end asc,
    case when p_sort = 'name_desc' then lower(f.name) end desc,
    case when p_sort = 'registered_asc' then f.created_at end asc,
    case when p_sort = 'registered_desc' then f.created_at end desc,
    case when p_sort = 'recent_activity_desc' then coalesce(f.last_order_at, f.created_at) end desc,
    f.id asc
  limit v_page_size
  offset (v_page - 1) * v_page_size;
end;
$$;

revoke all on function public.admin_list_clients(integer, integer, text, text, text, text, date, date, text) from public;
revoke all on function public.admin_list_clients(integer, integer, text, text, text, text, date, date, text) from anon;
grant execute on function public.admin_list_clients(integer, integer, text, text, text, text, date, date, text) to authenticated;

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
