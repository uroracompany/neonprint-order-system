-- Verified executive KPI contract. Snapshot metrics are current-state values;
-- performance metrics use auditable events within the requested period.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

UPDATE public.orders o
SET delivered_at = source.delivered_at
FROM (
  SELECT order_id, MIN(created_at) AS delivered_at
  FROM public.order_events
  WHERE new_status = 'in_Delivered'
    AND COALESCE(old_status, '') <> 'in_Delivered'
  GROUP BY order_id
) source
WHERE o.id = source.order_id
  AND o.delivered_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_order_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'in_Delivered' AND COALESCE(OLD.status, '') <> 'in_Delivered' THEN
      NEW.delivered_at := COALESCE(NEW.delivered_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON public.orders(delivered_at)
  WHERE delivered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_events_kpi_status_created
  ON public.order_events(new_status, created_at, order_id)
  WHERE new_status IS NOT NULL;

CREATE OR REPLACE FUNCTION public.kpi_executive_summary(
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
  v_pipeline jsonb;
  v_period jsonb;
  v_comparison jsonb;
  v_trends jsonb;
  v_coverage jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  WITH current_orders AS (
    SELECT *
    FROM public.orders
    WHERE lower(coalesce(status, '')) IN ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination')
      AND coalesce(is_archived, false) = false
  ), area_rows AS (
    SELECT
      coalesce(opf.production_area_code, 'sin_area') AS area_code,
      lower(opf.status) AS status,
      count(*) AS count
    FROM public.order_production_files opf
    JOIN public.orders o ON o.id = opf.order_id
    WHERE lower(opf.status) IN ('pending', 'in_production', 'in_termination')
      AND lower(coalesce(o.status, '')) IN ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination')
      AND coalesce(o.is_archived, false) = false
    GROUP BY 1, 2
  ), area_stats AS (
    SELECT area_code, jsonb_object_agg(status, count) AS status_counts
    FROM area_rows GROUP BY area_code
  )
  SELECT jsonb_build_object(
    'active_orders', (SELECT count(*) FROM current_orders),
    'blocked_orders', (SELECT count(*) FROM current_orders WHERE operational_status = 'blocked'),
    'urgent_911_orders', (SELECT count(*) FROM current_orders WHERE order_type = 'orden 911'),
    'stalled_orders', (SELECT count(*) FROM current_orders WHERE operational_status <> 'blocked' AND now() - status_changed_at > interval '7 days'),
    'employees_active', (SELECT count(*) FROM public.profiles WHERE role <> 'admin' AND employment_status = true),
    'clients_registered', (SELECT count(*) FROM public.clients),
    'payments', jsonb_build_object(
      'credit_orders', (SELECT count(*) FROM public.orders WHERE payment_status = 'credito' AND lower(coalesce(status, '')) <> 'cancelled'),
      'partial_orders', (SELECT count(*) FROM public.orders WHERE payment_status = 'parcial' AND lower(coalesce(status, '')) <> 'cancelled'),
      'pending_orders', (SELECT count(*) FROM public.orders WHERE lower(coalesce(payment_status, '')) IN ('pending_payment', 'pendiente') AND lower(coalesce(status, '')) <> 'cancelled'),
      'pending_over_3_days', (SELECT count(*) FROM public.orders WHERE lower(coalesce(payment_status, '')) IN ('pending_payment', 'pendiente') AND lower(coalesce(status, '')) <> 'cancelled' AND created_at < now() - interval '3 days')
    ),
    'production', jsonb_build_object(
      'area_load', coalesce((SELECT jsonb_object_agg(area_code, status_counts) FROM area_stats), '{}'::jsonb),
      'bottleneck_count', (SELECT count(*) FROM public.order_production_files opf JOIN public.orders o ON o.id = opf.order_id WHERE lower(opf.status) IN ('pending', 'in_production', 'in_termination') AND lower(coalesce(o.status, '')) IN ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination') AND coalesce(o.is_archived, false) = false AND now() - coalesce(opf.in_termination_at, opf.started_at, opf.created_at) > interval '3 days')
    )
  ) INTO v_snapshot;

  WITH current_orders AS (
    SELECT * FROM public.orders
    WHERE lower(coalesce(status, '')) IN ('pending', 'in_design', 'in_quote', 'in_production', 'in_termination')
      AND coalesce(is_archived, false) = false
  ), rows AS (
    SELECT lower(status) AS status, coalesce(order_design_type, 'UNKNOWN') AS design_type, coalesce(order_type, 'orden normal') AS order_type, count(*) AS count
    FROM current_orders GROUP BY 1, 2, 3
  ), by_design AS (
    SELECT design_type, jsonb_object_agg(status, count) AS value FROM (SELECT design_type, status, sum(count) AS count FROM rows GROUP BY 1,2) q GROUP BY design_type
  ), by_type AS (
    SELECT order_type, jsonb_object_agg(status, count) AS value FROM (SELECT order_type, status, sum(count) AS count FROM rows GROUP BY 1,2) q GROUP BY order_type
  ), by_both AS (
    SELECT design_type || '|' || order_type AS key, jsonb_object_agg(status, count) AS value FROM rows GROUP BY design_type, order_type
  )
  SELECT jsonb_build_object(
    'status_breakdown', coalesce((SELECT jsonb_object_agg(status, count) FROM (SELECT status, sum(count) AS count FROM rows GROUP BY status) q), '{}'::jsonb),
    'by_design_type', coalesce((SELECT jsonb_object_agg(design_type, value) FROM by_design), '{}'::jsonb),
    'by_order_type', coalesce((SELECT jsonb_object_agg(order_type, value) FROM by_type), '{}'::jsonb),
    'by_both', coalesce((SELECT jsonb_object_agg(key, value) FROM by_both), '{}'::jsonb)
  ) INTO v_pipeline;

  WITH delivery_events AS (
    SELECT DISTINCT ON (order_id) order_id, created_at AS delivered_at
    FROM public.order_events
    WHERE new_status = 'in_Delivered' AND coalesce(old_status, '') <> 'in_Delivered'
    ORDER BY order_id, created_at
  ), period_deliveries AS (
    SELECT d.order_id, d.delivered_at, o.created_at
    FROM delivery_events d JOIN public.orders o ON o.id = d.order_id
    WHERE d.delivered_at >= p_date_from AND d.delivered_at < p_date_to
  ), period_cancelled AS (
    SELECT DISTINCT order_id FROM public.order_events
    WHERE new_status = 'cancelled' AND coalesce(old_status, '') <> 'cancelled'
      AND created_at >= p_date_from AND created_at < p_date_to
  ), period_returns AS (
    SELECT DISTINCT order_id FROM public.order_events
    WHERE event_type = 'order_returned' AND created_at >= p_date_from AND created_at < p_date_to
  ), period_created AS (
    SELECT * FROM public.orders WHERE created_at >= p_date_from AND created_at < p_date_to
  ), ranked_sellers AS (
    SELECT p.name, count(*) AS total FROM period_created o JOIN public.profiles p ON p.id = o.created_by WHERE p.role = 'seller' GROUP BY p.id, p.name ORDER BY total DESC, p.name LIMIT 1
  ), ranked_clients AS (
    SELECT c.name, count(*) AS total FROM period_created o JOIN public.clients c ON c.id = o.client_id GROUP BY c.id, c.name ORDER BY total DESC, c.name LIMIT 1
  ), ranked_designers AS (
    SELECT p.name, count(*) AS total
    FROM public.order_events e JOIN public.profiles p ON p.id = nullif(e.changes #>> '{new,designer_id}', '')::uuid
    WHERE e.new_status = 'in_Design' AND coalesce(e.old_status, '') <> 'in_Design' AND e.created_at >= p_date_from AND e.created_at < p_date_to AND p.role = 'designer'
    GROUP BY p.id, p.name ORDER BY total DESC, p.name LIMIT 1
  ), retention AS (
    SELECT count(DISTINCT curr.client_id) AS retained, count(DISTINCT prev.client_id) AS previous_clients
    FROM public.orders prev LEFT JOIN public.orders curr ON curr.client_id = prev.client_id AND curr.created_at >= p_date_from AND curr.created_at < p_date_to
    WHERE prev.client_id IS NOT NULL AND prev.created_at >= p_compare_from AND prev.created_at < p_compare_to
  ), stage_events AS (
    SELECT
      order_id,
      min(created_at) FILTER (WHERE new_status = 'in_Design' AND coalesce(old_status, '') <> 'in_Design') AS design_at,
      min(created_at) FILTER (WHERE new_status = 'in_Quote' AND coalesce(old_status, '') <> 'in_Quote') AS quote_at,
      min(created_at) FILTER (WHERE new_status = 'in_Production' AND coalesce(old_status, '') <> 'in_Production') AS production_at,
      min(created_at) FILTER (WHERE new_status = 'in_Termination' AND coalesce(old_status, '') <> 'in_Termination') AS termination_at,
      min(created_at) FILTER (WHERE new_status = 'in_Completed' AND coalesce(old_status, '') <> 'in_Completed') AS completed_at
    FROM public.order_events
    GROUP BY order_id
  ), stage_timing AS (
    SELECT jsonb_build_object(
      'design_to_quote', round(avg(extract(epoch FROM (quote_at - design_at)) / 86400) FILTER (WHERE quote_at >= p_date_from AND quote_at < p_date_to AND quote_at >= design_at), 1),
      'quote_to_production', round(avg(extract(epoch FROM (production_at - quote_at)) / 86400) FILTER (WHERE production_at >= p_date_from AND production_at < p_date_to AND production_at >= quote_at), 1),
      'production_to_termination', round(avg(extract(epoch FROM (termination_at - production_at)) / 86400) FILTER (WHERE termination_at >= p_date_from AND termination_at < p_date_to AND termination_at >= production_at), 1),
      'termination_to_completion', round(avg(extract(epoch FROM (completed_at - termination_at)) / 86400) FILTER (WHERE completed_at >= p_date_from AND completed_at < p_date_to AND completed_at >= termination_at), 1)
    ) AS value
    FROM stage_events
  )
  SELECT jsonb_build_object(
    'orders_created', (SELECT count(*) FROM period_created),
    'orders_delivered', (SELECT count(*) FROM period_deliveries),
    'orders_cancelled', (SELECT count(*) FROM period_cancelled),
    'return_count', (SELECT count(*) FROM period_returns),
    'cancellation_rate', CASE WHEN (SELECT count(*) FROM period_created) > 0 THEN round((SELECT count(*) FROM period_cancelled)::numeric / (SELECT count(*) FROM period_created) * 100, 1) ELSE NULL END,
    'avg_delivery_cycle_days', (SELECT round(avg(extract(epoch FROM (delivered_at - created_at)) / 86400)::numeric, 1) FROM period_deliveries WHERE delivered_at >= created_at),
    'retention_rate', (SELECT CASE WHEN previous_clients > 0 THEN round(retained::numeric / previous_clients * 100, 1) ELSE NULL END FROM retention),
    'production_stage_timing', (SELECT value FROM stage_timing),
    'rankings', jsonb_build_object(
      'top_seller', (SELECT jsonb_build_object('name', name, 'total', total) FROM ranked_sellers),
      'top_client', (SELECT jsonb_build_object('name', name, 'total', total) FROM ranked_clients),
      'top_designer', (SELECT jsonb_build_object('name', name, 'total', total) FROM ranked_designers)
    )
  ) INTO v_period;

  WITH delivery_events AS (
    SELECT DISTINCT ON (order_id) order_id, created_at AS delivered_at
    FROM public.order_events WHERE new_status = 'in_Delivered' AND coalesce(old_status, '') <> 'in_Delivered' ORDER BY order_id, created_at
  ), comparison_deliveries AS (
    SELECT d.order_id, d.delivered_at, o.created_at FROM delivery_events d JOIN public.orders o ON o.id = d.order_id WHERE d.delivered_at >= p_compare_from AND d.delivered_at < p_compare_to
  )
  SELECT jsonb_build_object(
    'orders_created', (SELECT count(*) FROM public.orders WHERE created_at >= p_compare_from AND created_at < p_compare_to),
    'orders_delivered', (SELECT count(*) FROM comparison_deliveries),
    'orders_cancelled', (SELECT count(DISTINCT order_id) FROM public.order_events WHERE new_status = 'cancelled' AND coalesce(old_status, '') <> 'cancelled' AND created_at >= p_compare_from AND created_at < p_compare_to),
    'return_count', (SELECT count(DISTINCT order_id) FROM public.order_events WHERE event_type = 'order_returned' AND created_at >= p_compare_from AND created_at < p_compare_to),
    'avg_delivery_cycle_days', (SELECT round(avg(extract(epoch FROM (delivered_at - created_at)) / 86400)::numeric, 1) FROM comparison_deliveries WHERE delivered_at >= created_at)
  ) INTO v_comparison;

  WITH days AS (SELECT generate_series(date_trunc('day', p_date_from), date_trunc('day', p_date_to - interval '1 day'), interval '1 day')::date AS day), delivery_counts AS (
    SELECT created_at::date AS day, count(DISTINCT order_id) AS count FROM public.order_events WHERE new_status = 'in_Delivered' AND coalesce(old_status, '') <> 'in_Delivered' AND created_at >= p_date_from AND created_at < p_date_to GROUP BY 1
  ), created_counts AS (
    SELECT created_at::date AS day, count(*) AS count FROM public.orders WHERE created_at >= p_date_from AND created_at < p_date_to GROUP BY 1
  )
  SELECT jsonb_build_object(
    'created', coalesce((SELECT jsonb_agg(jsonb_build_object('date', d.day, 'orders', coalesce(c.count, 0)) ORDER BY d.day) FROM days d LEFT JOIN created_counts c ON c.day = d.day), '[]'::jsonb),
    'delivered', coalesce((SELECT jsonb_agg(jsonb_build_object('date', d.day, 'orders', coalesce(c.count, 0)) ORDER BY d.day) FROM days d LEFT JOIN delivery_counts c ON c.day = d.day), '[]'::jsonb)
  ) INTO v_trends;

  SELECT jsonb_build_object(
    'delivery_cycle_orders', (SELECT count(*) FROM public.order_events WHERE new_status = 'in_Delivered' AND coalesce(old_status, '') <> 'in_Delivered' AND created_at >= p_date_from AND created_at < p_date_to),
    'delivery_cycle_available', (SELECT count(*) FROM public.order_events e JOIN public.orders o ON o.id = e.order_id WHERE e.new_status = 'in_Delivered' AND coalesce(e.old_status, '') <> 'in_Delivered' AND e.created_at >= p_date_from AND e.created_at < p_date_to AND e.created_at >= o.created_at)
  ) INTO v_coverage;

  RETURN jsonb_build_object(
    'snapshot', v_snapshot,
    'pipeline', v_pipeline,
    'period', v_period,
    'comparison', v_comparison,
    'trends', v_trends,
    'coverage', v_coverage,
    'meta', jsonb_build_object('generated_at', now(), 'timezone', current_setting('TimeZone'), 'date_from', p_date_from, 'date_to', p_date_to, 'compare_from', p_compare_from, 'compare_to', p_compare_to)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_executive_summary(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;

-- Keep the detailed order analytics contract additive. Previous migrations
-- replaced this function and accidentally removed fields consumed by KPI views.
CREATE OR REPLACE FUNCTION public.kpi_orders_analytics(
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
  v_status jsonb;
  v_payment jsonb;
  v_type jsonb;
  v_daily jsonb;
  v_production jsonb;
  v_delayed jsonb;
  v_pending_aged jsonb;
  v_by_design jsonb;
  v_by_type jsonb;
  v_by_both jsonb;
  v_returns integer;
  v_cancellation numeric;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  SELECT jsonb_object_agg(status, count) INTO v_status
  FROM (SELECT lower(coalesce(status, 'unknown')) AS status, count(*) AS count FROM public.orders WHERE (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to) GROUP BY 1) q;
  SELECT jsonb_object_agg(payment_status, count) INTO v_payment
  FROM (SELECT lower(coalesce(payment_status, 'unknown')) AS payment_status, count(*) AS count FROM public.orders WHERE (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to) GROUP BY 1) q;
  SELECT jsonb_build_object('normal', count(*) FILTER (WHERE order_type <> 'orden 911'), 'urgent_911', count(*) FILTER (WHERE order_type = 'orden 911')) INTO v_type
  FROM public.orders WHERE (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to);

  WITH rows AS (
    SELECT lower(coalesce(status, 'unknown')) AS status, coalesce(order_design_type, 'UNKNOWN') AS design_type, coalesce(order_type, 'orden normal') AS order_type, count(*) AS count
    FROM public.orders WHERE (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to) GROUP BY 1,2,3
  )
  SELECT
    coalesce((SELECT jsonb_object_agg(design_type, value) FROM (SELECT design_type, jsonb_object_agg(status, count) AS value FROM (SELECT design_type, status, sum(count) AS count FROM rows GROUP BY 1,2) z GROUP BY design_type) d), '{}'::jsonb),
    coalesce((SELECT jsonb_object_agg(order_type, value) FROM (SELECT order_type, jsonb_object_agg(status, count) AS value FROM (SELECT order_type, status, sum(count) AS count FROM rows GROUP BY 1,2) z GROUP BY order_type) t), '{}'::jsonb),
    coalesce((SELECT jsonb_object_agg(design_type || '|' || order_type, value) FROM (SELECT design_type, order_type, jsonb_object_agg(status, count) AS value FROM rows GROUP BY 1,2) b), '{}'::jsonb)
  INTO v_by_design, v_by_type, v_by_both;

  WITH days AS (SELECT generate_series(date_trunc('day', coalesce(p_date_from, now() - interval '30 days')), date_trunc('day', coalesce(p_date_to, now())), interval '1 day')::date AS day)
  SELECT jsonb_agg(jsonb_build_object('date', day, 'orders', count) ORDER BY day) INTO v_daily
  FROM (SELECT d.day, count(o.id) AS count FROM days d LEFT JOIN public.orders o ON o.created_at::date = d.day GROUP BY d.day) q;

  SELECT jsonb_build_object(
    'avg_production_days', coalesce(avg(extract(epoch FROM (in_termination_at - started_at)) / 86400) FILTER (WHERE started_at IS NOT NULL AND in_termination_at IS NOT NULL), 0),
    'avg_total_days', coalesce(avg(extract(epoch FROM (completed_at - started_at)) / 86400) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL), 0)
  ) INTO v_production
  FROM public.order_production_files WHERE (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to);

  SELECT jsonb_build_object('count', count(*), 'orders', coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_name', client_name, 'status', status, 'days_stuck', days_stuck) ORDER BY days_stuck DESC), '[]'::jsonb)) INTO v_delayed
  FROM (SELECT id, client_name, status, extract(epoch FROM (now() - coalesce(status_changed_at, created_at))) / 86400 AS days_stuck FROM public.orders WHERE lower(coalesce(status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered') AND operational_status <> 'blocked' AND now() - coalesce(status_changed_at, created_at) > interval '7 days') q;

  SELECT jsonb_build_object('count', count(*), 'orders', coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_name', client_name, 'days_pending', extract(epoch FROM (now() - created_at)) / 86400) ORDER BY created_at), '[]'::jsonb)) INTO v_pending_aged
  FROM public.orders WHERE lower(coalesce(payment_status, '')) IN ('pending_payment', 'pendiente') AND lower(coalesce(status, '')) <> 'cancelled' AND created_at < now() - interval '3 days';

  SELECT count(*) INTO v_returns FROM public.order_events WHERE event_type = 'order_returned' AND (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to);
  SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE lower(coalesce(status, '')) = 'cancelled')::numeric / count(*) * 100, 1) ELSE 0 END INTO v_cancellation FROM public.orders WHERE (p_date_from IS NULL OR created_at >= p_date_from) AND (p_date_to IS NULL OR created_at < p_date_to);

  RETURN jsonb_build_object(
    'status_breakdown', coalesce(v_status, '{}'::jsonb), 'payment_status_breakdown', coalesce(v_payment, '{}'::jsonb), 'type_breakdown', coalesce(v_type, '{}'::jsonb),
    'daily_trend', coalesce(v_daily, '[]'::jsonb), 'production_metrics', v_production, 'delayed_orders', v_delayed, 'pending_payment_aged', v_pending_aged,
    'return_count', v_returns, 'cancellation_rate', v_cancellation, 'status_by_design_type', v_by_design, 'status_by_order_type', v_by_type, 'status_by_both', v_by_both
  );
END;
$$;
