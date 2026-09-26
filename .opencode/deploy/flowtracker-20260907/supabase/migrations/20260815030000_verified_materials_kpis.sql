-- KPI Materiales verificable.
-- El sistema actual solo conserva el nombre del material en orders.material;
-- por eso este contrato mide referencias registradas en órdenes, no stock,
-- consumo físico, costo ni disponibilidad de inventario.

CREATE INDEX IF NOT EXISTS idx_orders_material_kpi_created_at
  ON public.orders (created_at)
  WHERE material IS NOT NULL
    AND btrim(material) <> ''
    AND coalesce(is_archived, false) = false;

CREATE OR REPLACE FUNCTION public.kpi_materials_analytics(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_compare_from timestamptz,
  p_compare_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_snapshot jsonb;
  v_period jsonb;
  v_comparison jsonb;
  v_coverage jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  WITH catalog AS (
    SELECT
      id,
      name,
      lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS material_key
    FROM public.materials
    WHERE btrim(coalesce(name, '')) <> ''
  ), open_orders AS (
    SELECT id, material
    FROM public.orders
    WHERE lower(coalesce(status, '')) IN ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination')
      AND coalesce(is_archived, false) = false
  ), open_refs AS (
    SELECT DISTINCT
      o.id AS order_id,
      lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) AS material_key
    FROM open_orders o
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
    WHERE btrim(part.raw_material) <> ''
  )
  SELECT jsonb_build_object(
    'catalog_materials', (SELECT count(*) FROM catalog),
    'open_orders', (SELECT count(*) FROM open_orders),
    'open_orders_with_material', (SELECT count(DISTINCT order_id) FROM open_refs),
    'open_orders_without_material', (SELECT count(*) FROM open_orders) - (SELECT count(DISTINCT order_id) FROM open_refs),
    'materials_in_open_orders', (SELECT count(DISTINCT material_key) FROM open_refs),
    'unrecognized_open_references', (
      SELECT count(*) FROM open_refs r
      LEFT JOIN catalog c ON c.material_key = r.material_key
      WHERE c.id IS NULL
    )
  ) INTO v_snapshot;

  WITH catalog AS (
    SELECT id, name, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS material_key
    FROM public.materials
    WHERE btrim(coalesce(name, '')) <> ''
  ), scoped_orders AS (
    SELECT 'period'::text AS scope, id, client_id, client_name, material, order_type, order_design_type, coalesce(seller_id, created_by) AS seller_id, created_at
    FROM public.orders
    WHERE created_at >= p_date_from AND created_at < p_date_to AND coalesce(is_archived, false) = false
    UNION ALL
    SELECT 'comparison'::text AS scope, id, client_id, client_name, material, order_type, order_design_type, coalesce(seller_id, created_by) AS seller_id, created_at
    FROM public.orders
    WHERE created_at >= p_compare_from AND created_at < p_compare_to AND coalesce(is_archived, false) = false
  ), material_refs AS (
    SELECT DISTINCT
      o.scope,
      o.id AS order_id,
      o.client_id,
      o.client_name,
      o.order_type,
      o.order_design_type,
      o.seller_id,
      o.created_at,
      btrim(part.raw_material) AS display_name,
      lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) AS material_key
    FROM scoped_orders o
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
    WHERE btrim(part.raw_material) <> ''
  ), refs AS (
    SELECT r.*, c.id AS material_id, c.name AS catalog_name
    FROM material_refs r
    LEFT JOIN catalog c ON c.material_key = r.material_key
  ), period_cancellations AS (
    SELECT DISTINCT 'period'::text AS scope, e.order_id
    FROM public.order_events e
    WHERE lower(coalesce(e.new_status, '')) = 'cancelled'
      AND lower(coalesce(e.old_status, '')) <> 'cancelled'
      AND e.created_at >= p_date_from AND e.created_at < p_date_to
    UNION ALL
    SELECT DISTINCT 'comparison'::text AS scope, e.order_id
    FROM public.order_events e
    WHERE lower(coalesce(e.new_status, '')) = 'cancelled'
      AND lower(coalesce(e.old_status, '')) <> 'cancelled'
      AND e.created_at >= p_compare_from AND e.created_at < p_compare_to
  ), cancellation_refs AS (
    SELECT DISTINCT
      c.scope,
      c.order_id,
      lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) AS material_key,
      btrim(part.raw_material) AS display_name
    FROM period_cancellations c
    JOIN public.orders o ON o.id = c.order_id
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
    WHERE btrim(part.raw_material) <> ''
  ), cancellation_by_material AS (
    SELECT
      r.scope,
      r.material_key,
      coalesce(max(c.name), min(r.display_name)) AS name,
      count(DISTINCT r.order_id) AS cancelled_orders
    FROM cancellation_refs r
    LEFT JOIN catalog c ON c.material_key = r.material_key
    GROUP BY r.scope, r.material_key
  ), summary_rows AS (
    SELECT
      r.scope,
      r.material_key,
      max(r.material_id) AS material_id,
      coalesce(max(r.catalog_name), min(r.display_name)) AS name,
      count(DISTINCT r.order_id) AS total_orders,
      count(*) AS reference_count,
      count(DISTINCT r.order_id) FILTER (WHERE lower(coalesce(r.order_type, '')) LIKE '%911%') AS urgent_orders,
      count(DISTINCT r.order_id) FILTER (WHERE lower(coalesce(r.order_type, '')) NOT LIKE '%911%') AS normal_orders,
      count(DISTINCT r.order_id) FILTER (WHERE r.order_design_type = 'INTERNAL_DESING') AS internal_design_orders,
      count(DISTINCT r.order_id) FILTER (WHERE r.order_design_type = 'EXTERNAL_DESING') AS external_design_orders,
      count(DISTINCT r.order_id) FILTER (WHERE lower(coalesce(r.order_type, '')) NOT LIKE '%911%' AND r.order_design_type = 'INTERNAL_DESING') AS normal_internal_orders,
      count(DISTINCT r.order_id) FILTER (WHERE lower(coalesce(r.order_type, '')) NOT LIKE '%911%' AND r.order_design_type = 'EXTERNAL_DESING') AS normal_external_orders,
      count(DISTINCT r.order_id) FILTER (WHERE lower(coalesce(r.order_type, '')) LIKE '%911%' AND r.order_design_type = 'INTERNAL_DESING') AS urgent_internal_orders,
      count(DISTINCT r.order_id) FILTER (WHERE lower(coalesce(r.order_type, '')) LIKE '%911%' AND r.order_design_type = 'EXTERNAL_DESING') AS urgent_external_orders
    FROM refs r
    GROUP BY r.scope, r.material_key
  ), summary_rows_with_total AS (
    SELECT s.*, sum(s.reference_count) OVER (PARTITION BY s.scope) AS scope_reference_count
    FROM summary_rows s
  ), summary_json AS (
    SELECT
      s.scope,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'material_id', s.material_id,
          'name', s.name,
          'total_orders', s.total_orders,
          'reference_count', s.reference_count,
          'cancelled_orders', coalesce(c.cancelled_orders, 0),
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
            SELECT jsonb_agg(jsonb_build_object('client_name', client_name, 'count', count) ORDER BY count DESC, client_name)
            FROM (
              SELECT coalesce(r2.client_name, 'Sin cliente') AS client_name, count(DISTINCT r2.order_id) AS count
              FROM refs r2
              WHERE r2.scope = s.scope AND r2.material_key = s.material_key AND r2.seller_id IS NOT NULL
              GROUP BY coalesce(r2.client_name, 'Sin cliente')
              ORDER BY count DESC, client_name
              LIMIT 5
            ) clients
          ), '[]'::jsonb),
          'top_sellers', coalesce((
            SELECT jsonb_agg(jsonb_build_object('seller_id', seller_id, 'seller_name', seller_name, 'count', count) ORDER BY count DESC, seller_name)
            FROM (
              SELECT r2.seller_id, coalesce(p.name, 'Sin vendedor') AS seller_name, count(DISTINCT r2.order_id) AS count
              FROM refs r2
              LEFT JOIN public.profiles p ON p.id = r2.seller_id AND p.role = 'seller'
              WHERE r2.scope = s.scope AND r2.material_key = s.material_key
              GROUP BY r2.seller_id, coalesce(p.name, 'Sin vendedor')
              ORDER BY count DESC, seller_name
              LIMIT 5
            ) sellers
          ), '[]'::jsonb),
          'monthly_trend', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', month, 'count', count) ORDER BY month)
            FROM (
              SELECT to_char(r3.created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM') AS month, count(*) AS count
              FROM refs r3
              WHERE r3.scope = s.scope AND r3.material_key = s.material_key
              GROUP BY 1
            ) monthly
          ), '[]'::jsonb),
          'daily', coalesce((
            SELECT jsonb_object_agg(day, count)
            FROM (
              SELECT to_char(r4.created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD') AS day, count(*) AS count
              FROM refs r4
              WHERE r4.scope = s.scope AND r4.material_key = s.material_key
              GROUP BY 1
            ) daily
          ), '{}'::jsonb)
        )
        ORDER BY s.total_orders DESC, s.reference_count DESC, s.name
      ), '[]'::jsonb) AS rows
    FROM summary_rows_with_total s
    LEFT JOIN cancellation_by_material c ON c.scope = s.scope AND c.material_key = s.material_key
    GROUP BY s.scope
  ), range_counts AS (
    SELECT
      o.scope,
      count(*) AS orders_total,
      count(DISTINCT r.order_id) AS orders_with_material,
      count(r.order_id) AS material_references,
      count(DISTINCT r.material_key) AS materials_used,
      count(*) FILTER (WHERE r.material_id IS NULL) AS unrecognized_references
    FROM scoped_orders o
    LEFT JOIN refs r ON r.scope = o.scope AND r.order_id = o.id
    GROUP BY o.scope
  ), order_type_json AS (
    SELECT scope, coalesce(jsonb_agg(jsonb_build_object('name', name, 'normal', normal_orders, 'urgent', urgent_orders) ORDER BY (normal_orders + urgent_orders) DESC, name), '[]'::jsonb) AS rows
    FROM summary_rows
    GROUP BY scope
  ), cancellation_json AS (
    SELECT scope, coalesce(jsonb_agg(jsonb_build_object('name', name, 'cancelled_orders', cancelled_orders) ORDER BY cancelled_orders DESC, name), '[]'::jsonb) AS rows
    FROM cancellation_by_material
    GROUP BY scope
  )
  SELECT jsonb_build_object(
    'orders_total', coalesce((SELECT orders_total FROM range_counts WHERE scope = 'period'), 0),
    'orders_with_material', coalesce((SELECT orders_with_material FROM range_counts WHERE scope = 'period'), 0),
    'material_references', coalesce((SELECT material_references FROM range_counts WHERE scope = 'period'), 0),
    'materials_used', coalesce((SELECT materials_used FROM range_counts WHERE scope = 'period'), 0),
    'cancelled_orders', (SELECT count(*) FROM period_cancellations WHERE scope = 'period'),
    'summary', coalesce((SELECT rows FROM summary_json WHERE scope = 'period'), '[]'::jsonb),
    'order_type_by_material', coalesce((SELECT rows FROM order_type_json WHERE scope = 'period'), '[]'::jsonb),
    'cancellation_by_material', coalesce((SELECT rows FROM cancellation_json WHERE scope = 'period'), '[]'::jsonb)
  ) INTO v_period;

  WITH counts AS (
    SELECT
      count(*) AS orders_total,
      count(DISTINCT r.order_id) AS orders_with_material,
      count(r.order_id) AS material_references,
      count(DISTINCT r.material_key) AS materials_used,
      count(*) FILTER (WHERE r.material_id IS NULL) AS unrecognized_references
    FROM (
      SELECT id, material
      FROM public.orders
      WHERE created_at >= p_compare_from AND created_at < p_compare_to AND coalesce(is_archived, false) = false
    ) o
    LEFT JOIN LATERAL (
      SELECT DISTINCT
        o.id AS order_id,
        lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) AS material_key,
        c.id AS material_id
      FROM regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
      LEFT JOIN public.materials c ON lower(regexp_replace(btrim(c.name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g'))
      WHERE btrim(part.raw_material) <> ''
    ) r ON true
  )
  SELECT jsonb_build_object(
    'orders_total', coalesce(orders_total, 0),
    'orders_with_material', coalesce(orders_with_material, 0),
    'material_references', coalesce(material_references, 0),
    'materials_used', coalesce(materials_used, 0),
    'cancelled_orders', (
      SELECT count(DISTINCT e.order_id)
      FROM public.order_events e
      WHERE lower(coalesce(e.new_status, '')) = 'cancelled'
        AND lower(coalesce(e.old_status, '')) <> 'cancelled'
        AND e.created_at >= p_compare_from AND e.created_at < p_compare_to
    ),
    'summary', '[]'::jsonb,
    'cancellation_by_material', '[]'::jsonb
  ) INTO v_comparison
  FROM counts;

  -- Rebuild the comparison details without guessing dates or status changes.
  WITH catalog AS (
    SELECT id, name, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS material_key
    FROM public.materials WHERE btrim(coalesce(name, '')) <> ''
  ), refs AS (
    SELECT DISTINCT
      o.id AS order_id,
      o.client_name,
      o.order_type,
      o.order_design_type,
      o.created_at,
      btrim(part.raw_material) AS display_name,
      lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) AS material_key,
      c.id AS material_id,
      c.name AS catalog_name
    FROM public.orders o
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
    LEFT JOIN catalog c ON c.material_key = lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g'))
    WHERE o.created_at >= p_compare_from AND o.created_at < p_compare_to
      AND coalesce(o.is_archived, false) = false
      AND btrim(part.raw_material) <> ''
  ), rows AS (
    SELECT material_key, max(material_id) AS material_id, coalesce(max(catalog_name), min(display_name)) AS name,
      count(DISTINCT order_id) AS total_orders, count(*) AS reference_count,
      count(*) FILTER (WHERE lower(coalesce(order_type, '')) LIKE '%911%') AS urgent_orders,
      count(*) FILTER (WHERE lower(coalesce(order_type, '')) NOT LIKE '%911%') AS normal_orders,
      count(*) FILTER (WHERE order_design_type = 'INTERNAL_DESING') AS internal_design_orders,
      count(*) FILTER (WHERE order_design_type = 'EXTERNAL_DESING') AS external_design_orders,
      count(*) FILTER (WHERE lower(coalesce(order_type, '')) NOT LIKE '%911%' AND order_design_type = 'INTERNAL_DESING') AS normal_internal_orders,
      count(*) FILTER (WHERE lower(coalesce(order_type, '')) NOT LIKE '%911%' AND order_design_type = 'EXTERNAL_DESING') AS normal_external_orders,
      count(*) FILTER (WHERE lower(coalesce(order_type, '')) LIKE '%911%' AND order_design_type = 'INTERNAL_DESING') AS urgent_internal_orders,
      count(*) FILTER (WHERE lower(coalesce(order_type, '')) LIKE '%911%' AND order_design_type = 'EXTERNAL_DESING') AS urgent_external_orders
    FROM refs GROUP BY material_key
  )
  SELECT v_comparison || jsonb_build_object(
    'summary', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'material_id', r.material_id, 'name', r.name, 'total_orders', r.total_orders,
        'reference_count', r.reference_count, 'normal_orders', r.normal_orders, 'urgent_orders', r.urgent_orders,
        'internal_design_orders', r.internal_design_orders, 'external_design_orders', r.external_design_orders,
        'normal_internal_orders', r.normal_internal_orders, 'normal_external_orders', r.normal_external_orders,
        'urgent_internal_orders', r.urgent_internal_orders, 'urgent_external_orders', r.urgent_external_orders,
        'daily', coalesce((SELECT jsonb_object_agg(day, count) FROM (SELECT to_char(x.created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD') AS day, count(*) AS count FROM refs x WHERE x.material_key = r.material_key GROUP BY 1) daily), '{}'::jsonb),
        'monthly_trend', coalesce((SELECT jsonb_agg(jsonb_build_object('month', month, 'count', count) ORDER BY month) FROM (SELECT to_char(x.created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM') AS month, count(*) AS count FROM refs x WHERE x.material_key = r.material_key GROUP BY 1) monthly), '[]'::jsonb)
      ) ORDER BY r.total_orders DESC, r.reference_count DESC, r.name)
      FROM rows r
    ), '[]'::jsonb)
  ) INTO v_comparison;

  SELECT jsonb_build_object(
    'period_orders_without_material', greatest((v_period ->> 'orders_total')::integer - (v_period ->> 'orders_with_material')::integer, 0),
    'unrecognized_period_references', coalesce((
      SELECT count(*)
      FROM public.orders o
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
      LEFT JOIN public.materials c ON lower(regexp_replace(btrim(c.name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g'))
      WHERE o.created_at >= p_date_from AND o.created_at < p_date_to
        AND coalesce(o.is_archived, false) = false
        AND btrim(part.raw_material) <> ''
        AND c.id IS NULL
    ), 0),
    'cancellation_events_auditable', (v_period ->> 'cancelled_orders')::integer,
    'material_assignment_history_available', false,
    'note', 'Las referencias usan el material actualmente registrado en cada orden; no representan inventario ni consumo físico.'
  ) INTO v_coverage;

  RETURN jsonb_build_object(
    'snapshot', v_snapshot,
    'period', v_period,
    'comparison', v_comparison,
    'coverage', v_coverage,
    'meta', jsonb_build_object(
      'generated_at', now(),
      'timezone', current_setting('TimeZone'),
      'date_from', p_date_from,
      'date_to', p_date_to,
      'compare_from', p_compare_from,
      'compare_to', p_compare_to
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_materials_analytics(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
