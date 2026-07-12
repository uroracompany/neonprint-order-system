-- KPI Business Intelligence RPCs
-- Provides server-side analytics for the KPI module

-- Helper: get date range for period comparison
CREATE OR REPLACE FUNCTION public._kpi_get_period_bounds(
  p_period text DEFAULT 'month',
  p_offset_months integer DEFAULT 0
)
RETURNS TABLE (date_from timestamptz, date_to timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  -- Adjust for offset
  v_now := v_now - (p_offset_months || ' months')::interval;

  CASE p_period
    WHEN 'today' THEN
      v_start := date_trunc('day', v_now);
      v_end := v_start + interval '1 day';
    WHEN 'week' THEN
      v_start := date_trunc('week', v_now);
      v_end := v_start + interval '1 week';
    WHEN 'month' THEN
      v_start := date_trunc('month', v_now);
      v_end := v_start + interval '1 month';
    WHEN 'year' THEN
      v_start := date_trunc('year', v_now);
      v_end := v_start + interval '1 year';
    ELSE
      v_start := date_trunc('month', v_now);
      v_end := v_start + interval '1 month';
  END CASE;

  RETURN QUERY SELECT v_start, v_end;
END;
$$;

-- 1. Business Summary KPI
CREATE OR REPLACE FUNCTION public.kpi_business_summary(
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
  v_current jsonb;
  v_previous jsonb;
  v_health_score numeric;
  v_result jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  -- Current period
  SELECT jsonb_build_object(
    'total_orders', COALESCE(COUNT(*), 0),
    'active_orders', COALESCE(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')), 0),
    'completed_orders', COALESCE(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) IN ('in_completed', 'in_delivered')), 0),
    'cancelled_orders', COALESCE(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) = 'cancelled'), 0),
    'blocked_orders', COALESCE(COUNT(*) FILTER (WHERE operational_status = 'blocked'), 0),
    'avg_cycle_days', COALESCE(AVG(EXTRACT(EPOCH FROM (status_changed_at - created_at))/86400) FILTER (WHERE status_changed_at IS NOT NULL), 0),
    'completion_rate', CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) IN ('in_completed', 'in_delivered'))::numeric / COUNT(*) * 100, 1) ELSE 0 END
  ) INTO v_current
  FROM public.orders
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at < p_date_to);

  -- Previous period for comparison
  SELECT jsonb_build_object(
    'total_orders', COALESCE(COUNT(*), 0),
    'active_orders', COALESCE(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')), 0),
    'completion_rate', CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE lower(coalesce(status, '')) IN ('in_completed', 'in_delivered'))::numeric / COUNT(*) * 100, 1) ELSE 0 END
  ) INTO v_previous
  FROM public.orders
  WHERE (p_compare_from IS NULL OR created_at >= p_compare_from)
    AND (p_compare_to IS NULL OR created_at < p_compare_to);

  -- Calculate health score (0-100): 40% completion + 30% orders growth + 30% activity
  v_health_score := LEAST(100, GREATEST(0,
    (v_current->>'completion_rate')::numeric * 0.4 +
    (CASE WHEN (v_previous->>'total_orders')::int > 0 
      THEN LEAST(100, (v_current->>'total_orders')::numeric / (v_previous->>'total_orders')::numeric * 100) 
      ELSE 50 END) * 0.3 +
    (CASE WHEN (v_current->>'active_orders')::int > 0 THEN 20 ELSE 0 END) * 0.3
  ));

  v_result := jsonb_build_object(
    'current', v_current,
    'previous', v_previous,
    'health_score', ROUND(v_health_score),
    'trends', jsonb_build_object(
      'orders_pct', CASE WHEN (v_previous->>'total_orders')::int > 0 
        THEN ROUND(((v_current->>'total_orders')::numeric - (v_previous->>'total_orders')::numeric) / (v_previous->>'total_orders')::numeric * 100, 1)
        ELSE 0 END,
      'active_orders_pct', CASE WHEN (v_previous->>'active_orders')::int > 0 
        THEN ROUND(((v_current->>'active_orders')::numeric - (v_previous->>'active_orders')::numeric) / (v_previous->>'active_orders')::numeric * 100, 1)
        ELSE 0 END,
      'completion_rate_pct', ROUND((v_current->>'completion_rate')::numeric - (v_previous->>'completion_rate')::numeric, 1)
    )
  );

  RETURN v_result;
END;
$$;

