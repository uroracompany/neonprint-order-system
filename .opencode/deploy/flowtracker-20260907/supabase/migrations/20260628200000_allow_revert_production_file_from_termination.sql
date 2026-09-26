create or replace function public.update_production_file_status(p_file_id uuid, p_next_status text)
returns public.order_production_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  area_code text;
  file_row public.order_production_files;
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

  if p_next_status not in ('in_production', 'in_termination', 'completed') then
    raise exception 'Transicion de estado no permitida.';
  end if;

  select opf.*
  into file_row
  from public.order_production_files opf
  where opf.id = p_file_id
    and opf.production_area_code = area_code
    and public.current_user_assigned_to_production_area(opf.order_id, area_code)
  for update;

  if not found then
    raise exception 'No tienes acceso a este archivo de produccion.';
  end if;

  if file_row.status = 'completed' then
    raise exception 'No se puede cambiar el estado de un archivo completado.';
  end if;

  if p_next_status = 'in_production' and file_row.status <> 'in_termination' then
    raise exception 'Solo archivos en terminacion pueden volver a produccion.';
  end if;

  if p_next_status = 'completed' and file_row.status <> 'in_termination' then
    raise exception 'El archivo debe estar en terminacion antes de completarse.';
  end if;

  update public.order_production_files
  set status = p_next_status,
      updated_by = v_uid
  where id = p_file_id
  returning * into file_row;

  perform public.recalculate_order_production_status(file_row.order_id);
  return file_row;
end;
$$;

revoke all on function public.update_production_file_status(uuid, text) from public, anon;

grant execute on function public.update_production_file_status(uuid, text) to authenticated;
