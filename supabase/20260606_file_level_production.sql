-- File-level production routing for Digital, DTF and Ploteo.

create table if not exists public.production_areas (
  code text primary key,
  label text not null,
  producer_role text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.production_areas (code, label, producer_role)
values
  ('digital', 'Digital', 'digital_producer'),
  ('dtf', 'DTF', 'dtf_producer'),
  ('ploteo', 'Ploteo', 'ploteo_producer')
on conflict (code) do update
set label = excluded.label,
    producer_role = excluded.producer_role,
    is_active = true;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint if exists %I', constraint_record.conname);
  end loop;

  alter table public.profiles
    add constraint profiles_role_check
    check (
      role in (
        'admin',
        'seller',
        'designer',
        'quote',
        'printer',
        'digital_producer',
        'dtf_producer',
        'ploteo_producer',
        'delivery'
      )
    ) not valid;
end;
$$;

create table if not exists public.order_production_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  url text not null,
  filename text,
  production_area_code text references public.production_areas(code),
  status text not null default 'pending',
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  started_at timestamptz,
  in_termination_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_production_files_status_check
    check (status in ('pending', 'in_production', 'in_termination', 'completed')),
  constraint order_production_files_unique_order_url unique (order_id, url)
);

create index if not exists idx_order_production_files_order_id
  on public.order_production_files(order_id);
create index if not exists idx_order_production_files_area_status
  on public.order_production_files(production_area_code, status);

create or replace function public.production_area_for_role(p_role text)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select code
  from public.production_areas
  where producer_role = p_role
    and is_active = true
  limit 1
$$;

create or replace function public.current_production_area()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select public.production_area_for_role(public.current_profile_role())
$$;

create or replace function public.current_profile_is_producer()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_production_area() is not null
$$;

create or replace function public.producer_can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_production_files opf
    where opf.order_id = p_order_id
      and opf.production_area_code = public.current_production_area()
  )
$$;

