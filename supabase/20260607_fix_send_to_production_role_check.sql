-- Fix: send_order_to_production role check failing when called
-- from SECURITY DEFINER context because current_profile_role()
-- was overridden to SECURITY INVOKER and auth.uid() does not
-- resolve reliably across the definer-to-invoker boundary.
--
-- Fix: Changed function to SECURITY INVOKER so auth.uid() and
-- RLS policies work correctly without crossing security contexts.
-- The function inlines the role query to be self-contained.
--
-- All operations (SELECT profiles, SELECT/UPDATE orders,
-- UPDATE order_production_files) are permitted by existing RLS
-- policies for authenticated users with role 'quote' or 'admin'.

create or replace function public.send_order_to_production(p_order_id uuid)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_role text;
  classified_count integer;
  unclassified_count integer;
  updated_order public.orders;
begin
  select p.role into v_profile_role
  from public.profiles p
  where p.id = auth.uid();

  if v_profile_role is null or v_profile_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (v_profile_role = 'admin' or o.quote_id = auth.uid())
  ) then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  select
    count(*) filter (where production_area_code is not null),
    count(*) filter (where production_area_code is null)
  into classified_count, unclassified_count
  from public.order_production_files
  where order_id = p_order_id;

  if coalesce(classified_count, 0) = 0 then
    raise exception 'La orden no tiene archivos clasificados para produccion.';
  end if;

  if coalesce(unclassified_count, 0) > 0 then
    raise exception 'Todos los archivos deben tener tipo de produccion antes de enviar.';
  end if;

  update public.order_production_files
  set status = 'in_production',
      started_at = coalesce(started_at, now()),
      updated_by = auth.uid()
  where order_id = p_order_id
    and status = 'pending';

  update public.orders
  set status = 'in_Production',
      production_id = null,
      updated_at = now()
  where id = p_order_id
  returning * into updated_order;

  return updated_order;
end;
$$;

revoke all on function public.send_order_to_production(uuid) from public, anon;
grant execute on function public.send_order_to_production(uuid) to authenticated;

-- Funcion de diagnostico para verificar auth.uid() desde diferentes contextos
create or replace function public.debug_auth_uid()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_result jsonb;
begin
  v_uid := auth.uid();
  select p.role into v_role from public.profiles p where p.id = v_uid;

  v_result := jsonb_build_object(
    'auth_uid', v_uid,
    'role', v_role,
    'uid_is_null', v_uid is null,
    'current_user', current_user,
    'session_user', session_user
  );

  return v_result;
end;
$$;

revoke all on function public.debug_auth_uid() from public, anon;
grant execute on function public.debug_auth_uid() to authenticated;
