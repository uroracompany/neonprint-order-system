-- Preserve operational and historical order data when a client or employee leaves.
-- Identities are retired logically; their foreign-key relationships remain valid.

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text;

alter table public.clients
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists idx_profiles_active_assignments
  on public.profiles (role, name)
  where employment_status is distinct from false and deleted_at is null;

create index if not exists idx_clients_active_directory
  on public.clients (name)
  where deleted_at is null;

-- Every RLS policy and RPC based on the legacy role helpers must treat a
-- retired identity as unauthenticated for authorization purposes.
create or replace function public.current_profile_role()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and employment_status is distinct from false
    and deleted_at is null
$$;

create or replace function public.current_profile_role_secure()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
    and employment_status is distinct from false
    and deleted_at is null
$$;

create or replace function public.current_profile_is_admin_secure()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role_secure() = 'admin', false)
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.get_role_user_ids(p_role text)
returns uuid[]
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(array_agg(id), array[]::uuid[])
  from public.profiles
  where role = p_role
    and employment_status is distinct from false
    and deleted_at is null
$$;

create table if not exists public.user_lifecycle_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('retired', 'restored')),
  actor_id uuid references public.profiles(id) on delete set null,
  target_profile_id uuid references public.profiles(id) on delete set null,
  target_client_id uuid references public.clients(id) on delete set null,
  identity_snapshot jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(target_profile_id, target_client_id) = 1)
);

create table if not exists public.order_participant_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  participant_role text not null,
  event_type text not null check (event_type in ('assigned', 'reassigned', 'unassigned')),
  previous_profile_id uuid references public.profiles(id) on delete set null,
  previous_snapshot jsonb not null default '{}'::jsonb,
  next_profile_id uuid references public.profiles(id) on delete set null,
  next_snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_participant_history_order_created
  on public.order_participant_history (order_id, created_at desc);

alter table public.user_lifecycle_audit enable row level security;
alter table public.order_participant_history enable row level security;

create policy user_lifecycle_audit_admin_read
  on public.user_lifecycle_audit for select to authenticated
  using (public.current_profile_is_admin());

create policy order_participant_history_admin_read
  on public.order_participant_history for select to authenticated
  using (public.current_profile_is_admin());

create or replace function public.order_participant_snapshot(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(btrim(p.name), ''), nullif(btrim(p.email), ''), 'Usuario eliminado'),
        'role', p.role,
        'retired', p.deleted_at is not null or p.employment_status is false
      )
      from public.profiles p
      where p.id = p_profile_id
    ),
    case when p_profile_id is null then '{}'::jsonb
         else jsonb_build_object('id', p_profile_id, 'name', 'Usuario eliminado', 'retired', true)
    end
  );
$$;

create or replace function public.capture_order_participant_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  change_row record;
begin
  if tg_op = 'INSERT' then
    for change_row in
      select * from (values
        ('seller', null::uuid, new.seller_id),
        ('designer', null::uuid, new.designer_id),
        ('quote', null::uuid, new.quote_id),
        ('production', null::uuid, new.production_id),
        ('delivery', null::uuid, new.delivery_id)
      ) as changes(participant_role, previous_profile_id, next_profile_id)
      where next_profile_id is not null
    loop
      insert into public.order_participant_history (
        order_id, participant_role, event_type, previous_profile_id, previous_snapshot,
        next_profile_id, next_snapshot, actor_id
      ) values (
        new.id, change_row.participant_role, 'assigned', null, '{}'::jsonb,
        change_row.next_profile_id, public.order_participant_snapshot(change_row.next_profile_id), auth.uid()
      );
    end loop;
    return new;
  end if;

  for change_row in
    select * from (values
      ('seller', old.seller_id, new.seller_id),
      ('designer', old.designer_id, new.designer_id),
      ('quote', old.quote_id, new.quote_id),
      ('production', old.production_id, new.production_id),
      ('delivery', old.delivery_id, new.delivery_id)
    ) as changes(participant_role, previous_profile_id, next_profile_id)
    where previous_profile_id is distinct from next_profile_id
  loop
    insert into public.order_participant_history (
      order_id, participant_role, event_type, previous_profile_id, previous_snapshot,
      next_profile_id, next_snapshot, actor_id
    ) values (
      new.id,
      change_row.participant_role,
      case when change_row.next_profile_id is null then 'unassigned' else 'reassigned' end,
      change_row.previous_profile_id, public.order_participant_snapshot(change_row.previous_profile_id),
      change_row.next_profile_id, public.order_participant_snapshot(change_row.next_profile_id), auth.uid()
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_capture_order_participant_history on public.orders;
create trigger trg_capture_order_participant_history
  after insert or update of seller_id, designer_id, quote_id, production_id, delivery_id on public.orders
  for each row execute function public.capture_order_participant_history();

create or replace function public.assert_active_order_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  change_row record;
begin
  if tg_op = 'INSERT' then
    for change_row in
      select * from (values
        ('seller', new.seller_id), ('designer', new.designer_id), ('quote', new.quote_id),
        ('production', new.production_id), ('delivery', new.delivery_id)
      ) as changes(participant_role, profile_id)
      where profile_id is not null
    loop
      if not exists (
        select 1 from public.profiles p
        where p.id = change_row.profile_id
          and p.employment_status is distinct from false
          and p.deleted_at is null
      ) then
        raise exception 'No se puede asignar % a un usuario inactivo o dado de baja.', change_row.participant_role;
      end if;
    end loop;
    return new;
  end if;

  for change_row in
    select * from (values
      ('seller', old.seller_id, new.seller_id), ('designer', old.designer_id, new.designer_id),
      ('quote', old.quote_id, new.quote_id), ('production', old.production_id, new.production_id),
      ('delivery', old.delivery_id, new.delivery_id)
    ) as changes(participant_role, previous_profile_id, next_profile_id)
    where previous_profile_id is distinct from next_profile_id and next_profile_id is not null
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = change_row.next_profile_id
        and p.employment_status is distinct from false
        and p.deleted_at is null
    ) then
      raise exception 'No se puede asignar % a un usuario inactivo o dado de baja.', change_row.participant_role;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_assert_active_order_participant on public.orders;
create trigger trg_assert_active_order_participant
  before insert or update of seller_id, designer_id, quote_id, production_id, delivery_id on public.orders
  for each row execute function public.assert_active_order_participant();

create or replace function public.assert_active_production_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.assigned_to
      and p.employment_status is distinct from false
      and p.deleted_at is null
  ) then
    raise exception 'No se puede asignar trabajo de produccion a un usuario inactivo o dado de baja.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assert_active_production_file_assignee on public.order_production_files;
create trigger trg_assert_active_production_file_assignee
  before insert or update of assigned_to on public.order_production_files
  for each row execute function public.assert_active_production_assignee();

drop trigger if exists trg_assert_active_production_assignment_assignee on public.order_production_assignments;
create trigger trg_assert_active_production_assignment_assignee
  before insert or update of assigned_to on public.order_production_assignments
  for each row execute function public.assert_active_production_assignee();

create or replace function public.prevent_historical_identity_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'No se permite eliminar fisicamente este registro. Use la baja logica para conservar el historial de ordenes.';
end;
$$;

drop trigger if exists trg_prevent_profile_hard_delete on public.profiles;
create trigger trg_prevent_profile_hard_delete
  before delete on public.profiles
  for each row execute function public.prevent_historical_identity_delete();

drop trigger if exists trg_prevent_client_hard_delete on public.clients;
create trigger trg_prevent_client_hard_delete
  before delete on public.clients
  for each row execute function public.prevent_historical_identity_delete();