-- 2. Orders Analytics KPI
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
    'type_breakdown', v_type_breakdown,
    'daily_trend', v_daily_trend,
    'production_metrics', v_production_metrics,
    'delayed_orders', v_delayed_orders
  );
END;
$$;

-- 3. Client Analytics KPI
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

  -- New clients in period
  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'clients', COALESCE(
      (SELECT jsonb_agg(sub) FROM (
        SELECT jsonb_build_object('id', c.id, 'name', c.name, 'created_at', c.created_at) as sub
        FROM public.clients c
        WHERE (p_date_from IS NULL OR c.created_at >= p_date_from)
          AND (p_date_to IS NULL OR c.created_at < p_date_to)
        ORDER BY c.created_at DESC
        LIMIT 10
      ) t), '[]'::jsonb)
  ) INTO v_new_clients
  FROM public.clients
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at < p_date_to);

  -- Recurring clients (clients with orders in both current and previous period)
  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0)
  ) INTO v_recurring_clients
  FROM (
    SELECT DISTINCT o.client_id
    FROM public.orders o
    WHERE o.client_id IS NOT NULL
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
      AND EXISTS (
        SELECT 1 FROM public.orders o2
        WHERE o2.client_id = o.client_id
          AND (p_compare_from IS NULL OR o2.created_at >= p_compare_from)
          AND (p_compare_to IS NULL OR o2.created_at < p_compare_to)
      )
  ) r;

  -- Top 10 clients by order volume
  SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'total_orders', stats.total_orders,
    'active_orders', stats.active_orders, 'completed_orders', stats.completed_orders,
    'last_order_at', stats.last_order_at
  ) ORDER BY stats.total_orders DESC) INTO v_top_clients
  FROM (
    SELECT 
      o.client_id,
      COUNT(*) as total_orders,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) NOT IN ('cancelled', 'in_completed', 'in_delivered')) as active_orders,
      COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered')) as completed_orders,
      MAX(o.created_at) as last_order_at
    FROM public.orders o
    WHERE o.client_id IS NOT NULL
    GROUP BY o.client_id
  ) stats
  JOIN public.clients c ON c.id = stats.client_id
  LIMIT 10;

  -- Inactive clients (> 180 days no orders)
  SELECT jsonb_build_object(
    'count', COALESCE(COUNT(*), 0),
    'clients', COALESCE(
      (SELECT jsonb_agg(sub) FROM (
        SELECT jsonb_build_object('id', c.id, 'name', c.name, 'last_order_at', stats.last_order_at, 'days_inactive', stats.days_inactive) as sub
        FROM (
          SELECT 
            o.client_id,
            MAX(o.created_at) as last_order_at,
            EXTRACT(EPOCH FROM (now() - MAX(o.created_at)))/86400 as days_inactive
          FROM public.orders o
          WHERE o.client_id IS NOT NULL
          GROUP BY o.client_id
          HAVING EXTRACT(EPOCH FROM (now() - MAX(o.created_at)))/86400 > 180
        ) stats
        JOIN public.clients c ON c.id = stats.client_id
        ORDER BY stats.days_inactive DESC
        LIMIT 10
      ) t), '[]'::jsonb)
  ) INTO v_inactive_clients
  FROM (
    SELECT 
      o.client_id,
      MAX(o.created_at) as last_order_at,
      EXTRACT(EPOCH FROM (now() - MAX(o.created_at)))/86400 as days_inactive
    FROM public.orders o
    WHERE o.client_id IS NOT NULL
    GROUP BY o.client_id
    HAVING EXTRACT(EPOCH FROM (now() - MAX(o.created_at)))/86400 > 180
  ) stats
  JOIN public.clients c ON c.id = stats.client_id;

  -- Retention rate
  SELECT jsonb_build_object(
    'rate', COALESCE(ROUND(
      (COUNT(DISTINCT CASE WHEN prev.client_id IS NOT NULL THEN curr.client_id END)::numeric / 
       NULLIF(COUNT(DISTINCT prev.client_id), 0)) * 100, 1), 0)
  ) INTO v_retention_rate
  FROM (
    SELECT DISTINCT client_id FROM public.orders
    WHERE (p_compare_from IS NULL OR created_at >= p_compare_from)
      AND (p_compare_to IS NULL OR created_at < p_compare_to)
  ) prev
  LEFT JOIN (
    SELECT DISTINCT client_id FROM public.orders
    WHERE (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to IS NULL OR created_at < p_date_to)
  ) curr ON curr.client_id = prev.client_id;

  RETURN jsonb_build_object(
    'new_clients', v_new_clients,
    'recurring_clients', v_recurring_clients,
    'top_clients', v_top_clients,
    'inactive_clients', v_inactive_clients,
    'retention_rate', v_retention_rate
  );
