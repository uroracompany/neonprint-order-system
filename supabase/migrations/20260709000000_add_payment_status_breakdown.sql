-- Add payment_status_breakdown to kpi_orders_analytics
-- This provides the payment status distribution for the Executive Summary

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

  RETURN jsonb_build_object(
    'status_breakdown', v_status_breakdown,
    'payment_status_breakdown', v_payment_status_breakdown,
    'type_breakdown', v_type_breakdown,
    'daily_trend', v_daily_trend,
    'production_metrics', v_production_metrics,
    'delayed_orders', v_delayed_orders
  );
END;
$$;
