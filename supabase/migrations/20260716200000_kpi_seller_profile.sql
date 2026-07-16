CREATE OR REPLACE FUNCTION public.kpi_seller_profile(
  p_seller_id uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  WITH period_orders AS (
    SELECT o.*
    FROM public.orders o
    WHERE COALESCE(o.seller_id, o.created_by) = p_seller_id
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
  ),
  top_clients AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'client_id', sub.client_id,
          'client_name', sub.client_name,
          'total_orders', sub.total,
          'completed_orders', sub.completed,
          'cancel_rate', CASE WHEN sub.total > 0 THEN ROUND(sub.cancelled::numeric / sub.total * 100, 1) ELSE 0 END
        )
        ORDER BY sub.total DESC
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT
        o.client_id,
        o.client_name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered'))::int AS completed,
        COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'cancelled')::int AS cancelled
      FROM period_orders o
      WHERE o.client_name IS NOT NULL AND o.client_name != ''
      GROUP BY o.client_id, o.client_name
      ORDER BY total DESC
      LIMIT 10
    ) sub
  ),
  materials AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', m.name,
          'count', m.count,
          'pct', CASE WHEN total_mat.total > 0 THEN ROUND(m.count::numeric / total_mat.total * 100, 1) ELSE 0 END
        )
        ORDER BY m.count DESC
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT
        trim(unnest(string_to_array(o.material, ','))) AS name,
        COUNT(*)::int AS count
      FROM period_orders o
      WHERE o.material IS NOT NULL AND o.material != ''
      GROUP BY trim(unnest(string_to_array(o.material, ',')))
      ORDER BY count DESC
      LIMIT 10
    ) m,
    (SELECT COUNT(*)::int AS total FROM period_orders o WHERE o.material IS NOT NULL AND o.material != '') total_mat
  ),
  freq AS (
    SELECT
      CASE WHEN COUNT(*) > 0 AND p_date_from IS NOT NULL AND p_date_to IS NOT NULL THEN
        ROUND(COUNT(*)::numeric / GREATEST(EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 86400, 1), 2)
      ELSE 0 END AS per_day,
      CASE WHEN COUNT(*) > 0 AND p_date_from IS NOT NULL AND p_date_to IS NOT NULL THEN
        ROUND(COUNT(*)::numeric / GREATEST(EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 604800, 1), 2)
      ELSE 0 END AS per_week,
      CASE WHEN COUNT(*) > 0 AND p_date_from IS NOT NULL AND p_date_to IS NOT NULL THEN
        ROUND(COUNT(*)::numeric / GREATEST(EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 2592000, 1), 2)
      ELSE 0 END AS per_month
    FROM period_orders
  )
  SELECT jsonb_build_object(
    'top_clients', tc.top_clients,
    'materials', mt.materials,
    'order_frequency', jsonb_build_object(
      'per_day', f.per_day,
      'per_week', f.per_week,
      'per_month', f.per_month
    )
  )
  INTO v_result
  FROM freq f, top_clients tc, materials mt;

  IF v_result IS NULL THEN
    v_result := jsonb_build_object(
      'top_clients', '[]'::jsonb,
      'materials', '[]'::jsonb,
      'order_frequency', jsonb_build_object('per_day', 0, 'per_week', 0, 'per_month', 0)
    );
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_seller_profile(uuid, timestamptz, timestamptz) TO authenticated;