END;
$$;

-- 4. User Analytics KPI
CREATE OR REPLACE FUNCTION public.kpi_user_analytics(
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
  v_designers jsonb;
  v_producers jsonb;
  v_inactive_users jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  -- Sellers ranking
  SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'role', p.role,
    'orders_created', stats.orders_created,
    'completed_rate', stats.completed_rate,
    'avg_cycle_days', stats.avg_cycle_days
  ) ORDER BY stats.orders_created DESC) INTO v_sellers
  FROM (
    SELECT 
      o.created_by as user_id,
      COUNT(*) as orders_created,
      ROUND(COUNT(*) FILTER (WHERE lower(coalesce(o.status, '')) IN ('in_completed', 'in_delivered'))::numeric / NULLIF(COUNT(*), 0) * 100, 1) as completed_rate,
      AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at))/86400) FILTER (WHERE o.status_changed_at IS NOT NULL) as avg_cycle_days
    FROM public.orders o
    WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
    GROUP BY o.created_by
  ) stats
  JOIN public.profiles p ON p.id = stats.user_id
  WHERE p.role = 'seller';

  -- Designers ranking
  SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'role', p.role,
    'orders_processed', stats.orders_processed,
    'avg_days_per_order', stats.avg_days_per_order
  ) ORDER BY stats.orders_processed DESC) INTO v_designers
  FROM (
    SELECT 
      o.designer_id as user_id,
      COUNT(*) as orders_processed,
      AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at))/86400) FILTER (WHERE o.status_changed_at IS NOT NULL) as avg_days_per_order
    FROM public.orders o
    WHERE o.designer_id IS NOT NULL
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at < p_date_to)
    GROUP BY o.designer_id
  ) stats
  JOIN public.profiles p ON p.id = stats.user_id
  WHERE p.role = 'designer';

  -- Producers ranking (by files completed)
  SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'role', p.role,
    'files_completed', stats.files_completed,
    'avg_days_per_file', stats.avg_days_per_file
  ) ORDER BY stats.files_completed DESC) INTO v_producers
  FROM (
    SELECT 
      opf.assigned_to as user_id,
      COUNT(*) FILTER (WHERE opf.status = 'completed') as files_completed,
      AVG(EXTRACT(EPOCH FROM (opf.completed_at - opf.started_at))/86400) FILTER (WHERE opf.started_at IS NOT NULL AND opf.completed_at IS NOT NULL) as avg_days_per_file
    FROM public.order_production_files opf
    WHERE opf.assigned_to IS NOT NULL
      AND (p_date_from IS NULL OR opf.created_at >= p_date_from)
      AND (p_date_to IS NULL OR opf.created_at < p_date_to)
    GROUP BY opf.assigned_to
  ) stats
  JOIN public.profiles p ON p.id = stats.user_id
  WHERE p.role IN ('digital_producer', 'dtf_producer', 'ploteo_producer');

  -- Inactive users (> 7 days no activity)
  SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'role', p.role, 'last_activity', ua.last_activity
  ) ORDER BY ua.last_activity ASC) INTO v_inactive_users
  FROM (
    SELECT actor_id, MAX(created_at) as last_activity
    FROM public.order_events
    WHERE created_at < now() - interval '7 days'
    GROUP BY actor_id
  ) ua
  JOIN public.profiles p ON p.id = ua.actor_id
  WHERE p.employment_status = true
  LIMIT 10;

  RETURN jsonb_build_object(
    'sellers', v_sellers,
    'designers', v_designers,
    'producers', v_producers,
    'inactive_users', v_inactive_users
  );
END;
$$;

