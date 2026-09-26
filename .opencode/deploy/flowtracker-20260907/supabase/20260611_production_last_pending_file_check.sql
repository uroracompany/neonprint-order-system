create or replace function public.will_complete_production_order(p_file_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  area_code text;
  file_row public.order_production_files;
  pending_other_count integer;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  select pa.code
  into area_code
  from public.production_areas pa
  where pa.producer_role = v_profile_role
    and pa.is_active = true
  limit 1;

  if area_code is null then
    raise exception 'Tu rol no pertenece a un area de produccion.';
  end if;

  select opf.*
  into file_row
  from public.order_production_files opf
  where opf.id = p_file_id
    and opf.production_area_code = area_code
    and public.current_user_assigned_to_production_area(opf.order_id, area_code);

  if not found then
    raise exception 'No tienes acceso a este archivo de produccion.';
  end if;

  select count(*)
  into pending_other_count
  from public.order_production_files opf
  where opf.order_id = file_row.order_id
    and opf.id <> file_row.id
    and opf.status <> 'completed';

  return coalesce(pending_other_count, 0) = 0;
end;
$$;

revoke all on function public.will_complete_production_order(uuid) from public, anon, authenticated;
grant execute on function public.will_complete_production_order(uuid) to authenticated;
