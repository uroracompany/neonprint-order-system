CREATE OR REPLACE FUNCTION public.kpi_seller_daily_trend(
  p_metric text DEFAULT 'orders',
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
  v_sellers jsonb;
  v_metric_label text;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  v_metric_label := CASE p_metric
    WHEN 'orders' THEN 'Órdenes Totales'
    WHEN 'urgent' THEN 'Órdenes 911'
    WHEN 'normal' THEN 'Órdenes Normales'
    WHEN 'cancelled' THEN 'Cancelaciones'
    WHEN 'internal' THEN 'Órdenes Internas'
    WHEN 'external' THEN 'Órdenes Externas'
    WHEN 'completed' THEN 'Órdenes Completadas'
    WHEN 'pending' THEN 'Órdenes Pendientes'
    WHEN 'delivered' THEN 'Órdenes Entregadas'
    WHEN 'clients' THEN 'Clientes Atendidos'
    ELSE 'Órdenes Totales'
  END;

  WITH seller_daily AS (
    SELECT
      date_trunc('day', o.created_at)::date AS day,
      COALESCE(o.seller_id, o.created_by) AS seller_id,
      p.name AS seller_name,
      COUNT(*)::int AS value
    FROM public.orders o
    JOIN public.profiles p ON p.id = COALESCE(o.seller_id, o.created_by)
    WHERE p.role = 'seller'
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
      AND (
        CASE p_metric
          WHEN 'orders' THEN true
          WHEN 'urgent' THEN o.order_type = 'orden 911'
          WHEN 'normal' THEN o.order_type = 'orden normal'
          WHEN 'cancelled' THEN lower(coalesce(o.status, '')) = 'cancelled'
          WHEN 'internal' THEN o.order_design_type = 'INTERNAL_DESING'
            AND lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
          WHEN 'external' THEN o.order_design_type = 'EXTERNAL_DESING'
            AND lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
          WHEN 'completed' THEN lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered')
          WHEN 'pending' THEN lower(coalesce(o.status, '')) IN ('pending', 'in_design', 'in_quote')
          WHEN 'delivered' THEN lower(coalesce(o.status, '')) = 'in_delivered'
          WHEN 'clients' THEN o.client_id IS NOT NULL
          ELSE true
        END
      )
    GROUP BY day, COALESCE(o.seller_id, o.created_by), p.name
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', day,
      'seller_id', seller_id,
      'seller_name', seller_name,
      'value', value
    ) ORDER BY day, value DESC
  )
  INTO v_sellers
  FROM seller_daily;

  IF v_sellers IS NULL THEN
    v_sellers := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'metric', p_metric,
    'metric_label', v_metric_label,
    'trend', v_sellers
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_seller_daily_trend(text, timestamptz, timestamptz) TO authenticated;
