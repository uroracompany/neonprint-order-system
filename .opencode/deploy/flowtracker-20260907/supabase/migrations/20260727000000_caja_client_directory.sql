-- Client directory for the Caja (quote) module.
-- Simplified version of admin_list_clients / admin_get_client_detail
-- with role gate for admin + quote (caja).

create or replace function public.caja_list_clients(
  p_page integer default 1,
  p_page_size integer default 7,
  p_search text default null,
  p_sort text default 'name_asc'
)
returns table (
  id uuid,
  name text,
  phone text,
  email text,
  created_at timestamptz,
  total_orders bigint,
  last_order_at timestamptz,
  total_spent numeric(12, 2),
  pending_credit boolean,
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
  v_role text := coalesce(public.current_profile_role(), '');
begin
  if v_role not in ('admin', 'quote') then
    raise exception 'Solo administradores y caja pueden consultar el directorio de clientes.';
  end if;

  if coalesce(p_sort, 'name_asc') not in ('name_asc', 'name_desc', 'last_order_desc', 'most_orders') then
    raise exception 'El ordenamiento solicitado no es valido.';
  end if;

  return query
  with client_stats as (
    select
      c.id,
      c.name,
      c.phone,
      c.email,
      c.created_at,
      count(o.id)::bigint as total_orders,
      max(o.created_at) as last_order_at,
      coalesce(sum(o.price) filter (where o.payment_status = 'paid'), 0)::numeric(12,2) as total_spent,
      bool_or(ar.status in ('open', 'partial')) as pending_credit
    from public.clients c
    left join public.orders o on o.client_id = c.id
    left join public.accounts_receivable ar on ar.client_id = c.id
    group by c.id
  ),
  filtered as (
    select cs.*
    from client_stats cs
    where (
      v_search is null
      or cs.name ilike '%' || v_search || '%'
      or cs.phone ilike '%' || v_search || '%'
      or coalesce(cs.email, '') ilike '%' || v_search || '%'
      or cs.id::text ilike '%' || v_search || '%'
    )
  )
  select
    f.id, f.name, f.phone, f.email, f.created_at,
    f.total_orders, f.last_order_at, f.total_spent,
    coalesce(f.pending_credit, false) as pending_credit,
    count(*) over()::bigint as total_count
  from filtered f
  order by
    case when p_sort = 'name_asc' then lower(f.name) end asc nulls last,
    case when p_sort = 'name_desc' then lower(f.name) end desc nulls last,
    case when p_sort = 'last_order_desc' then f.last_order_at end desc nulls last,
    case when p_sort = 'most_orders' then f.total_orders end desc nulls last,
    f.name asc
  limit v_page_size
  offset (v_page - 1) * v_page_size;
end;
$$;

revoke all on function public.caja_list_clients(integer, integer, text, text) from public;
revoke all on function public.caja_list_clients(integer, integer, text, text) from anon;
grant execute on function public.caja_list_clients(integer, integer, text, text) to authenticated;


create or replace function public.caja_get_client_detail(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_role text := coalesce(public.current_profile_role(), '');
  v_result jsonb;
begin
  if v_role not in ('admin', 'quote') then
    raise exception 'No tiene acceso al detalle de clientes.';
  end if;

  select jsonb_build_object(
    'client', to_jsonb(c),
    'stats', jsonb_build_object(
      'total_orders', coalesce(os.total_orders, 0),
      'active_orders', coalesce(os.active_orders, 0),
      'completed_orders', coalesce(os.completed_orders, 0),
      'cancelled_orders', coalesce(os.cancelled_orders, 0),
      'last_order_at', os.last_order_at,
      'total_spent', coalesce(os.total_spent, 0),
      'active_credit_count', coalesce(cs.active_credit_count, 0),
      'settled_credit_count', coalesce(cs.settled_credit_count, 0),
      'pending_credit', coalesce(cs.active_credit_count, 0) > 0
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
      max(o.created_at) as last_order_at,
      coalesce(sum(o.price) filter (where o.payment_status = 'paid'), 0)::numeric(12,2) as total_spent
    from public.orders o
    where o.client_id = c.id
  ) os on true
  left join lateral (
    select
      count(*) filter (where ar.status in ('open', 'partial'))::bigint as active_credit_count,
      count(*) filter (where ar.status = 'paid')::bigint as settled_credit_count
    from public.accounts_receivable ar
    where ar.client_id = c.id
  ) cs on true
  left join lateral (
    select jsonb_agg(to_jsonb(recent_order) order by recent_order.created_at desc) as items
    from (
      select o.id, o.invoice_number, o.description, o.status, o.payment_status, o.created_at, o.updated_at, o.price
      from public.orders o
      where o.client_id = c.id
      order by o.created_at desc
      limit 10
    ) recent_order
  ) recent on true
  where c.id = p_client_id;

  if v_result is null then
    raise exception 'El cliente solicitado no existe.';
  end if;

  return v_result;
end;
$$;

revoke all on function public.caja_get_client_detail(uuid) from public;
revoke all on function public.caja_get_client_detail(uuid) from anon;
grant execute on function public.caja_get_client_detail(uuid) to authenticated;
