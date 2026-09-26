-- Materials and terminations are production-file metadata. Order-level columns
-- remain compatibility summaries for existing screens and analytics.

alter table public.materials
  add column if not exists production_area_code text references public.production_areas(code);

alter table public.materials
  drop constraint if exists materials_name_key;

create unique index if not exists materials_area_name_unique
  on public.materials (production_area_code, lower(name))
  where production_area_code is not null;

-- Historical catalog rows remain available for manual classification. New and
-- edited materials, however, must always belong to one production area.
drop policy if exists materials_insert_admin on public.materials;
create policy materials_insert_admin
  on public.materials for insert to authenticated
  with check (
    (select public.current_profile_is_admin())
    and production_area_code is not null
  );

drop policy if exists materials_update_admin on public.materials;
create policy materials_update_admin
  on public.materials for update to authenticated
  using ((select public.current_profile_is_admin()))
  with check (
    (select public.current_profile_is_admin())
    and production_area_code is not null
  );

create table if not exists public.production_terminations (
  id bigint generated always as identity primary key,
  production_area_code text not null references public.production_areas(code),
  name text not null check (char_length(trim(name)) >= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists production_terminations_area_name_unique
  on public.production_terminations (production_area_code, lower(name));

grant select on public.production_terminations to authenticated;
grant insert, update, delete on public.production_terminations to authenticated;
grant usage, select on sequence public.production_terminations_id_seq to authenticated;
alter table public.production_terminations enable row level security;

drop policy if exists production_terminations_select_authenticated on public.production_terminations;
create policy production_terminations_select_authenticated
  on public.production_terminations for select to authenticated using (true);

drop policy if exists production_terminations_admin_insert on public.production_terminations;
create policy production_terminations_admin_insert
  on public.production_terminations for insert to authenticated
  with check ((select public.current_profile_is_admin()));

drop policy if exists production_terminations_admin_update on public.production_terminations;
create policy production_terminations_admin_update
  on public.production_terminations for update to authenticated
  using ((select public.current_profile_is_admin()))
  with check ((select public.current_profile_is_admin()));

drop policy if exists production_terminations_admin_delete on public.production_terminations;
create policy production_terminations_admin_delete
  on public.production_terminations for delete to authenticated
  using ((select public.current_profile_is_admin()));

alter table public.order_production_files
  add column if not exists material_names text[] not null default '{}'::text[],
  add column if not exists termination_name text;

create or replace function public.normalize_production_material_names(p_values text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(value order by lower(value)), '{}'::text[])
  from (
    select distinct trim(value) as value
    from unnest(coalesce(p_values, '{}'::text[])) as item(value)
    where nullif(trim(value), '') is not null
  ) normalized;
$$;

create or replace function public.refresh_order_file_specification_summary(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_complete integer;
  v_material_summary text;
  v_termination_summary text;
begin
  select count(*), count(*) filter (
    where cardinality(material_names) > 0 and nullif(trim(termination_name), '') is not null
  )
  into v_total, v_complete
  from public.order_production_files
  where order_id = p_order_id;

  -- Legacy orders retain their order-level values until every file has been classified.
  if coalesce(v_total, 0) = 0 or v_total <> v_complete then
    return;
  end if;

  select string_agg(name, ', ' order by lower(name))
  into v_material_summary
  from (
    select distinct trim(name) as name
    from public.order_production_files file,
      unnest(file.material_names) as material(name)
    where file.order_id = p_order_id
      and nullif(trim(name), '') is not null
  ) materials;

  select string_agg(name, ', ' order by lower(name))
  into v_termination_summary
  from (
    select distinct trim(termination_name) as name
    from public.order_production_files
    where order_id = p_order_id
      and nullif(trim(termination_name), '') is not null
  ) terminations;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set material = coalesce(v_material_summary, ''),
      termination_type = nullif(v_termination_summary, ''),
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.refresh_order_file_specification_summary_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_order_file_specification_summary(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_order_file_specification_summary on public.order_production_files;
create trigger trg_refresh_order_file_specification_summary
  after insert or delete or update of material_names, termination_name on public.order_production_files
  for each row execute function public.refresh_order_file_specification_summary_trigger();

create or replace function public.save_order_production_file_specifications(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_specifications jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_spec jsonb;
  v_url text;
  v_area text;
  v_materials text[];
  v_termination text;
begin
  if v_actor is null or jsonb_typeof(coalesce(p_specifications, '[]'::jsonb)) <> 'array' then
    raise exception 'Especificaciones de archivo inválidas.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;

  if not (
    public.current_profile_is_admin()
    or v_actor in (v_order.created_by, v_order.seller_id, v_order.designer_id, v_order.quote_id)
  ) or v_order.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled') then
    raise exception 'No tienes permiso para actualizar las especificaciones de estos archivos.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  for v_spec in select value from jsonb_array_elements(p_specifications) loop
    v_url := nullif(trim(v_spec->>'url'), '');
    v_area := nullif(trim(v_spec->>'production_area_code'), '');
    v_termination := nullif(trim(v_spec->>'termination_name'), '');
    select public.normalize_production_material_names(array_agg(value))
    into v_materials
    from jsonb_array_elements_text(coalesce(v_spec->'material_names', '[]'::jsonb)) as item(value);

    if v_url is null or v_area is null or v_termination is null or cardinality(v_materials) = 0 then
      raise exception 'Cada archivo debe tener área, material y terminación.';
    end if;
    if not exists (select 1 from public.production_areas where code = v_area and is_active) then
      raise exception 'Selecciona un área de producción activa.';
    end if;

    update public.order_production_files
    set production_area_code = v_area,
        material_names = v_materials,
        termination_name = v_termination,
        updated_by = v_actor,
        updated_at = now()
    where order_id = p_order_id and url = v_url;
    if not found then
      raise exception 'El archivo no pertenece a esta orden.';
    end if;
  end loop;

  perform public.refresh_order_file_specification_summary(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

revoke all on function public.normalize_production_material_names(text[]) from public, anon;
revoke all on function public.refresh_order_file_specification_summary(uuid) from public, anon;
revoke all on function public.refresh_order_file_specification_summary_trigger() from public, anon;
revoke all on function public.save_order_production_file_specifications(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.save_order_production_file_specifications(uuid, timestamptz, jsonb) to authenticated;

create index if not exists order_production_files_specs_by_order_idx
  on public.order_production_files (order_id)
  where cardinality(material_names) > 0;
