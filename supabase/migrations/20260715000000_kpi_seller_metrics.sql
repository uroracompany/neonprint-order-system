CREATE OR REPLACE FUNCTION public.kpi_seller_metrics(
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
  v_total numeric;
  v_metric_label text;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  v_metric_label := CASE p_metric
    WHEN 'orders' THEN 'Órdenes Totales'
    WHEN 'clients' THEN 'Clientes Atendidos'
    WHEN 'registered_clients' THEN 'Clientes Registrados'
    WHEN 'internal' THEN 'Órdenes Internas'
    WHEN 'external' THEN 'Órdenes Externas'
    WHEN 'urgent' THEN 'Órdenes 911'
    WHEN 'normal' THEN 'Órdenes Normales'
    WHEN 'completed' THEN 'Órdenes Completadas'
    WHEN 'cancelled' THEN 'Órdenes Canceladas'
    WHEN 'pending' THEN 'Órdenes Pendientes'
    WHEN 'delivered' THEN 'Órdenes Entregadas'
    WHEN 'production_started' THEN 'Producción Iniciada'
    WHEN 'production_finished' THEN 'Producción Finalizada'
    ELSE 'Órdenes Totales'
  END;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'value', COALESCE(s.metric_value, 0),
      'rank', 0
    ) ORDER BY COALESCE(s.metric_value, 0) DESC
  ) INTO v_sellers
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT
      CASE p_metric
        WHEN 'orders' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'clients' THEN
          (SELECT COUNT(DISTINCT o.client_id)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND o.client_id IS NOT NULL
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'registered_clients' THEN
          (SELECT COUNT(*)::numeric FROM public.clients c
           WHERE c.created_by = p.id
             AND (p_date_from IS NULL OR c.created_at >= p_date_from)
             AND (p_date_to IS NULL OR c.created_at < p_date_to))
        WHEN 'internal' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND o.order_design_type = 'INTERNAL_DESING'
             AND lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'external' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND o.order_design_type = 'EXTERNAL_DESING'
             AND lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'urgent' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND o.order_type = 'orden 911'
             AND lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'normal' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND o.order_type = 'orden normal'
             AND lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'completed' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'cancelled' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND lower(coalesce(o.status, '')) = 'cancelled'
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'pending' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND lower(coalesce(o.status, '')) IN ('pending', 'in_design', 'in_quote')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'delivered' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND lower(coalesce(o.status, '')) = 'in_delivered'
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'production_started' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND lower(coalesce(o.status, '')) IN ('in_production', 'in_termination')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        WHEN 'production_finished' THEN
          (SELECT COUNT(*)::numeric FROM public.orders o
           WHERE COALESCE(o.seller_id, o.created_by) = p.id
             AND lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered')
             AND (p_date_from IS NULL OR o.created_at >= p_date_from)
             AND (p_date_to IS NULL OR o.created_at < p_date_to))
        ELSE 0
      END as metric_value
  ) s ON true
  WHERE p.role = 'seller';

  IF v_sellers IS NULL THEN
    v_sellers := '[]'::jsonb;
  END IF;

  SELECT COALESCE(SUM((elem->>'value')::numeric), 0) INTO v_total
  FROM jsonb_array_elements(v_sellers) elem;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', elem->>'id',
      'name', elem->>'name',
      'value', (elem->>'value')::numeric,
      'pct', CASE WHEN v_total > 0 THEN ROUND((elem->>'value')::numeric / v_total * 100, 1) ELSE 0 END,
      'rank', rank_num
    ) ORDER BY (elem->>'value')::numeric DESC
  ) INTO v_sellers
  FROM (
    SELECT elem, ROW_NUMBER() OVER (ORDER BY (elem->>'value')::numeric DESC) as rank_num
    FROM jsonb_array_elements(v_sellers) elem
  ) ranked;

  IF v_sellers IS NULL THEN
    v_sellers := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'metric', p_metric,
    'metric_label', v_metric_label,
    'total', v_total,
    'sellers', v_sellers
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_seller_metrics(text, timestamptz, timestamptz) TO authenticated;
