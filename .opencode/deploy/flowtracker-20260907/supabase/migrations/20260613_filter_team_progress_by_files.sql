-- Filter out production team members without assigned files from team progress.
-- Previously, get_production_order_team used a LEFT JOIN on file_summary,
-- which returned assignments even when the production area had zero files.
-- Changed to INNER JOIN so only areas with at least one file are shown.

create or replace function public.get_production_order_team(p_order_id uuid)
returns table (
  production_area_code text,
  production_area_label text,
  assigned_to uuid,
  assigned_name text,
  assigned_role text,
  total_files integer,
  pending_count integer,
  in_production_count integer,
  in_termination_count integer,
  completed_count integer,
  summary_status text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if not (
    public.current_profile_is_admin()
    or v_uid = any(array[v_order.created_by, v_order.seller_id, v_order.designer_id, v_order.quote_id, v_order.delivery_id])
    or public.producer_can_access_order(p_order_id)
  ) then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  return query
  with file_summary as (
    select
      opf.production_area_code,
      count(*)::integer as total_files,
      count(*) filter (where coalesce(opf.status, 'pending') = 'pending')::integer as pending_count,
      count(*) filter (where coalesce(opf.status, 'pending') = 'in_production')::integer as in_production_count,
      count(*) filter (where coalesce(opf.status, 'pending') = 'in_termination')::integer as in_termination_count,
      count(*) filter (where coalesce(opf.status, 'pending') = 'completed')::integer as completed_count
    from public.order_production_files opf
    where opf.order_id = p_order_id
    group by opf.production_area_code
  )
  select
    opa.production_area_code::text,
    pa.label::text,
    opa.assigned_to,
    coalesce(nullif(p.name, ''), 'Usuario de produccion')::text,
    p.role::text,
    coalesce(fs.total_files, 0)::integer,
    coalesce(fs.pending_count, 0)::integer,
    coalesce(fs.in_production_count, 0)::integer,
    coalesce(fs.in_termination_count, 0)::integer,
    coalesce(fs.completed_count, 0)::integer,
    case
      when coalesce(fs.total_files, 0) = 0 then 'pending'
      when coalesce(fs.completed_count, 0) = coalesce(fs.total_files, 0) then 'completed'
      when coalesce(fs.in_termination_count, 0) > 0 then 'in_termination'
      when coalesce(fs.in_production_count, 0) > 0 then 'in_production'
      else 'pending'
    end::text,
    greatest(opa.updated_at, coalesce(max_files.max_updated_at, opa.updated_at))
  from public.order_production_assignments opa
  join public.production_areas pa
    on pa.code = opa.production_area_code
  join public.profiles p
    on p.id = opa.assigned_to
  join file_summary fs
    on fs.production_area_code = opa.production_area_code
  left join lateral (
    select max(opf.updated_at) as max_updated_at
    from public.order_production_files opf
    where opf.order_id = opa.order_id
      and opf.production_area_code = opa.production_area_code
  ) max_files on true
  where opa.order_id = p_order_id
  order by pa.code;
end;
$$;

revoke all on function public.get_production_order_team(uuid) from public;
revoke all on function public.get_production_order_team(uuid) from anon;
grant execute on function public.get_production_order_team(uuid) to authenticated;
