-- Align legacy KPI RPCs with the current orders schema.
-- These functions are read-only, SECURITY INVOKER, and remain limited to admins.

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

CREATE OR REPLACE FUNCTION public.kpi_smart_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_alerts jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  SELECT COALESCE(jsonb_agg(alert ORDER BY alert->>'severity' DESC, alert->>'created_at' DESC), '[]'::jsonb)
  INTO v_alerts
  FROM (
    SELECT jsonb_build_object(
      'type', 'orders_drop',
      'title', 'Caida significativa de ordenes',
      'message', 'Las ordenes de esta semana son un ' || ROUND(((curr.cnt - previous.cnt)::numeric / NULLIF(previous.cnt, 0)) * 100, 1) || '% menores que la semana anterior.',
      'severity', CASE WHEN ((curr.cnt - previous.cnt)::numeric / NULLIF(previous.cnt, 0)) * 100 < -20 THEN 'high' ELSE 'medium' END,
      'action', 'Revisar embudo de ventas',
      'created_at', now()
    ) AS alert
    FROM (
      SELECT COUNT(*) AS cnt
      FROM public.orders
      WHERE created_at >= date_trunc('week', now()) - interval '1 week'
        AND created_at < date_trunc('week', now())
    ) curr
    CROSS JOIN (
      SELECT COUNT(*) AS cnt
      FROM public.orders
      WHERE created_at >= date_trunc('week', now()) - interval '2 week'
        AND created_at < date_trunc('week', now()) - interval '1 week'
    ) previous
    WHERE previous.cnt > 0 AND ((curr.cnt - previous.cnt)::numeric / previous.cnt) * 100 < -15

    UNION ALL

    SELECT jsonb_build_object(
      'type', 'delayed_orders',
      'title', 'Ordenes estancadas',
      'message', 'Hay ' || COUNT(*) || ' ordenes sin movimiento hace mas de 7 dias.',
      'severity', CASE WHEN COUNT(*) > 10 THEN 'high' ELSE 'medium' END,
      'action', 'Revisar estados bloqueados',
      'created_at', now()
    )
    FROM public.orders o
    WHERE lower(COALESCE(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')
      AND COALESCE(o.operational_status, '') <> 'blocked'
      AND COALESCE(o.status_changed_at, o.created_at) < now() - interval '7 days'

    UNION ALL

    SELECT jsonb_build_object(
      'type', 'inactive_users',
      'title', 'Usuarios sin actividad',
      'message', COUNT(*) || ' empleados no han registrado actividad en los ultimos 7 dias.',
      'severity', 'low',
      'action', 'Verificar disponibilidad',
      'created_at', now()
    )
    FROM (
      SELECT DISTINCT actor_id
      FROM public.order_events
      WHERE actor_id IS NOT NULL AND created_at < now() - interval '7 days'
    ) inactive_users
    JOIN public.profiles p ON p.id = inactive_users.actor_id
    WHERE p.employment_status = true

    UNION ALL

    SELECT jsonb_build_object(
      'type', 'vip_inactive',
      'title', 'Clientes importantes inactivos',
      'message', STRING_AGG(c.name, ', ') || ' no han realizado ordenes en 60+ dias.',
      'severity', 'high',
      'action', 'Contactar y reactivar',
      'created_at', now()
    )
    FROM (
      SELECT c2.id, c2.name
      FROM public.clients c2
      JOIN public.orders o2 ON o2.client_id = c2.id
      GROUP BY c2.id, c2.name
      HAVING MAX(o2.created_at) < now() - interval '60 days' AND COUNT(*) >= 5
      ORDER BY MAX(o2.created_at)
      LIMIT 5
    ) c

    UNION ALL

    SELECT jsonb_build_object(
      'type', 'high_cancellation',
      'title', 'Tasa de cancelacion elevada',
      'message', 'La tasa de cancelacion del mes actual es ' || ROUND(cancelled::numeric / NULLIF(total, 0) * 100, 1) || '%.',
      'severity', CASE WHEN cancelled::numeric / NULLIF(total, 0) > 0.15 THEN 'high' ELSE 'medium' END,
      'action', 'Analizar causas de cancelacion',
      'created_at', now()
    )
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE lower(COALESCE(status, '')) = 'cancelled') AS cancelled,
        COUNT(*) AS total
      FROM public.orders
      WHERE created_at >= date_trunc('month', now())
    ) cancellation_rate
    WHERE total > 10 AND cancelled::numeric / total > 0.1

    UNION ALL

    SELECT jsonb_build_object(
      'type', 'bottleneck',
      'title', 'Cuello de botella en produccion',
      'message', 'Hay ' || COUNT(*) || ' archivos acumulados en una misma etapa.',
      'severity', 'high',
      'action', 'Reasignar o priorizar',
      'created_at', now()
    )
    FROM public.order_production_files opf
    WHERE lower(COALESCE(opf.status, '')) IN ('pending', 'in_production')
    GROUP BY opf.production_area_code, opf.status
    HAVING COUNT(*) > 5
  ) alert_rows;

  RETURN v_alerts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_client_analytics(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_smart_alerts() TO authenticated;
