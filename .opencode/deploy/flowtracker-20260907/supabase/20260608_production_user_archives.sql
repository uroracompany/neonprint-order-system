-- Per-user production archive state.
-- This replaces the production UI dependency on orders.is_archived_production,
-- which is global and affects every assigned producer.

create table if not exists public.order_production_user_archives (
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  archived_at timestamptz not null default now(),
  constraint order_production_user_archives_pkey primary key (order_id, user_id)
);

create index if not exists idx_order_production_user_archives_user_id
  on public.order_production_user_archives(user_id);
create index if not exists idx_order_production_user_archives_order_id
  on public.order_production_user_archives(order_id);

insert into public.order_production_user_archives (order_id, user_id, archived_at)
select distinct
  o.id,
  opa.assigned_to,
  coalesce(o.updated_at, now())
from public.orders o
join public.order_production_assignments opa
  on opa.order_id = o.id
where coalesce(o.is_archived_production, false) = true
  and opa.assigned_to is not null
on conflict (order_id, user_id) do nothing;

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
    if v_order_status <> 'in_Completed' then
      raise exception 'Solo puedes archivar ordenes completadas.';
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

revoke all on function public.set_production_order_archive(uuid, boolean) from public, anon;
grant execute on function public.set_production_order_archive(uuid, boolean) to authenticated;

revoke all on table public.order_production_user_archives from public, anon;
grant select on table public.order_production_user_archives to authenticated;
revoke insert, update, delete on table public.order_production_user_archives from authenticated;

alter table public.order_production_user_archives enable row level security;

drop policy if exists order_production_user_archives_select_own on public.order_production_user_archives;
create policy order_production_user_archives_select_own
  on public.order_production_user_archives for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or user_id = (select auth.uid())
  );
