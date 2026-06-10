-- Fix set_production_order_archive to allow archiving in_Completed AND in_Delivered
-- Previously only in_Completed was allowed. After orders move to in_Delivered,
-- production users could no longer archive them.

create or replace function public.set_production_order_archive(
  p_order_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  v_order_status text;
  v_should_archive boolean := coalesce(p_archived, false);
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_profile_role is null then
    raise exception 'Tu perfil no esta activo.';
  end if;

  if not exists (
    select 1
    from public.production_areas pa
    where pa.producer_role = v_profile_role
      and pa.is_active = true
  ) then
    raise exception 'Tu rol no pertenece a un area de produccion.';
  end if;

  select o.status
  into v_order_status
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if not public.producer_can_access_order(p_order_id) then
    raise exception 'No tienes acceso a esta orden de produccion.';
  end if;

  if v_should_archive then
    if v_order_status not in ('in_Completed', 'in_Delivered') then
      raise exception 'Solo puedes archivar ordenes completadas o entregadas.';
    end if;

    insert into public.order_production_user_archives (order_id, user_id, archived_at)
    values (p_order_id, v_uid, now())
    on conflict (order_id, user_id) do update
    set archived_at = excluded.archived_at;

    return true;
  end if;

  delete from public.order_production_user_archives
  where order_id = p_order_id
    and user_id = v_uid;

  return false;
end;
$$;
