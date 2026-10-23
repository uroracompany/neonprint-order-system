-- Reusable catalog for the public labels shown in production file tracking.
-- Names remain editable per file; this table only stores explicit catalog entries.
create table if not exists public.production_file_tracking_names (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (
    lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
  ) stored unique,
  created_at timestamptz not null default now(),
  constraint production_file_tracking_names_name_not_blank
    check (normalized_name <> '')
);

alter table public.production_file_tracking_names enable row level security;

revoke all on table public.production_file_tracking_names from public, anon, authenticated;
grant select, insert on table public.production_file_tracking_names to authenticated;

drop policy if exists production_file_tracking_names_select_active on public.production_file_tracking_names;
create policy production_file_tracking_names_select_active
  on public.production_file_tracking_names for select
  to authenticated
  using (
    public.current_profile_role_secure() in ('admin', 'seller', 'semi_admin', 'designer', 'quote')
  );

drop policy if exists production_file_tracking_names_insert_active on public.production_file_tracking_names;
create policy production_file_tracking_names_insert_active
  on public.production_file_tracking_names for insert
  to authenticated
  with check (
    public.current_profile_role_secure() in ('admin', 'seller', 'semi_admin', 'designer', 'quote')
  );

-- Keep the oldest historical display value for each normalized name.
with historical_names as (
  select distinct on (normalized_name)
    normalized_name,
    canonical_name,
    source_created_at,
    source_id
  from (
    select
      lower(btrim(regexp_replace(public_label, '[[:space:]]+', ' ', 'g'))) as normalized_name,
      btrim(regexp_replace(public_label, '[[:space:]]+', ' ', 'g')) as canonical_name,
      created_at as source_created_at,
      id as source_id
    from public.order_production_files
    where public_label is not null
      and btrim(public_label) <> ''
  ) source
  order by normalized_name, source_created_at asc nulls last, source_id asc
)
insert into public.production_file_tracking_names (name, created_at)
select canonical_name, coalesce(source_created_at, now())
from historical_names
on conflict (normalized_name) do nothing;

create or replace function public.create_production_file_tracking_name(p_name text)
returns table (id uuid, name text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  v_normalized_name text := lower(v_name);
begin
  if v_name = '' then
    raise exception 'El nombre de seguimiento no puede estar vacío.';
  end if;

  insert into public.production_file_tracking_names (name)
  values (v_name)
  on conflict (normalized_name) do nothing;

  return query
  select catalog.id, catalog.name
  from public.production_file_tracking_names catalog
  where catalog.normalized_name = v_normalized_name;
end;
$$;

revoke all on function public.create_production_file_tracking_name(text) from public, anon;
grant execute on function public.create_production_file_tracking_name(text) to authenticated;

-- Keep the existing RPC contract and add the designer's public label update.
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
  v_public_label text;
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
    v_public_label := nullif(trim(v_spec->>'public_label'), '');
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
    set public_label = coalesce(v_public_label, public_label),
        production_area_code = v_area,
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

revoke all on function public.save_order_production_file_specifications(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.save_order_production_file_specifications(uuid, timestamptz, jsonb) to authenticated;

notify pgrst, 'reload schema';