-- 5. Production Insights KPI
CREATE OR REPLACE FUNCTION public.kpi_production_insights(
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
  v_area_load jsonb;
  v_stage_timing jsonb;
  v_bottlenecks jsonb;
  v_file_status jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  -- Load by production area
  SELECT jsonb_object_agg(area_code, stats) INTO v_area_load
  FROM (
    SELECT 
      opf.production_area_code as area_code,
      jsonb_build_object(
        'pending', COUNT(*) FILTER (WHERE opf.status = 'pending'),
        'in_production', COUNT(*) FILTER (WHERE opf.status = 'in_production'),
        'in_termination', COUNT(*) FILTER (WHERE opf.status = 'in_termination'),
        'completed', COUNT(*) FILTER (WHERE opf.status = 'completed'),
        'total', COUNT(*)
      ) as stats
    FROM public.order_production_files opf
    JOIN public.orders o ON o.id = opf.order_id
    WHERE opf.production_area_code IS NOT NULL
      AND (p_date_from IS NULL OR opf.created_at >= p_date_from)
      AND (p_date_to IS NULL OR opf.created_at < p_date_to)
    GROUP BY opf.production_area_code
  ) a;

  -- Average time per stage
  SELECT jsonb_build_object(
    'design_to_quote', COALESCE(AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at))/86400) FILTER (WHERE o.status = 'in_Quote'), 0),
    'quote_to_production', COALESCE(AVG(EXTRACT(EPOCH FROM (o.status_changed_at - o.created_at))/86400) FILTER (WHERE o.status = 'in_Production'), 0),
    'production_to_termination', COALESCE(AVG(EXTRACT(EPOCH FROM (opf.in_termination_at - opf.started_at))/86400) FILTER (WHERE opf.started_at IS NOT NULL AND opf.in_termination_at IS NOT NULL), 0),
    'termination_to_completion', COALESCE(AVG(EXTRACT(EPOCH FROM (opf.completed_at - opf.in_termination_at))/86400) FILTER (WHERE opf.in_termination_at IS NOT NULL AND opf.completed_at IS NOT NULL), 0)
  ) INTO v_stage_timing
  FROM public.orders o
  LEFT JOIN public.order_production_files opf ON opf.order_id = o.id
  WHERE (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at < p_date_to);

  -- Bottlenecks: orders stuck in each stage > 3 days
  SELECT jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'client_name', o.client_name, 
    'stage', o.status, 'days_in_stage', days_in_stage,
    'assigned_to', COALESCE(o.designer_id, o.quote_id, o.production_id, o.delivery_id)
  ) ORDER BY days_in_stage DESC) INTO v_bottlenecks
  FROM (
    SELECT o.*, EXTRACT(EPOCH FROM (now() - COALESCE(o.status_changed_at, o.created_at)))/86400 as days_in_stage
    FROM public.orders o
    WHERE o.status IN ('in_Design', 'in_Quote', 'in_Production', 'in_Termination')
      AND o.operational_status != 'blocked'
  ) o
  WHERE days_in_stage > 3
  LIMIT 20;

  -- File status summary
  SELECT jsonb_build_object(
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'in_production', COUNT(*) FILTER (WHERE status = 'in_production'),
    'in_termination', COUNT(*) FILTER (WHERE status = 'in_termination'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed')
  ) INTO v_file_status
  FROM public.order_production_files opf
  JOIN public.orders o ON o.id = opf.order_id
  WHERE (p_date_from IS NULL OR opf.created_at >= p_date_from)
    AND (p_date_to IS NULL OR opf.created_at < p_date_to);

  RETURN jsonb_build_object(
    'area_load', v_area_load,
    'stage_timing', v_stage_timing,
    'bottlenecks', v_bottlenecks,
    'file_status', v_file_status
  );
END;
$$;

-- 6. Smart Alerts KPI
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

  SELECT jsonb_agg(alert ORDER BY severity DESC, created_at DESC) INTO v_alerts
  FROM (
    -- Alerta 1: Caída de órdenes >20% vs semana anterior
    SELECT jsonb_build_object(
      'type', 'orders_drop',
      'title', 'Caída significativa de órdenes',
      'message', 'Las órdenes de esta semana son un ' || ROUND(((curr.cnt - prev.cnt)::numeric / NULLIF(prev.cnt, 0)) * 100, 1) || '% menores que la semana anterior.',
      'severity', CASE WHEN ((curr.cnt - prev.cnt)::numeric / NULLIF(prev.cnt, 0)) * 100 < -20 THEN 'high' ELSE 'medium' END,
      'action', 'Revisar embudo de ventas',
      'created_at', now()
    ) as alert
    FROM (
      SELECT COUNT(*) as cnt FROM public.orders 
      WHERE created_at >= date_trunc('week', now()) - interval '1 week'
        AND created_at < date_trunc('week', now())
    ) curr
    CROSS JOIN (
      SELECT COUNT(*) as cnt FROM public.orders 
      WHERE created_at >= date_trunc('week', now()) - interval '2 week'
        AND created_at < date_trunc('week', now()) - interval '1 week'
    ) prev
    WHERE prev.cnt > 0 AND ((curr.cnt - prev.cnt)::numeric / prev.cnt) * 100 < -15

    UNION ALL

    -- Alerta 2: Órdenes retrasadas >7 días
    SELECT jsonb_build_object(
      'type', 'delayed_orders',
      'title', 'Órdenes estancadas',
      'message', 'Hay ' || COUNT(*) || ' órdenes sin movimiento hace más de 7 días.',
      'severity', CASE WHEN COUNT(*) > 10 THEN 'high' ELSE 'medium' END,
      'action', 'Revisar estados bloqueados',
      'created_at', now()
    ) as alert
    FROM public.orders o
    WHERE o.status NOT IN ('cancelled', 'in_completed', 'in_delivered')
      AND o.operational_status != 'blocked'
      AND COALESCE(o.status_changed_at, o.created_at) < now() - interval '7 days'

    UNION ALL

    -- Alerta 3: Usuarios inactivos >7 días
    SELECT jsonb_build_object(
      'type', 'inactive_users',
      'title', 'Usuarios sin actividad',
      'message', COUNT(*) || ' empleados no han registrado actividad en los últimos 7 días.',
      'severity', 'low',
      'action', 'Verificar disponibilidad',
      'created_at', now()
    ) as alert
    FROM (
      SELECT DISTINCT actor_id
      FROM public.order_events
      WHERE created_at < now() - interval '7 days'
    ) u
    JOIN public.profiles p ON p.id = u.actor_id
    WHERE p.employment_status = true
    GROUP BY p.id

    UNION ALL

    -- Alerta 4: Clientes top sin compra >60 días
    SELECT jsonb_build_object(
      'type', 'vip_inactive',
      'title', 'Clientes importantes inactivos',
      'message', STRING_AGG(c.name, ', ') || ' no han realizado órdenes en 60+ días.',
      'severity', 'high',
      'action', 'Contactar y reactivar',
      'created_at', now()
    ) as alert
    FROM (
      SELECT DISTINCT c2.id, c2.name
      FROM public.clients c2
      INNER JOIN public.orders o2 ON o2.client_id = c2.id
      WHERE o2.created_at < now() - interval '60 days'
      GROUP BY c2.id, c2.name
      HAVING COUNT(*) >= 5
      LIMIT 5
    ) c

    UNION ALL

    -- Alerta 5: Tasa de cancelación alta
    SELECT jsonb_build_object(
      'type', 'high_cancellation',
      'title', 'Tasa de cancelación elevada',
      'message', 'La tasa de cancelación del mes actual es ' || ROUND(cancelled::numeric / NULLIF(total, 0) * 100, 1) || '%.',
      'severity', CASE WHEN cancelled::numeric / NULLIF(total, 0) > 0.15 THEN 'high' ELSE 'medium' END,
      'action', 'Analizar causas de cancelación',
      'created_at', now()
    ) as alert
    FROM (
      SELECT 
        COUNT(*) FILTER (WHERE lower(coalesce(status, '')) = 'cancelled') as cancelled,
        COUNT(*) as total
      FROM public.orders
      WHERE created_at >= date_trunc('month', now())
    ) c
    WHERE total > 10 AND cancelled::numeric / total > 0.1

    UNION ALL

    -- Alerta 6: Cuello de botella crítico
    SELECT jsonb_build_object(
      'type', 'bottleneck',
      'title', 'Cuello de botella en producción',
      'message', 'Hay ' || COUNT(*) || ' archivos acumulados en una misma etapa.',
      'severity', 'high',
      'action', 'Reasignar o priorizar',
      'created_at', now()
    ) as alert
    FROM public.order_production_files opf
    WHERE opf.status IN ('pending', 'in_production')
    GROUP BY opf.production_area_code, opf.status
    HAVING COUNT(*) > 5
  ) alerts;

  RETURN COALESCE(v_alerts, '[]'::jsonb);
END;
$$;

-- 7. Orders Trend (for sparklines)
CREATE OR REPLACE FUNCTION public.kpi_orders_trend(
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_trend jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'date', day::date, 
    'orders', COALESCE(cnt, 0)
  ) ORDER BY day) INTO v_trend
  FROM (
    SELECT generate_series(
      (now() - (p_days || ' days')::interval)::date,
      now()::date,
      interval '1 day'
    ) as day
  ) d
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM public.orders
    WHERE date_trunc('day', created_at) = d.day
  ) o ON true;

  RETURN COALESCE(v_trend, '[]'::jsonb);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.kpi_business_summary(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_orders_analytics(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_client_analytics(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_user_analytics(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_production_insights(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_smart_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_orders_trend(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public._kpi_get_period_bounds(text, integer) TO authenticated;