create or replace function public._production_file_urls_from_legacy(p_value text)
returns table(url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parsed jsonb;
begin
  if nullif(trim(coalesce(p_value, '')), '') is null then
    return;
  end if;

  begin
    parsed := p_value::jsonb;

    if jsonb_typeof(parsed) = 'array' then
      return query
      select nullif(trim(value), '')
      from jsonb_array_elements_text(parsed) as value
      where nullif(trim(value), '') is not null;
      return;
    elsif jsonb_typeof(parsed) = 'string' then
      return query select nullif(trim(parsed #>> '{}'), '');
      return;
    end if;
  exception when others then
    -- Legacy values may be comma/newline-delimited plain text.
  end;

  return query
  select nullif(trim(value), '')
  from regexp_split_to_table(p_value, E'[\\n,]+') as value
  where nullif(trim(value), '') is not null;
end;
$$;

insert into public.order_production_files (order_id, url, filename, status, created_at, updated_at)
select
  o.id,
  files.url,
  nullif(regexp_replace(split_part(files.url, '?', 1), '^.*/', ''), ''),
  'pending',
  now(),
  now()
from public.orders o
cross join lateral public._production_file_urls_from_legacy(o.order_file_url::text) as files(url)
on conflict (order_id, url) do nothing;

create or replace function public.sync_order_production_files_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_production_files (order_id, url, filename, status, created_at, updated_at)
  select
    new.id,
    files.url,
    nullif(regexp_replace(split_part(files.url, '?', 1), '^.*/', ''), ''),
    'pending',
    now(),
    now()
  from public._production_file_urls_from_legacy(new.order_file_url::text) as files(url)
  on conflict (order_id, url) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_order_production_files_from_legacy on public.orders;
create trigger trg_sync_order_production_files_from_legacy
  after insert or update of order_file_url on public.orders
  for each row
  execute function public.sync_order_production_files_from_legacy();

create or replace function public.touch_order_production_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.status = 'in_production' and old.status is distinct from new.status then
    new.started_at := coalesce(new.started_at, now());
  elsif new.status = 'in_termination' and old.status is distinct from new.status then
    new.in_termination_at := coalesce(new.in_termination_at, now());
  elsif new.status = 'completed' and old.status is distinct from new.status then
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_order_production_file on public.order_production_files;
create trigger trg_touch_order_production_file
  before update on public.order_production_files
  for each row
  execute function public.touch_order_production_file();

create or replace function public.recalculate_order_production_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  total_count integer;
  completed_count integer;
  ready_count integer;
  next_status text;
begin
  select
    count(*) filter (where production_area_code is not null),
    count(*) filter (where production_area_code is not null and status = 'completed'),
    count(*) filter (where production_area_code is not null and status in ('in_termination', 'completed'))
  into total_count, completed_count, ready_count
  from public.order_production_files
  where order_id = p_order_id;

  if total_count = 0 then
    select status into next_status from public.orders where id = p_order_id;
    return next_status;
  end if;

  if completed_count = total_count then
    next_status := 'in_Completed';
  elsif ready_count = total_count then
    next_status := 'in_Termination';
  else
    next_status := 'in_Production';
  end if;

  update public.orders
  set status = next_status,
      updated_at = now(),
      delivery_id = case when next_status = 'in_Completed' then null else delivery_id end
  where id = p_order_id
    and status not in ('cancelled', 'in_Delivered');

  return next_status;
end;
$$;

create or replace function public.send_order_to_production(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text := coalesce(public.current_profile_role(), '');
  classified_count integer;
  unclassified_count integer;
  updated_order public.orders;
begin
  if current_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        public.current_profile_is_admin()
        or o.quote_id = auth.uid()
      )
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

create or replace function public.update_production_file_status(p_file_id uuid, p_next_status text)
returns public.order_production_files
language plpgsql
security definer
set search_path = public
as $$
declare
  area_code text := public.current_production_area();
  file_row public.order_production_files;
begin
  if area_code is null then
    raise exception 'Tu rol no pertenece a un area de produccion.';
  end if;

  if p_next_status not in ('in_termination', 'completed') then
    raise exception 'Transicion de estado no permitida.';
  end if;

  select *
  into file_row
  from public.order_production_files
  where id = p_file_id
    and production_area_code = area_code
  for update;

  if not found then
    raise exception 'No tienes acceso a este archivo de produccion.';
  end if;

  if p_next_status = 'completed' and file_row.status <> 'in_termination' then
    raise exception 'El archivo debe estar en terminacion antes de completarse.';
  end if;

  update public.order_production_files
  set status = p_next_status,
      updated_by = auth.uid()
  where id = p_file_id
  returning * into file_row;

  perform public.recalculate_order_production_status(file_row.order_id);
  return file_row;
end;
$$;

revoke all on function public.production_area_for_role(text) from public, anon;
revoke all on function public.current_production_area() from public, anon;
revoke all on function public.current_profile_is_producer() from public, anon;
revoke all on function public.producer_can_access_order(uuid) from public, anon;
revoke all on function public._production_file_urls_from_legacy(text) from public, anon, authenticated;
revoke all on function public.sync_order_production_files_from_legacy() from public, anon, authenticated;
revoke all on function public.touch_order_production_file() from public, anon, authenticated;
revoke all on function public.recalculate_order_production_status(uuid) from public, anon;
revoke all on function public.send_order_to_production(uuid) from public, anon;
revoke all on function public.update_production_file_status(uuid, text) from public, anon;

grant execute on function public.production_area_for_role(text) to authenticated;
grant execute on function public.current_production_area() to authenticated;
grant execute on function public.current_profile_is_producer() to authenticated;
grant execute on function public.producer_can_access_order(uuid) to authenticated;
grant execute on function public.recalculate_order_production_status(uuid) to authenticated;
grant execute on function public.send_order_to_production(uuid) to authenticated;
grant execute on function public.update_production_file_status(uuid, text) to authenticated;

create or replace function public.can_manage_order_asset_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.orders o
    where o.id::text = (storage.foldername(object_name))[2]
      and (
        public.current_profile_is_admin()
        or auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
        or public.producer_can_access_order(o.id)
      )
  );
$$;

revoke all on function public.can_manage_order_asset_path(text) from public;
grant execute on function public.can_manage_order_asset_path(text) to authenticated;

grant select on public.production_areas to authenticated;
grant select, insert, update, delete on public.order_production_files to authenticated;

alter table public.production_areas enable row level security;
alter table public.order_production_files enable row level security;

drop policy if exists production_areas_select_authenticated on public.production_areas;
create policy production_areas_select_authenticated
  on public.production_areas for select
  to authenticated
  using (true);

drop policy if exists order_production_files_select_by_role on public.order_production_files;
drop policy if exists order_production_files_insert_by_owner on public.order_production_files;
drop policy if exists order_production_files_update_by_owner on public.order_production_files;
drop policy if exists order_production_files_delete_by_owner on public.order_production_files;

create policy order_production_files_select_by_role
  on public.order_production_files for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or production_area_code = public.current_production_area()
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_files.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
          or (public.current_profile_role() = 'delivery' and o.status in ('in_Completed', 'in_Delivered'))
        )
    )
  );

create policy order_production_files_insert_by_owner
  on public.order_production_files for insert
  to authenticated
  with check (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  );

create policy order_production_files_update_by_owner
  on public.order_production_files for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_files.order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  )
  with check (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_files.order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  );

create policy order_production_files_delete_by_owner
  on public.order_production_files for delete
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_files.order_id
        and auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
        and o.status not in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled')
    )
  );

drop policy if exists orders_select_by_role on public.orders;
drop policy if exists orders_update_by_role on public.orders;

create policy orders_select_by_role
  on public.orders for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or public.producer_can_access_order(id)
    or (public.current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered'))
  );

create policy orders_update_by_role
  on public.orders for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (public.current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered'))
  )
  with check (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (public.current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered'))
  );

drop policy if exists order_events_select_by_order_access on public.order_events;
create policy order_events_select_by_order_access
  on public.order_events for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
          or public.producer_can_access_order(o.id)
          or (public.current_profile_role() = 'delivery' and o.status in ('in_Completed', 'in_Delivered'))
        )
    )
  );
