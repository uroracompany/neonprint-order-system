-- Serie comparativa exacta para KPI Materiales.
-- Cuenta órdenes distintas después de aplicar los filtros para no duplicar una
-- orden que registre más de un material.

CREATE OR REPLACE FUNCTION public.kpi_materials_comparison_series(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_compare_from timestamptz,
  p_compare_to timestamptz,
  p_material_filter text DEFAULT NULL,
  p_order_type text DEFAULT NULL,
  p_design_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_period jsonb;
  v_comparison jsonb;
  v_materials jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  IF p_date_from >= p_date_to OR p_compare_from >= p_compare_to THEN
    RAISE EXCEPTION 'Los rangos de comparación no son válidos.';
  END IF;

  IF (p_date_to - p_date_from) <> (p_compare_to - p_compare_from) THEN
    RAISE EXCEPTION 'Los períodos comparados deben tener la misma duración.';
  END IF;

  IF p_order_type IS NOT NULL AND p_order_type NOT IN ('normal', 'urgent') THEN
    RAISE EXCEPTION 'El filtro de prioridad no es válido.';
  END IF;

  IF p_design_type IS NOT NULL AND p_design_type NOT IN ('internal', 'external') THEN
    RAISE EXCEPTION 'El filtro de diseño no es válido.';
  END IF;

  WITH catalog AS (
    SELECT id, name, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS material_key
    FROM public.materials
    WHERE btrim(coalesce(name, '')) <> ''
  ), scoped_orders AS (
    SELECT 'period'::text AS scope, id, material, order_type, order_design_type, created_at
    FROM public.orders
    WHERE created_at >= p_date_from AND created_at < p_date_to
      AND coalesce(is_archived, false) = false
    UNION ALL
    SELECT 'comparison'::text AS scope, id, material, order_type, order_design_type, created_at
    FROM public.orders
    WHERE created_at >= p_compare_from AND created_at < p_compare_to
      AND coalesce(is_archived, false) = false
  ), all_refs AS (
    SELECT DISTINCT
      o.scope,
      o.id AS order_id,
      o.order_type,
      o.order_design_type,
      o.created_at,
      lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) AS material_key,
      c.id AS material_id,
      coalesce(c.name, btrim(part.raw_material)) AS material_name
    FROM scoped_orders o
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
    LEFT JOIN catalog c ON c.material_key = lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g'))
    WHERE btrim(part.raw_material) <> ''
  ), filtered_refs AS (
    SELECT *
    FROM all_refs r
    WHERE (
      p_material_filter IS NULL
      OR r.material_id::text = p_material_filter
      OR r.material_key = lower(regexp_replace(btrim(p_material_filter), '[[:space:]]+', ' ', 'g'))
    )
      AND (
        p_order_type IS NULL
        OR (p_order_type = 'urgent' AND lower(coalesce(r.order_type, '')) LIKE '%911%')
        OR (p_order_type = 'normal' AND lower(coalesce(r.order_type, '')) NOT LIKE '%911%')
      )
      AND (
        p_design_type IS NULL
        OR (p_design_type = 'internal' AND r.order_design_type = 'INTERNAL_DESING')
        OR (p_design_type = 'external' AND r.order_design_type = 'EXTERNAL_DESING')
      )
  ), scope_metrics AS (
    SELECT
      scope,
      count(*) AS reference_count,
      count(DISTINCT order_id) AS orders_with_material,
      count(DISTINCT material_key) AS materials_used,
      count(DISTINCT order_id) FILTER (WHERE lower(coalesce(order_type, '')) NOT LIKE '%911%') AS normal_orders,
      count(DISTINCT order_id) FILTER (WHERE lower(coalesce(order_type, '')) LIKE '%911%') AS urgent_orders,
      count(DISTINCT order_id) FILTER (WHERE order_design_type = 'INTERNAL_DESING') AS internal_orders,
      count(DISTINCT order_id) FILTER (WHERE order_design_type = 'EXTERNAL_DESING') AS external_orders
    FROM filtered_refs
    GROUP BY scope
  ), timeline_rows AS (
    SELECT
      scope,
      to_char(created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD') AS day,
      count(*) AS reference_count,
      count(DISTINCT order_id) AS orders_with_material,
      count(DISTINCT material_key) AS materials_used
    FROM filtered_refs
    GROUP BY scope, to_char(created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD')
  ), timeline_json AS (
    SELECT scope, jsonb_agg(jsonb_build_object(
      'date', day,
      'references', reference_count,
      'orders_with_material', orders_with_material,
      'materials_used', materials_used
    ) ORDER BY day) AS rows
    FROM timeline_rows
    GROUP BY scope
  ), material_rows AS (
    SELECT material_id, material_key, max(material_name) AS material_name
    FROM all_refs
    GROUP BY material_id, material_key
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'value', coalesce(material_id::text, material_key),
    'label', material_name
  ) ORDER BY material_name), '[]'::jsonb)
  INTO v_materials
  FROM material_rows;

  SELECT jsonb_build_object(
    'metrics', coalesce((
      SELECT jsonb_build_object(
        'references', reference_count,
        'orders_with_material', orders_with_material,
        'materials_used', materials_used,
        'normal_orders', normal_orders,
        'urgent_orders', urgent_orders,
        'internal_orders', internal_orders,
        'external_orders', external_orders
      )
      FROM scope_metrics
      WHERE scope = 'period'
    ), jsonb_build_object(
      'references', 0, 'orders_with_material', 0, 'materials_used', 0,
      'normal_orders', 0, 'urgent_orders', 0, 'internal_orders', 0, 'external_orders', 0
    )),
    'timeline', coalesce((SELECT rows FROM timeline_json WHERE scope = 'period'), '[]'::jsonb)
  ) INTO v_period;

  SELECT jsonb_build_object(
    'metrics', coalesce((
      SELECT jsonb_build_object(
        'references', reference_count,
        'orders_with_material', orders_with_material,
        'materials_used', materials_used,
        'normal_orders', normal_orders,
        'urgent_orders', urgent_orders,
        'internal_orders', internal_orders,
        'external_orders', external_orders
      )
      FROM scope_metrics
      WHERE scope = 'comparison'
    ), jsonb_build_object(
      'references', 0, 'orders_with_material', 0, 'materials_used', 0,
      'normal_orders', 0, 'urgent_orders', 0, 'internal_orders', 0, 'external_orders', 0
    )),
    'timeline', coalesce((SELECT rows FROM timeline_json WHERE scope = 'comparison'), '[]'::jsonb)
  ) INTO v_comparison;

  RETURN jsonb_build_object(
    'period', v_period,
    'comparison', v_comparison,
    'materials', v_materials,
    'filters', jsonb_build_object(
      'material_key', p_material_filter,
      'order_type', p_order_type,
      'design_type', p_design_type
    ),
    'meta', jsonb_build_object(
      'date_from', p_date_from,
      'date_to', p_date_to,
      'compare_from', p_compare_from,
      'compare_to', p_compare_to,
      'timezone', current_setting('TimeZone')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_materials_comparison_series(timestamptz, timestamptz, timestamptz, timestamptz, text, text, text) TO authenticated;
