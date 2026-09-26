-- Versioned administrator client directory with lifecycle state.
-- Delegating the filtering/pagination work to the existing directory preserves
-- its metrics and ordering contract while exposing the state required to avoid
-- attempting a second logical retirement from the UI.

create or replace function public.admin_list_clients_v2(
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
  total_count bigint,
  deleted_at timestamptz
)
language plpgsql
security invoker
stable
set search_path = ''
as $$
begin
  if not public.current_profile_is_admin() then
    raise exception 'Solo administradores pueden consultar el directorio de clientes.';
  end if;

  return query
  select
    directory.id,
    directory.name,
    directory.phone,
    directory.email,
    directory.address,
    directory.notes,
    directory.created_at,
    directory.updated_at,
    directory.total_orders,
    directory.active_orders,
    directory.completed_orders,
    directory.cancelled_orders,
    directory.last_order_at,
    directory.active_credit_count,
    directory.credit_history_count,
    directory.settled_credit_count,
    directory.oldest_pending_credit_at,
    directory.is_frequent,
    directory.is_inactive,
    directory.total_count,
    client.deleted_at
  from public.admin_list_clients(
    p_page,
    p_page_size,
    p_search,
    p_credit_filter,
    p_activity_filter,
    p_frequency_filter,
    p_registered_from,
    p_registered_to,
    p_sort
  ) as directory
  join public.clients as client on client.id = directory.id;
end;
$$;

revoke all on function public.admin_list_clients_v2(integer, integer, text, text, text, text, date, date, text) from public;
revoke all on function public.admin_list_clients_v2(integer, integer, text, text, text, text, date, date, text) from anon;
grant execute on function public.admin_list_clients_v2(integer, integer, text, text, text, text, date, date, text) to authenticated;
