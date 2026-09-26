-- Reversión solicitada: restaura el contrato previo de KPI Clientes.
-- No modifica datos; sólo reemplaza la función analítica.

CREATE OR REPLACE FUNCTION public.kpi_client_analytics(
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
  v_new_clients jsonb;
  v_recurring_clients jsonb;
  v_top_clients jsonb;
  v_inactive_clients jsonb;
  v_retention_rate jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'clients', COALESCE((
      SELECT jsonb_agg(item)
      FROM (
        SELECT jsonb_build_object('id', c.id, 'name', c.name, 'created_at', c.created_at) AS item
        FROM public.clients c
        WHERE (p_date_from IS NULL OR c.created_at >= p_date_from)
          AND (p_date_to IS NULL OR c.created_at < p_date_to)
        ORDER BY c.created_at DESC
        LIMIT 10
      ) recent_clients
    ), '[]'::jsonb)
  ) INTO v_new_clients
  FROM public.clients c
  WHERE (p_date_from IS NULL OR c.created_at >= p_date_from)
    AND (p_date_to IS NULL OR c.created_at < p_date_to);

  SELECT jsonb_build_object('count', COALESCE(COUNT(*), 0)) INTO v_recurring_clients
  FROM (
    SELECT DISTINCT o.client_id
    FROM public.orders o
    WHERE o.client_id IS NOT NULL
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
      AND EXISTS (
        SELECT 1
        FROM public.orders previous_order
        WHERE previous_order.client_id = o.client_id
          AND (p_compare_from IS NULL OR previous_order.created_at >= p_compare_from)
          AND (p_compare_to IS NULL OR previous_order.created_at < p_compare_to)
      )
  ) recurring;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'total_orders', stats.total_orders,
    'active_orders', stats.active_orders,
    'completed_orders', stats.completed_orders,
    'last_order_at', stats.last_order_at
  ) ORDER BY stats.total_orders DESC, c.name), '[]'::jsonb) INTO v_top_clients
  FROM (
    SELECT
      o.client_id,
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE lower(COALESCE(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')) AS active_orders,
      COUNT(*) FILTER (WHERE lower(COALESCE(o.status, '')) IN ('in_completed', 'in_delivered')) AS completed_orders,
      MAX(o.created_at) AS last_order_at
    FROM public.orders o
    WHERE o.client_id IS NOT NULL
    GROUP BY o.client_id
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) stats
  JOIN public.clients c ON c.id = stats.client_id;

  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'clients', COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'last_order_at', stats.last_order_at,
      'days_inactive', stats.days_inactive
    ) ORDER BY stats.days_inactive DESC), '[]'::jsonb)
  ) INTO v_inactive_clients
  FROM (
    SELECT
      o.client_id,
      MAX(o.created_at) AS last_order_at,
      EXTRACT(EPOCH FROM (now() - MAX(o.created_at))) / 86400 AS days_inactive
    FROM public.orders o
    WHERE o.client_id IS NOT NULL
    GROUP BY o.client_id
    HAVING EXTRACT(EPOCH FROM (now() - MAX(o.created_at))) / 86400 > 180
  ) stats
  JOIN public.clients c ON c.id = stats.client_id;

  SELECT jsonb_build_object(
    'rate', COALESCE(ROUND(
      COUNT(DISTINCT current_period.client_id)::numeric
      / NULLIF(COUNT(DISTINCT previous_period.client_id), 0) * 100,
      1
    ), 0)
  ) INTO v_retention_rate
  FROM (
    SELECT DISTINCT client_id
    FROM public.orders
    WHERE client_id IS NOT NULL
      AND (p_compare_from IS NULL OR created_at >= p_compare_from)
      AND (p_compare_to IS NULL OR created_at < p_compare_to)
  ) previous_period
  LEFT JOIN (
    SELECT DISTINCT client_id
    FROM public.orders
    WHERE client_id IS NOT NULL
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to IS NULL OR created_at < p_date_to)
  ) current_period ON current_period.client_id = previous_period.client_id;

  RETURN jsonb_build_object(
    'new_clients', v_new_clients,
    'recurring_clients', v_recurring_clients,
    'top_clients', v_top_clients,
    'inactive_clients', v_inactive_clients,
    'retention_rate', v_retention_rate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_client_analytics(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';
