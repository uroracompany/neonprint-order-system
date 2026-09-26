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
    raise exception 'Solo administradores pueden consultar las órdenes de un cliente.';
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
        or lower(coalesce(o.status, '')) ilike '%' || v_search || '%'
        or lower(coalesce(o.payment_status, '')) ilike '%' || v_search || '%'
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
