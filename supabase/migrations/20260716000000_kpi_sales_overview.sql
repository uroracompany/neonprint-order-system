CREATE OR REPLACE FUNCTION public.kpi_sales_overview(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_compare_from timestamptz DEFAULT NULL,
  p_compare_to timestamptz DEFAULT NULL
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
    WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
  ),
  seller_stats AS (
    SELECT
      p.id,
      p.name,
      COUNT(*)::int AS total_orders,
      COUNT(*) FILTER (
        WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered')
      )::int AS completed_orders,
      COUNT(*) FILTER (
        WHERE lower(coalesce(o.status, '')) = 'cancelled'
      )::int AS cancelled_orders,
      COUNT(*) FILTER (
        WHERE lower(coalesce(o.status, '')) IN ('pending', 'in_design', 'in_quote')
      )::int AS pending_orders,
      COUNT(*) FILTER (
        WHERE lower(coalesce(o.status, '')) IN ('in_production', 'in_termination')
      )::int AS active_orders,
      COUNT(*) FILTER (
        WHERE lower(coalesce(o.status, '')) = 'in_delivered'
      )::int AS delivered_orders
    FROM public.profiles p
    LEFT JOIN period_orders o ON COALESCE(o.seller_id, o.created_by) = p.id
    WHERE p.role = 'seller'
    GROUP BY p.id, p.name
  ),
  agg AS (
    SELECT
      COALESCE(SUM(total_orders), 0) AS total,
      COALESCE(SUM(completed_orders), 0) AS completed,
      COALESCE(SUM(cancelled_orders), 0) AS cancelled,
      COALESCE(SUM(pending_orders), 0) AS pending,
      COALESCE(SUM(active_orders), 0) AS active_prod,
      COALESCE(SUM(delivered_orders), 0) AS delivered,
      COUNT(*) FILTER (WHERE total_orders > 0) AS active_sellers,
      COUNT(*) AS total_sellers
    FROM seller_stats
  ),
  avg_cycle AS (
    SELECT COALESCE(
      AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at)) / 86400),
      0
    ) AS avg_days
    FROM period_orders o
    WHERE o.status_changed_at IS NOT NULL
  ),
  cur AS (
    SELECT
      a.total AS total_orders,
      a.completed AS completed_orders,
      a.cancelled AS cancelled_orders,
      a.pending AS pending_orders,
      a.active_prod AS active_production,
      a.delivered AS delivered_orders,
      CASE WHEN a.total > 0 THEN ROUND(a.completed::numeric / a.total * 100, 1) ELSE 0 END AS completion_rate,
      CASE WHEN a.total > 0 THEN ROUND(a.cancelled::numeric / a.total * 100, 1) ELSE 0 END AS cancellation_rate,
      ROUND(ac.avg_days, 1) AS avg_cycle_days,
      a.total_sellers,
      a.active_sellers,
      GREATEST(a.total_sellers - a.active_sellers, 0) AS inactive_sellers
    FROM agg a, avg_cycle ac
  ),
  order_types AS (
    SELECT
      COUNT(*) FILTER (WHERE o.order_type = 'orden normal')::int AS normal,
      COUNT(*) FILTER (WHERE o.order_type = 'orden 911')::int AS urgent_911
    FROM period_orders o
  ),
  design_types AS (
    SELECT
      COUNT(*) FILTER (WHERE o.order_design_type = 'INTERNAL_DESING')::int AS internal,
      COUNT(*) FILTER (WHERE o.order_design_type = 'EXTERNAL_DESING')::int AS external
    FROM period_orders o
  ),
  status_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_design')::int AS in_design,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_quote')::int AS in_quote,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_production')::int AS in_production,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_termination')::int AS in_termination,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_completed')::int AS in_completed,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_delivered')::int AS in_delivered,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'cancelled')::int AS cancelled
    FROM period_orders o
  ),
  sellers_list AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ss.id,
        'name', ss.name,
        'orders_created', ss.total_orders,
        'completed_orders', ss.completed_orders,
        'cancelled_orders', ss.cancelled_orders,
        'pending_orders', ss.pending_orders,
        'active_orders', ss.active_orders,
        'delivered_orders', ss.delivered_orders,
        'completed_rate', CASE WHEN ss.total_orders > 0 THEN ROUND(ss.completed_orders::numeric / ss.total_orders * 100, 1) ELSE 0 END,
        'pct_of_total', CASE WHEN (SELECT total_orders FROM cur) > 0 THEN ROUND(ss.total_orders::numeric / (SELECT total_orders FROM cur) * 100, 1) ELSE 0 END
      )
      ORDER BY ss.total_orders DESC
    ) AS list
    FROM seller_stats ss
    WHERE ss.total_orders > 0
  ),
  alerts_list AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'type', sub.alert_type,
        'seller', sub.name,
        'value', sub.val
      )
    ) AS list
    FROM (
      SELECT
        CASE
          WHEN ss.total_orders >= 3 AND (ss.completed_orders::numeric / ss.total_orders * 100) < 60 THEN 'low_completion'
          WHEN ss.total_orders >= 3 AND (ss.cancelled_orders::numeric / ss.total_orders * 100) > 15 THEN 'high_cancellation'
        END AS alert_type,
        ss.name,
        CASE
          WHEN ss.total_orders >= 3 AND (ss.completed_orders::numeric / ss.total_orders * 100) < 60 THEN ROUND(ss.completed_orders::numeric / ss.total_orders * 100, 1)
          WHEN ss.total_orders >= 3 AND (ss.cancelled_orders::numeric / ss.total_orders * 100) > 15 THEN ROUND(ss.cancelled_orders::numeric / ss.total_orders * 100, 1)
        END AS val
      FROM seller_stats ss
      WHERE ss.total_orders >= 3
    ) sub
    WHERE sub.alert_type IS NOT NULL
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'total_orders', c.total_orders,
      'completed_orders', c.completed_orders,
      'cancelled_orders', c.cancelled_orders,
      'pending_orders', c.pending_orders,
      'active_production', c.active_production,
      'delivered_orders', c.delivered_orders,
      'completion_rate', c.completion_rate,
      'cancellation_rate', c.cancellation_rate,
      'avg_cycle_days', c.avg_cycle_days,
      'total_sellers', c.total_sellers,
      'active_sellers', c.active_sellers,
      'inactive_sellers', c.inactive_sellers
    ),
    'order_types', jsonb_build_object('normal', ot.normal, 'urgent_911', ot.urgent_911),
    'design_types', jsonb_build_object('internal', dt.internal, 'external', dt.external),
    'status_breakdown', jsonb_build_object(
      'pending', sc.pending, 'in_design', sc.in_design, 'in_quote', sc.in_quote,
      'in_production', sc.in_production, 'in_termination', sc.in_termination,
      'in_completed', sc.in_completed, 'in_delivered', sc.in_delivered, 'cancelled', sc.cancelled
    ),
    'sellers', COALESCE(sl.list, '[]'::jsonb),
    'alerts', COALESCE(al.list, '[]'::jsonb)
  ) INTO v_result
  FROM cur c, order_types ot, design_types dt, status_counts sc, sellers_list sl, alerts_list al;

  IF p_compare_from IS NOT NULL AND p_compare_to IS NOT NULL THEN
    WITH prev_orders AS (
      SELECT o.*
      FROM public.orders o
      WHERE o.created_at >= p_compare_from AND o.created_at < p_compare_to
    ),
    prev_agg AS (
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered'))::int AS completed
      FROM prev_orders o
    ),
    prev_cycle AS (
      SELECT COALESCE(
        AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at)) / 86400),
        0
      ) AS avg_days
      FROM prev_orders o
      WHERE o.status_changed_at IS NOT NULL
    ),
    cur_vals AS (
      SELECT
        (v_result->'summary'->>'total_orders')::int AS total,
        (v_result->'summary'->>'completion_rate')::numeric AS comp_rate,
        (v_result->'summary'->>'avg_cycle_days')::numeric AS cycle
    )
    SELECT v_result || jsonb_build_object('comparison', jsonb_build_object(
      'prev_total_orders', pa.total,
      'prev_completed_rate', CASE WHEN pa.total > 0 THEN ROUND(pa.completed::numeric / pa.total * 100, 1) ELSE 0 END,
      'prev_avg_cycle_days', ROUND(pc.avg_days, 1),
      'orders_change_pct', CASE WHEN pa.total > 0 THEN ROUND(((cv.total - pa.total)::numeric / pa.total * 100), 1) ELSE 0 END,
      'completion_change_pct', ROUND(cv.comp_rate - CASE WHEN pa.total > 0 THEN ROUND(pa.completed::numeric / pa.total * 100, 1) ELSE 0 END, 1),
      'cycle_change_pct', CASE WHEN pc.avg_days > 0 THEN ROUND(((cv.cycle - pc.avg_days) / pc.avg_days * 100), 1) ELSE 0 END
    ))
    INTO v_result
    FROM prev_agg pa, prev_cycle pc, cur_vals cv;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_sales_overview(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;


CREATE OR REPLACE FUNCTION public.kpi_seller_detail(
  p_seller_id uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_compare_from timestamptz DEFAULT NULL,
  p_compare_to timestamptz DEFAULT NULL
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

  WITH seller_info AS (
    SELECT jsonb_build_object('id', p.id, 'name', p.name) AS info
    FROM public.profiles p
    WHERE p.id = p_seller_id
  ),
  period_orders AS (
    SELECT o.*
    FROM public.orders o
    WHERE COALESCE(o.seller_id, o.created_by) = p_seller_id
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
  ),
  orders_agg AS (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'normal', COUNT(*) FILTER (WHERE o.order_type = 'orden normal'),
      'urgent_911', COUNT(*) FILTER (WHERE o.order_type = 'orden 911'),
      'internal', COUNT(*) FILTER (WHERE o.order_design_type = 'INTERNAL_DESING'),
      'external', COUNT(*) FILTER (WHERE o.order_design_type = 'EXTERNAL_DESING'),
      'completed', COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered')),
      'cancelled', COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'cancelled'),
      'pending', COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('pending', 'in_design', 'in_quote')),
      'delivered', COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) = 'in_delivered'),
      'in_production', COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_production', 'in_termination'))
    ) AS obj
    FROM period_orders o
  ),
  cycle AS (
    SELECT COALESCE(
      AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at)) / 86400),
      0
    ) AS avg_days
    FROM period_orders o
    WHERE o.status_changed_at IS NOT NULL
  ),
  rates_calc AS (
    SELECT jsonb_build_object(
      'completion_rate', CASE WHEN (oa.obj->>'total')::int > 0
        THEN ROUND((oa.obj->>'completed')::numeric / (oa.obj->>'total')::int * 100, 1) ELSE 0 END,
      'cancellation_rate', CASE WHEN (oa.obj->>'total')::int > 0
        THEN ROUND((oa.obj->>'cancelled')::numeric / (oa.obj->>'total')::int * 100, 1) ELSE 0 END,
      'avg_cycle_days', ROUND(c.avg_days, 1)
    ) AS obj
    FROM orders_agg oa, cycle c
  ),
  dept_avg AS (
    SELECT
      COALESCE(AVG(s.cnt), 0) AS avg_orders,
      COALESCE(AVG(s.comp_rate), 0) AS avg_comp_rate
    FROM (
      SELECT
        COALESCE(o.seller_id, o.created_by) AS seller_id,
        COUNT(*) AS cnt,
        CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered'))::numeric / COUNT(*) * 100 ELSE 0 END AS comp_rate
      FROM public.orders o
      WHERE COALESCE(o.seller_id, o.created_by) IN (SELECT id FROM public.profiles WHERE role = 'seller')
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at < p_date_to)
      GROUP BY COALESCE(o.seller_id, o.created_by)
    ) s
  ),
  vs_dept_calc AS (
    SELECT jsonb_build_object(
      'orders_vs_avg', CASE WHEN da.avg_orders > 0
        THEN ROUND(((oa.obj->>'total')::int / da.avg_orders - 1) * 100, 1) ELSE 0 END,
      'completion_vs_avg', ROUND((rc.obj->>'completion_rate')::numeric - da.avg_comp_rate, 1)
    ) AS obj
    FROM orders_agg oa, rates_calc rc, dept_avg da
  )
  SELECT si.info || jsonb_build_object(
    'orders', oa.obj,
    'rates', rc.obj,
    'vs_department', vd.obj
  )
  INTO v_result
  FROM seller_info si, orders_agg oa, rates_calc rc, vs_dept_calc vd;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Vendedor no encontrado');
  END IF;

  IF p_compare_from IS NOT NULL AND p_compare_to IS NOT NULL THEN
    WITH prev_orders AS (
      SELECT o.*
      FROM public.orders o
      WHERE COALESCE(o.seller_id, o.created_by) = p_seller_id
        AND o.created_at >= p_compare_from
        AND o.created_at < p_compare_to
    ),
    prev_agg AS (
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered'))::int AS completed
      FROM prev_orders o
    ),
    prev_cycle AS (
      SELECT COALESCE(
        AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at)) / 86400),
        0
      ) AS avg_days
      FROM prev_orders o
      WHERE o.status_changed_at IS NOT NULL
    )
    SELECT v_result || jsonb_build_object('comparison', jsonb_build_object(
      'prev_orders', pa.total,
      'prev_completion_rate', CASE WHEN pa.total > 0 THEN ROUND(pa.completed::numeric / pa.total * 100, 1) ELSE 0 END,
      'prev_avg_cycle_days', ROUND(pc.avg_days, 1),
      'orders_change_pct', CASE WHEN pa.total > 0 THEN ROUND(((v_result->'orders'->>'total')::int - pa.total)::numeric / pa.total * 100, 1) ELSE 0 END,
      'completion_change_pct', ROUND(
        (v_result->'rates'->>'completion_rate')::numeric -
        (CASE WHEN pa.total > 0 THEN ROUND(pa.completed::numeric / pa.total * 100, 1) ELSE 0 END), 1
      ),
      'cycle_change_pct', CASE WHEN pc.avg_days > 0
        THEN ROUND(((v_result->'rates'->>'avg_cycle_days')::numeric - pc.avg_days) / pc.avg_days * 100, 1) ELSE 0 END
    ))
    INTO v_result
    FROM prev_agg pa, prev_cycle pc;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_seller_detail(uuid, timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
