-- Enhanced KPI RPCs for Executive Summary
-- 1. SLA Violations detection
-- 2. Enhanced orders analytics with pending_payment_aged and return_count

-- 1. SLA Violations RPC
CREATE OR REPLACE FUNCTION public.kpi_sla_violations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_violations jsonb;
  v_summary jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  -- Get all orders that exceed SLA thresholds
  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'orders', COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'client_name', o.client_name,
      'status', o.status,
      'order_type', o.order_type,
      'hours_in_stage', ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/3600, 1),
      'warning_hours', wp.warning_after_hours,
      'critical_hours', wp.critical_after_hours,
      'severity', CASE 
        WHEN EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/3600 > wp.critical_after_hours THEN 'critical'
        ELSE 'warning'
      END
    ) ORDER BY EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at))) DESC), '[]'::jsonb)
  ) INTO v_violations
  FROM public.orders o
  JOIN public.order_workflow_policies wp ON wp.status = o.status AND wp.order_type = o.order_type
  WHERE o.status NOT IN ('cancelled', 'in_completed', 'in_delivered')
    AND o.operational_status != 'blocked'
    AND EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/3600 > wp.warning_after_hours;

  -- Summary by severity
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END), 0) + COALESCE(SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END), 0),
    'critical', COALESCE(SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END), 0),
    'warning', COALESCE(SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END), 0)
  ) INTO v_summary
  FROM (
    SELECT 
      CASE WHEN EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/3600 > wp.critical_after_hours THEN 'critical'
      ELSE 'warning'
      END as severity
    FROM public.orders o
    JOIN public.order_workflow_policies wp ON wp.status = o.status AND wp.order_type = o.order_type
    WHERE o.status NOT IN ('cancelled', 'in_completed', 'in_delivered')
      AND o.operational_status != 'blocked'
      AND EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/3600 > wp.warning_after_hours
  ) sub;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'violations', v_violations
  );
END;
$$;

-- 2. Enhanced orders analytics with pending_payment_aged and return_count
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
  v_status_breakdown jsonb;
  v_payment_status_breakdown jsonb;
  v_type_breakdown jsonb;
  v_daily_trend jsonb;
  v_production_metrics jsonb;
  v_delayed_orders jsonb;
  v_pending_payment_aged jsonb;
  v_return_count integer;
  v_cancellation_rate numeric;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  -- Status breakdown
  SELECT jsonb_object_agg(status, cnt) INTO v_status_breakdown
  FROM (
    SELECT lower(coalesce(status, 'unknown')) as status, COUNT(*) as cnt
    FROM public.orders
    WHERE (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to IS NULL OR created_at < p_date_to)
    GROUP BY lower(coalesce(status, 'unknown'))
  ) s;

  -- Payment status breakdown
  SELECT jsonb_object_agg(payment_status, cnt) INTO v_payment_status_breakdown
  FROM (
    SELECT lower(coalesce(payment_status, 'unknown')) as payment_status, COUNT(*) as cnt
    FROM public.orders
    WHERE (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to IS NULL OR created_at < p_date_to)
    GROUP BY lower(coalesce(payment_status, 'unknown'))
  ) ps;

  -- Type breakdown (normal vs 911)
  SELECT jsonb_build_object(
    'normal', COALESCE(COUNT(*) FILTER (WHERE order_type != 'orden 911'), 0),
    'urgent_911', COALESCE(COUNT(*) FILTER (WHERE order_type = 'orden 911'), 0)
  ) INTO v_type_breakdown
  FROM public.orders
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at < p_date_to);

  -- Daily trend (last 30 days)
  SELECT jsonb_agg(jsonb_build_object('date', day, 'orders', cnt) ORDER BY day) INTO v_daily_trend
  FROM (
    SELECT generate_series(
      date_trunc('day', CASE WHEN p_date_from IS NOT NULL AND p_date_from < p_date_to THEN p_date_from ELSE now() - interval '30 days' END)::date,
      date_trunc('day', COALESCE(p_date_to, now()))::date,
      interval '1 day'
    ) as day
  ) d
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM public.orders o
    WHERE date_trunc('day', o.created_at) = d.day
  ) o ON true;

  -- Production metrics
  SELECT jsonb_build_object(
    'avg_production_days', COALESCE(AVG(EXTRACT(EPOCH FROM (in_termination_at - started_at))/86400) FILTER (WHERE started_at IS NOT NULL AND in_termination_at IS NOT NULL), 0),
    'avg_total_days', COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))/86400) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL), 0)
  ) INTO v_production_metrics
  FROM public.order_production_files
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at < p_date_to);

  -- Delayed orders (stuck > 7 days in same status)
  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'orders', COALESCE(jsonb_agg(jsonb_build_object('id', id, 'client_name', client_name, 'status', status, 'days_stuck', days_stuck) ORDER BY days_stuck DESC) FILTER (WHERE days_stuck > 7), '[]'::jsonb)
  ) INTO v_delayed_orders
  FROM (
    SELECT o.id, o.client_name, o.status, 
      EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/86400 as days_stuck
    FROM public.orders o
    WHERE o.status NOT IN ('cancelled', 'in_completed', 'in_delivered')
      AND o.operational_status != 'blocked'
  ) d;

  -- Pending payment aged (> 3 days without payment confirmation)
  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'orders', COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 
      'client_name', o.client_name, 
      'days_pending', EXTRACT(EPOCH FROM (now() - o.created_at))/86400
    ) ORDER BY o.created_at ASC), '[]'::jsonb)
  ) INTO v_pending_payment_aged
  FROM public.orders o
  WHERE lower(coalesce(o.payment_status, '')) = 'pending_payment'
    AND EXTRACT(EPOCH FROM (now() - o.created_at))/86400 > 3
    AND o.status NOT IN ('cancelled', 'in_completed', 'in_delivered');

  -- Return count (orders returned from quote to design or from quote to pending)
  SELECT COALESCE(COUNT(*), 0) INTO v_return_count
  FROM public.order_events
  WHERE event_type = 'order_returned'
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at < p_date_to);

  -- Cancellation rate
  SELECT CASE WHEN COUNT(*) > 0 
    THEN ROUND(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) = 'cancelled')::numeric / COUNT(*) * 100, 1)
    ELSE 0 
  END INTO v_cancellation_rate
  FROM public.orders
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at < p_date_to);

  RETURN jsonb_build_object(
    'status_breakdown', v_status_breakdown,
    'payment_status_breakdown', v_payment_status_breakdown,
    'type_breakdown', v_type_breakdown,
    'daily_trend', v_daily_trend,
    'production_metrics', v_production_metrics,
    'delayed_orders', v_delayed_orders,
    'pending_payment_aged', v_pending_payment_aged,
    'return_count', v_return_count,
    'cancellation_rate', v_cancellation_rate
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.kpi_sla_violations() TO authenticated;
