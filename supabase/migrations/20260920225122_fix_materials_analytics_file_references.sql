-- KPI Materiales: los archivos de producción son la fuente canónica de la
-- clasificación. orders.material queda únicamente como respaldo histórico.

create or replace function public.kpi_materials_analytics(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_compare_from timestamptz,
  p_compare_to timestamptz
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_period jsonb;
  v_comparison jsonb;
  v_coverage jsonb;
begin
  if not public.current_profile_is_admin() then
    raise exception 'Solo administradores pueden consultar KPIs.';
  end if;

  with catalog as (
    select m.id, m.name, m.production_area_code,
      lower(regexp_replace(btrim(m.name), '[[:space:]]+', ' ', 'g')) as material_key
    from public.materials m
    where nullif(btrim(m.name), '') is not null
  ), open_orders as (
    select o.id, o.material
    from public.orders o
    where lower(coalesce(o.status, '')) in ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination')
      and coalesce(o.is_archived, false) = false
  ), open_legacy_catalog as (
    select material_key, min(id) as material_id
    from catalog
    group by material_key
    having count(*) = 1
  ), open_file_candidates as (
    select o.id as order_id, c.id as material_id,
      coalesce(c.id::text, 'unknown:' || coalesce(f.production_area_code, '') || ':' || lower(regexp_replace(btrim(item.name), '[[:space:]]+', ' ', 'g'))) as material_identity
    from open_orders o
    join public.order_production_files f on f.order_id = o.id and cardinality(f.material_names) > 0
    cross join lateral unnest(f.material_names) as item(name)
    left join catalog c on c.production_area_code = f.production_area_code
      and c.material_key = lower(regexp_replace(btrim(item.name), '[[:space:]]+', ' ', 'g'))
    where nullif(btrim(item.name), '') is not null
  ), open_file_refs as (
    select distinct order_id, material_identity, material_id
    from open_file_candidates
  ), open_legacy_refs as (
    select distinct o.id as order_id,
      coalesce(c.material_id::text, 'unknown:legacy:' || lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g'))) as material_identity,
      c.material_id
    from open_orders o
    cross join lateral regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') as part(name)
    left join open_legacy_catalog c on c.material_key = lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g'))
    where nullif(btrim(part.name), '') is not null
      and not exists (
        select 1 from public.order_production_files f
        where f.order_id = o.id and cardinality(f.material_names) > 0
      )
  ), open_refs as (
    select * from open_file_refs
    union all
    select * from open_legacy_refs
  )
  select jsonb_build_object(
    'catalog_materials', (select count(*) from catalog),
    'open_orders', (select count(*) from open_orders),
    'open_orders_with_material', (select count(distinct order_id) from open_refs),
    'open_orders_without_material', greatest((select count(*) from open_orders) - (select count(distinct order_id) from open_refs), 0),
    'materials_in_open_orders', (select count(distinct material_id) from open_refs where material_id is not null),
    'unrecognized_open_references', (select count(*) from open_refs where material_id is null)
  ) into v_snapshot;

  with scope_windows(scope, date_from, date_to) as (
    values ('period'::text, p_date_from, p_date_to), ('comparison'::text, p_compare_from, p_compare_to)
  ), scoped_orders as (
    select w.scope, w.date_from, w.date_to, o.id as order_id, o.client_id, o.client_name,
      o.material, o.status, o.order_type, o.order_design_type, coalesce(o.seller_id, o.created_by) as seller_id, o.created_at
    from scope_windows w
    join public.orders o on o.created_at >= w.date_from and o.created_at < w.date_to
    where coalesce(o.is_archived, false) = false
  ), catalog as (
    select m.id, m.name, m.production_area_code,
      lower(regexp_replace(btrim(m.name), '[[:space:]]+', ' ', 'g')) as material_key
    from public.materials m
    where nullif(btrim(m.name), '') is not null
  ), legacy_catalog as (
    select material_key, min(id) as material_id, min(name) as catalog_name
    from catalog
    group by material_key
    having count(*) = 1
  ), file_candidates as (
    select so.*, f.production_area_code, btrim(item.name) as display_name,
      lower(regexp_replace(btrim(item.name), '[[:space:]]+', ' ', 'g')) as material_key,
      c.id as material_id, c.name as catalog_name
    from scoped_orders so
    join public.order_production_files f on f.order_id = so.order_id and cardinality(f.material_names) > 0
    cross join lateral unnest(f.material_names) as item(name)
    left join catalog c on c.production_area_code = f.production_area_code
      and c.material_key = lower(regexp_replace(btrim(item.name), '[[:space:]]+', ' ', 'g'))
    where nullif(btrim(item.name), '') is not null
  ), file_refs as (
    select distinct on (scope, order_id, material_identity)
      scope, date_from, date_to, order_id, client_id, client_name, status, order_type, order_design_type, seller_id, created_at,
      display_name, material_key, material_id, catalog_name,
      coalesce(material_id::text, 'unknown:' || coalesce(production_area_code, '') || ':' || material_key) as material_identity
    from file_candidates
    order by scope, order_id, material_identity, created_at
  ), legacy_candidates as (
    select so.*, btrim(part.name) as display_name,
      lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g')) as material_key,
      lc.material_id, lc.catalog_name
    from scoped_orders so
    cross join lateral regexp_split_to_table(coalesce(so.material, ''), '[,;/|]+') as part(name)
    left join legacy_catalog lc on lc.material_key = lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g'))
    where nullif(btrim(part.name), '') is not null
      and not exists (
        select 1 from public.order_production_files f
        where f.order_id = so.order_id and cardinality(f.material_names) > 0
      )
  ), legacy_refs as (
    select distinct on (scope, order_id, material_identity)
      scope, date_from, date_to, order_id, client_id, client_name, status, order_type, order_design_type, seller_id, created_at,
      display_name, material_key, material_id, catalog_name,
      coalesce(material_id::text, 'unknown:legacy:' || material_key) as material_identity
    from legacy_candidates
    order by scope, order_id, material_identity, created_at
  ), refs as (
    select * from file_refs union all select * from legacy_refs
  ), summary_rows as (
    select r.scope, r.material_identity, r.material_id,
      coalesce(max(r.catalog_name), min(r.display_name)) as name,
      count(distinct r.order_id) as total_orders,
      count(distinct r.order_id) as reference_count,
      count(distinct r.order_id) filter (where r.status = 'cancelled') as cancelled_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) like '%911%') as urgent_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) not like '%911%') as normal_orders,
      count(distinct r.order_id) filter (where r.order_design_type = 'INTERNAL_DESING') as internal_design_orders,
      count(distinct r.order_id) filter (where r.order_design_type = 'EXTERNAL_DESING') as external_design_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) not like '%911%' and r.order_design_type = 'INTERNAL_DESING') as normal_internal_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) not like '%911%' and r.order_design_type = 'EXTERNAL_DESING') as normal_external_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) like '%911%' and r.order_design_type = 'INTERNAL_DESING') as urgent_internal_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) like '%911%' and r.order_design_type = 'EXTERNAL_DESING') as urgent_external_orders
    from refs r
    group by r.scope, r.material_identity, r.material_id
  ), summary_totals as (
    select s.*, sum(s.reference_count) over (partition by s.scope) as scope_reference_count
    from summary_rows s
  ), summary_json as (
    select s.scope, coalesce(jsonb_agg(jsonb_build_object(
      'material_id', s.material_id,
      'name', s.name,
      'total_orders', s.total_orders,
      'reference_count', s.reference_count,
      'cancelled_orders', s.cancelled_orders,
      'normal_orders', s.normal_orders,
      'urgent_orders', s.urgent_orders,
      'internal_design_orders', s.internal_design_orders,
      'external_design_orders', s.external_design_orders,
      'normal_internal_orders', s.normal_internal_orders,
      'normal_external_orders', s.normal_external_orders,
      'urgent_internal_orders', s.urgent_internal_orders,
      'urgent_external_orders', s.urgent_external_orders,
      'usage_pct', round(s.reference_count::numeric / nullif(s.scope_reference_count, 0) * 100, 1),
      'top_clients', coalesce((
        select jsonb_agg(jsonb_build_object('client_id', clients.client_id, 'client_name', clients.client_name, 'count', clients.count) order by clients.count desc, clients.client_name)
        from (
          select min(r2.client_id::text)::uuid as client_id, coalesce(nullif(min(r2.client_name), ''), 'Sin cliente') as client_name,
            count(distinct r2.order_id) as count
          from refs r2
          where r2.scope = s.scope and r2.material_identity = s.material_identity
          group by coalesce(r2.client_id::text, 'name:' || coalesce(lower(regexp_replace(btrim(r2.client_name), '[[:space:]]+', ' ', 'g')), 'sin-cliente'))
          order by count desc, client_name
          limit 5
        ) clients
      ), '[]'::jsonb),
      'top_sellers', coalesce((
        select jsonb_agg(jsonb_build_object('seller_id', sellers.seller_id, 'seller_name', sellers.seller_name, 'count', sellers.count) order by sellers.count desc, sellers.seller_name)
        from (
          select r2.seller_id, coalesce(p.name, 'Sin vendedor') as seller_name, count(distinct r2.order_id) as count
          from refs r2
          left join public.profiles p on p.id = r2.seller_id and p.role = 'seller'
          where r2.scope = s.scope and r2.material_identity = s.material_identity
          group by r2.seller_id, coalesce(p.name, 'Sin vendedor')
          order by count desc, seller_name
          limit 5
        ) sellers
      ), '[]'::jsonb),
      'monthly_trend', coalesce((
        select jsonb_agg(jsonb_build_object('month', month, 'count', count) order by month)
        from (select to_char(r3.created_at at time zone 'America/Asuncion', 'YYYY-MM') as month, count(distinct r3.order_id) as count from refs r3 where r3.scope = s.scope and r3.material_identity = s.material_identity group by 1) monthly
      ), '[]'::jsonb),
      'daily', coalesce((
        select jsonb_object_agg(day, count)
        from (select to_char(r4.created_at at time zone 'America/Asuncion', 'YYYY-MM-DD') as day, count(distinct r4.order_id) as count from refs r4 where r4.scope = s.scope and r4.material_identity = s.material_identity group by 1) daily
      ), '{}'::jsonb),
      'trend_granularity', case when sw.date_to - sw.date_from <= interval '93 days' then 'day' else 'month' end,
      'trend', coalesce((
        select jsonb_agg(jsonb_build_object('period', point.period, 'count', point.count) order by point.period)
        from (
          select to_char(series.value, case when sw.date_to - sw.date_from <= interval '93 days' then 'YYYY-MM-DD' else 'YYYY-MM' end) as period,
            coalesce((select count(distinct r5.order_id) from refs r5 where r5.scope = s.scope and r5.material_identity = s.material_identity and to_char(r5.created_at at time zone 'America/Asuncion', case when sw.date_to - sw.date_from <= interval '93 days' then 'YYYY-MM-DD' else 'YYYY-MM' end) = to_char(series.value, case when sw.date_to - sw.date_from <= interval '93 days' then 'YYYY-MM-DD' else 'YYYY-MM' end)), 0) as count
          from generate_series(
            case when sw.date_to - sw.date_from <= interval '93 days' then (select min((r6.created_at at time zone 'America/Asuncion')::date)::timestamp from refs r6 where r6.scope = s.scope and r6.material_identity = s.material_identity) else (select date_trunc('month', min(r6.created_at at time zone 'America/Asuncion')) from refs r6 where r6.scope = s.scope and r6.material_identity = s.material_identity) end,
            case when sw.date_to - sw.date_from <= interval '93 days' then ((sw.date_to at time zone 'America/Asuncion')::date - 1)::timestamp else date_trunc('month', ((sw.date_to at time zone 'America/Asuncion')::date - 1)::timestamp) end,
            case when sw.date_to - sw.date_from <= interval '93 days' then interval '1 day' else interval '1 month' end
          ) as series(value)
        ) point
      ), '[]'::jsonb)
    ) order by s.total_orders desc, s.reference_count desc, s.name), '[]'::jsonb) as rows
    from summary_totals s
    join scope_windows sw on sw.scope = s.scope
    group by s.scope
  ), range_counts as (
    select so.scope, count(distinct so.order_id) as orders_total, count(distinct r.order_id) as orders_with_material,
      count(r.order_id) as material_references, count(distinct r.material_id) filter (where r.material_id is not null) as materials_used,
      count(r.order_id) filter (where r.material_id is null) as unrecognized_references
    from scoped_orders so
    left join refs r on r.scope = so.scope and r.order_id = so.order_id
    group by so.scope
  ), cancellation_events as (
    select w.scope, count(distinct e.order_id) as count
    from scope_windows w
    left join public.order_events e on e.created_at >= w.date_from and e.created_at < w.date_to
      and lower(coalesce(e.new_status, '')) = 'cancelled' and lower(coalesce(e.old_status, '')) <> 'cancelled'
    group by w.scope
  ), order_type_json as (
    select scope, coalesce(jsonb_agg(jsonb_build_object('name', name, 'normal', normal_orders, 'urgent', urgent_orders) order by (normal_orders + urgent_orders) desc, name), '[]'::jsonb) as rows
    from summary_rows group by scope
  )
  select jsonb_build_object(
    'orders_total', coalesce((select orders_total from range_counts where scope = 'period'), 0),
    'orders_with_material', coalesce((select orders_with_material from range_counts where scope = 'period'), 0),
    'material_references', coalesce((select material_references from range_counts where scope = 'period'), 0),
    'materials_used', coalesce((select materials_used from range_counts where scope = 'period'), 0),
    'cancelled_orders', coalesce((select count from cancellation_events where scope = 'period'), 0),
    'summary', coalesce((select rows from summary_json where scope = 'period'), '[]'::jsonb),
    'order_type_by_material', coalesce((select rows from order_type_json where scope = 'period'), '[]'::jsonb),
    'cancellation_by_material', '[]'::jsonb
  ), jsonb_build_object(
    'orders_total', coalesce((select orders_total from range_counts where scope = 'comparison'), 0),
    'orders_with_material', coalesce((select orders_with_material from range_counts where scope = 'comparison'), 0),
    'material_references', coalesce((select material_references from range_counts where scope = 'comparison'), 0),
    'materials_used', coalesce((select materials_used from range_counts where scope = 'comparison'), 0),
    'cancelled_orders', coalesce((select count from cancellation_events where scope = 'comparison'), 0),
    'summary', coalesce((select rows from summary_json where scope = 'comparison'), '[]'::jsonb),
    'cancellation_by_material', '[]'::jsonb
  ), jsonb_build_object(
    'period_orders_without_material', greatest(coalesce((select orders_total from range_counts where scope = 'period'), 0) - coalesce((select orders_with_material from range_counts where scope = 'period'), 0), 0),
    'unrecognized_period_references', coalesce((select unrecognized_references from range_counts where scope = 'period'), 0),
    'cancellation_events_auditable', coalesce((select count from cancellation_events where scope = 'period'), 0),
    'material_assignment_history_available', false,
    'note', 'Las referencias identifican una relación única material–orden; no representan stock, consumo físico ni disponibilidad de inventario.'
  ) into v_period, v_comparison, v_coverage;

  return jsonb_build_object(
    'snapshot', v_snapshot,
    'period', v_period,
    'comparison', v_comparison,
    'coverage', v_coverage,
    'meta', jsonb_build_object('generated_at', now(), 'timezone', 'America/Asuncion', 'date_from', p_date_from, 'date_to', p_date_to, 'compare_from', p_compare_from, 'compare_to', p_compare_to)
  );
end;
$$;

grant execute on function public.kpi_materials_analytics(timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
