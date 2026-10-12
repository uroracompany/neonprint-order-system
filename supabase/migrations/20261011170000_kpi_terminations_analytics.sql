-- Administrator analytics for production terminations.
-- File-level termination metadata is canonical. Legacy order summaries are
-- used only for orders that have no classified file termination.

create or replace function public.kpi_terminations_analytics(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_compare_from timestamptz,
  p_compare_to timestamptz,
  p_termination_id bigint default null,
  p_production_area_code text default null
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
    select t.id, t.name, t.production_area_code,
      lower(regexp_replace(btrim(t.name), '[[:space:]]+', ' ', 'g')) as termination_key
    from public.production_terminations t
    where nullif(btrim(t.name), '') is not null
  ), catalog_match as (
    select c.*,
      count(*) over (partition by c.production_area_code, c.termination_key) as area_name_count
    from catalog c
  ), open_orders as (
    select o.id, o.termination_type
    from public.orders o
    where lower(coalesce(o.status, '')) in ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination')
      and coalesce(o.is_archived, false) = false
  ), open_file_refs as (
    select distinct o.id as order_id,
      coalesce(c.id::text, 'unknown:' || coalesce(f.production_area_code, '') || ':' || lower(regexp_replace(btrim(f.termination_name), '[[:space:]]+', ' ', 'g'))) as termination_identity
    from open_orders o
    join public.order_production_files f on f.order_id = o.id
      and nullif(btrim(f.termination_name), '') is not null
    left join catalog_match c on c.area_name_count = 1
      and c.production_area_code = f.production_area_code
      and c.termination_key = lower(regexp_replace(btrim(f.termination_name), '[[:space:]]+', ' ', 'g'))
  ), open_legacy_catalog as (
    select termination_key, min(id) as termination_id
    from catalog
    group by termination_key
    having count(*) = 1
  ), open_legacy_refs as (
    select distinct o.id as order_id,
      coalesce(c.termination_id::text, 'unknown:legacy:' || lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g'))) as termination_identity
    from open_orders o
    cross join lateral regexp_split_to_table(coalesce(o.termination_type, ''), '[,;/|]+') as part(name)
    left join open_legacy_catalog c on c.termination_key = lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g'))
    where nullif(btrim(part.name), '') is not null
      and not exists (
        select 1
        from public.order_production_files f
        where f.order_id = o.id
          and nullif(btrim(f.termination_name), '') is not null
      )
  ), open_refs as (
    select * from open_file_refs
    union all
    select * from open_legacy_refs
  )
  select jsonb_build_object(
    'catalog_terminations', (select count(*) from catalog),
    'open_orders', (select count(*) from open_orders),
    'open_orders_with_termination', (select count(distinct order_id) from open_refs),
    'open_orders_without_termination', greatest((select count(*) from open_orders) - (select count(distinct order_id) from open_refs), 0),
    'unrecognized_open_references', (select count(*) from open_refs where termination_identity like 'unknown:%')
  ) into v_snapshot;

  with scope_windows(scope, date_from, date_to) as (
    values ('period'::text, p_date_from, p_date_to), ('comparison'::text, p_compare_from, p_compare_to)
  ), scoped_orders as (
    select w.scope, w.date_from, w.date_to, o.id as order_id, o.client_id, o.client_name,
      o.termination_type, o.status, o.order_type, o.order_design_type,
      coalesce(o.seller_id, o.created_by) as seller_id, o.created_at
    from scope_windows w
    join public.orders o on o.created_at >= w.date_from and o.created_at < w.date_to
    where coalesce(o.is_archived, false) = false
  ), catalog as (
    select t.id, t.name, t.production_area_code,
      lower(regexp_replace(btrim(t.name), '[[:space:]]+', ' ', 'g')) as termination_key
    from public.production_terminations t
    where nullif(btrim(t.name), '') is not null
  ), catalog_match as (
    select c.*,
      count(*) over (partition by c.production_area_code, c.termination_key) as area_name_count
    from catalog c
  ), legacy_catalog as (
    select termination_key, min(id) as termination_id, min(name) as catalog_name
    from catalog
    group by termination_key
    having count(*) = 1
  ), file_candidates as (
    select so.*, f.production_area_code, btrim(f.termination_name) as display_name,
      lower(regexp_replace(btrim(f.termination_name), '[[:space:]]+', ' ', 'g')) as termination_key,
      c.id as termination_id, c.name as catalog_name
    from scoped_orders so
    join public.order_production_files f on f.order_id = so.order_id
      and nullif(btrim(f.termination_name), '') is not null
    left join catalog_match c on c.area_name_count = 1
      and c.production_area_code = f.production_area_code
      and c.termination_key = lower(regexp_replace(btrim(f.termination_name), '[[:space:]]+', ' ', 'g'))
  ), file_refs as (
    select distinct on (scope, order_id, termination_identity)
      scope, date_from, date_to, order_id, client_id, client_name, status, order_type,
      order_design_type, seller_id, created_at, display_name, termination_key,
      termination_id, catalog_name, production_area_code,
      coalesce(termination_id::text, 'unknown:' || coalesce(production_area_code, '') || ':' || termination_key) as termination_identity
    from file_candidates
    order by scope, order_id, termination_identity, created_at
  ), legacy_candidates as (
    select so.*, btrim(part.name) as display_name,
      lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g')) as termination_key,
      lc.termination_id, lc.catalog_name,
      null::text as production_area_code
    from scoped_orders so
    cross join lateral regexp_split_to_table(coalesce(so.termination_type, ''), '[,;/|]+') as part(name)
    left join legacy_catalog lc on lc.termination_key = lower(regexp_replace(btrim(part.name), '[[:space:]]+', ' ', 'g'))
    where nullif(btrim(part.name), '') is not null
      and not exists (
        select 1
        from public.order_production_files f
        where f.order_id = so.order_id
          and nullif(btrim(f.termination_name), '') is not null
      )
  ), legacy_refs as (
    select distinct on (scope, order_id, termination_identity)
      scope, date_from, date_to, order_id, client_id, client_name, status, order_type,
      order_design_type, seller_id, created_at, display_name, termination_key,
      termination_id, catalog_name, production_area_code,
      coalesce(termination_id::text, 'unknown:legacy:' || termination_key) as termination_identity
    from legacy_candidates
    order by scope, order_id, termination_identity, created_at
  ), refs as (
    select * from file_refs
    union all
    select * from legacy_refs
  ), summary_rows as (
    select r.scope, r.termination_identity, r.termination_id,
      coalesce(max(r.catalog_name), min(r.display_name)) as name,
      max(r.production_area_code) as production_area_code,
      count(distinct r.order_id) as total_orders,
      count(distinct r.order_id) as reference_count,
      count(distinct r.order_id) filter (where r.status = 'cancelled') as cancelled_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) like '%911%') as urgent_orders,
      count(distinct r.order_id) filter (where lower(coalesce(r.order_type, '')) not like '%911%') as normal_orders,
      count(distinct r.order_id) filter (where r.order_design_type = 'INTERNAL_DESING') as internal_design_orders,
      count(distinct r.order_id) filter (where r.order_design_type = 'EXTERNAL_DESING') as external_design_orders
    from refs r
    group by r.scope, r.termination_identity, r.termination_id
  ), summary_totals as (
    select s.*, sum(s.reference_count) over (partition by s.scope) as scope_reference_count
    from summary_rows s
  ), summary_json as (
    select s.scope, coalesce(jsonb_agg(jsonb_build_object(
      'termination_id', s.termination_id,
      'name', s.name,
      'production_area_code', s.production_area_code,
      'total_orders', s.total_orders,
      'reference_count', s.reference_count,
      'cancelled_orders', s.cancelled_orders,
      'normal_orders', s.normal_orders,
      'urgent_orders', s.urgent_orders,
      'internal_design_orders', s.internal_design_orders,
      'external_design_orders', s.external_design_orders,
      'usage_pct', round(s.reference_count::numeric / nullif(s.scope_reference_count, 0) * 100, 1),
      'top_clients', coalesce((
        select jsonb_agg(jsonb_build_object('client_id', clients.client_id, 'client_name', clients.client_name, 'count', clients.count) order by clients.count desc, clients.client_name)
        from (
          select r2.client_id,
            coalesce(nullif(min(c.name), ''), 'Sin cliente') as client_name,
            count(distinct r2.order_id) as count
          from refs r2
          left join public.clients c on c.id = r2.client_id and c.deleted_at is null
          where r2.scope = s.scope and r2.termination_identity = s.termination_identity
          group by r2.client_id
          order by count desc, client_name
          limit 5
        ) clients
      ), '[]'::jsonb),
      'top_sellers', coalesce((
        select jsonb_agg(jsonb_build_object('seller_id', sellers.seller_id, 'seller_name', sellers.seller_name, 'count', sellers.count) order by sellers.count desc, sellers.seller_name)
        from (
          select r2.seller_id, coalesce(p.name, 'Sin vendedor') as seller_name,
            count(distinct r2.order_id) as count
          from refs r2
          left join public.profiles p on p.id = r2.seller_id and p.role = 'seller'
          where r2.scope = s.scope and r2.termination_identity = s.termination_identity
          group by r2.seller_id, coalesce(p.name, 'Sin vendedor')
          order by count desc, seller_name
          limit 5
        ) sellers
      ), '[]'::jsonb),
      'monthly_trend', coalesce((
        select jsonb_agg(jsonb_build_object('month', month, 'count', count) order by month)
        from (
          select to_char(r3.created_at at time zone 'America/Asuncion', 'YYYY-MM') as month,
            count(distinct r3.order_id) as count
          from refs r3
          where r3.scope = s.scope and r3.termination_identity = s.termination_identity
          group by 1
        ) monthly
      ), '[]'::jsonb),
      'daily', coalesce((
        select jsonb_object_agg(day, count)
        from (
          select to_char(r4.created_at at time zone 'America/Asuncion', 'YYYY-MM-DD') as day,
            count(distinct r4.order_id) as count
          from refs r4
          where r4.scope = s.scope and r4.termination_identity = s.termination_identity
          group by 1
        ) daily
      ), '{}'::jsonb),
      'trend_granularity', case when sw.date_to - sw.date_from <= interval '93 days' then 'day' else 'month' end,
      'trend', coalesce((
        select jsonb_agg(jsonb_build_object('period', point.period, 'count', point.count) order by point.period)
        from (
          select to_char(series.value, case when sw.date_to - sw.date_from <= interval '93 days' then 'YYYY-MM-DD' else 'YYYY-MM' end) as period,
            coalesce((
              select count(distinct r5.order_id)
              from refs r5
              where r5.scope = s.scope
                and r5.termination_identity = s.termination_identity
                and to_char(r5.created_at at time zone 'America/Asuncion', case when sw.date_to - sw.date_from <= interval '93 days' then 'YYYY-MM-DD' else 'YYYY-MM' end) = to_char(series.value, case when sw.date_to - sw.date_from <= interval '93 days' then 'YYYY-MM-DD' else 'YYYY-MM' end)
            ), 0) as count
          from generate_series(
            case when sw.date_to - sw.date_from <= interval '93 days'
              then (select date_trunc('day', min(r6.created_at at time zone 'America/Asuncion')) from refs r6 where r6.scope = s.scope and r6.termination_identity = s.termination_identity)
              else (select date_trunc('month', min(r6.created_at at time zone 'America/Asuncion')) from refs r6 where r6.scope = s.scope and r6.termination_identity = s.termination_identity)
            end,
            case when sw.date_to - sw.date_from <= interval '93 days'
              then date_trunc('day', (sw.date_to at time zone 'America/Asuncion') - interval '1 day')
              else date_trunc('month', (sw.date_to at time zone 'America/Asuncion') - interval '1 day')
            end,
            case when sw.date_to - sw.date_from <= interval '93 days' then interval '1 day' else interval '1 month' end
          ) as series(value)
        ) point
      ), '[]'::jsonb)
    ) order by s.total_orders desc, s.reference_count desc, s.name), '[]'::jsonb) as rows
    from summary_totals s
    join scope_windows sw on sw.scope = s.scope
    where p_termination_id is null
      or (s.termination_id = p_termination_id
        and (p_production_area_code is null or s.production_area_code is null or s.production_area_code = p_production_area_code))
    group by s.scope
  ), range_counts as (
    select so.scope,
      count(distinct so.order_id) as orders_total,
      count(distinct r.order_id) as orders_with_termination,
      count(r.order_id) as termination_references,
      count(distinct r.termination_id) filter (where r.termination_id is not null) as terminations_used,
      count(r.order_id) filter (where r.termination_id is null) as unrecognized_references
    from scoped_orders so
    left join refs r on r.scope = so.scope and r.order_id = so.order_id
    group by so.scope
  ), cancellation_events as (
    select w.scope, count(distinct e.order_id) as count
    from scope_windows w
    left join public.order_events e on e.created_at >= w.date_from and e.created_at < w.date_to
      and lower(coalesce(e.new_status, '')) = 'cancelled'
      and lower(coalesce(e.old_status, '')) <> 'cancelled'
    group by w.scope
  )
  select
    jsonb_build_object(
      'orders_total', coalesce((select orders_total from range_counts where scope = 'period'), 0),
      'orders_with_termination', coalesce((select orders_with_termination from range_counts where scope = 'period'), 0),
      'termination_references', coalesce((select termination_references from range_counts where scope = 'period'), 0),
      'terminations_used', coalesce((select terminations_used from range_counts where scope = 'period'), 0),
      'cancelled_orders', coalesce((select count from cancellation_events where scope = 'period'), 0),
      'summary', coalesce((select rows from summary_json where scope = 'period'), '[]'::jsonb)
    ),
    jsonb_build_object(
      'orders_total', coalesce((select orders_total from range_counts where scope = 'comparison'), 0),
      'orders_with_termination', coalesce((select orders_with_termination from range_counts where scope = 'comparison'), 0),
      'termination_references', coalesce((select termination_references from range_counts where scope = 'comparison'), 0),
      'terminations_used', coalesce((select terminations_used from range_counts where scope = 'comparison'), 0),
      'summary', coalesce((select rows from summary_json where scope = 'comparison'), '[]'::jsonb)
    ),
    jsonb_build_object(
      'period_orders_without_termination', greatest(coalesce((select orders_total from range_counts where scope = 'period'), 0) - coalesce((select orders_with_termination from range_counts where scope = 'period'), 0), 0),
      'unrecognized_period_references', coalesce((select unrecognized_references from range_counts where scope = 'period'), 0),
      'cancellation_events_auditable', coalesce((select count from cancellation_events where scope = 'period'), 0),
      'termination_assignment_history_available', false,
      'note', 'Las referencias identifican una relación única terminación–orden; no representan capacidad disponible ni consumo físico de producción.'
    )
  into v_period, v_comparison, v_coverage;

  return jsonb_build_object(
    'snapshot', v_snapshot,
    'period', v_period,
    'comparison', v_comparison,
    'coverage', v_coverage,
    'meta', jsonb_build_object(
      'generated_at', now(),
      'timezone', 'America/Asuncion',
      'date_from', p_date_from,
      'date_to', p_date_to,
      'compare_from', p_compare_from,
      'compare_to', p_compare_to
    )
  );
end;
$$;

revoke all on function public.kpi_terminations_analytics(timestamptz, timestamptz, timestamptz, timestamptz, bigint, text) from public, anon;
grant execute on function public.kpi_terminations_analytics(timestamptz, timestamptz, timestamptz, timestamptz, bigint, text) to authenticated;

notify pgrst, 'reload schema';
