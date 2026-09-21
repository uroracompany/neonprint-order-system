-- RPC para estadísticas de órdenes en Administración → Gestión de Órdenes
-- Proporciona datos agregados para el modal de estadísticas

CREATE OR REPLACE FUNCTION public.kpi_admin_orders_statistics(
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
  v_total_orders integer;
  v_active_orders integer;
  v_cancelled_orders integer;
  v_active_credit_orders integer;
  v_completed_orders integer;
  v_delivered_orders integer;
  v_normal_orders integer;
  v_urgent_911_orders integer;
  v_internal_design_orders integer;
  v_external_design_orders integer;
  v_daily_trend jsonb;
  v_top_client jsonb;
  v_top_material jsonb;
  v_top_seller_completed jsonb;
  v_top_designer_completed jsonb;
  v_pipeline jsonb;
  v_comparison jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  -- Validar permisos de administrador
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  -- Determinar límites del período
  v_period_start := COALESCE(p_date_from, (now() - interval '30 days')::timestamptz);
  v_period_end := COALESCE(p_date_to, now());

  IF v_period_end <= v_period_start THEN
    RAISE EXCEPTION 'El cierre del período debe ser posterior al inicio.';
  END IF;

  -- 1. Total de órdenes en el período
  SELECT count(*) INTO v_total_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end;

  -- 2. Órdenes activas (estados de workflow activo, excluyendo completadas, entregadas y canceladas)
  SELECT count(*) INTO v_active_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end
    AND lower(coalesce(status, '')) IN (
      'pending', 'in_design', 'in_quote', 'in_production', 'in_termination'
    );

  -- 3. Órdenes canceladas
  SELECT count(*) INTO v_cancelled_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end
    AND lower(coalesce(status, '')) = 'cancelled';

  -- 4. Órdenes completadas
  SELECT count(*) INTO v_completed_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end
    AND lower(coalesce(status, '')) = 'in_completed';

  -- 5. Órdenes entregadas
  SELECT count(*) INTO v_delivered_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end
    AND lower(coalesce(status, '')) = 'in_delivered';

  -- 6. Órdenes activas a crédito
  SELECT count(*) INTO v_active_credit_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end
    AND lower(coalesce(payment_status, '')) = 'credito'
    AND lower(coalesce(status, '')) IN (
      'pending', 'in_design', 'in_quote', 'in_production', 'in_termination'
    );

  -- 7. Prioridad: Normal vs 911
  SELECT count(*) FILTER (WHERE lower(trim(coalesce(order_type, ''))) <> 'orden 911') INTO v_normal_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end;

  SELECT count(*) FILTER (WHERE lower(trim(coalesce(order_type, ''))) = 'orden 911') INTO v_urgent_911_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end;

  -- 8. Tipo de diseño: Interno vs Externo
  SELECT count(*) FILTER (WHERE order_design_type = 'INTERNAL_DESING') INTO v_internal_design_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end;

  SELECT count(*) FILTER (WHERE order_design_type = 'EXTERNAL_DESING') INTO v_external_design_orders
  FROM public.orders
  WHERE created_at >= v_period_start AND created_at < v_period_end;

  -- 9. Tendencia diaria (días civiles de Asunción, con cierre exclusivo)
  WITH bounds AS (
    SELECT
      (v_period_start AT TIME ZONE 'America/Asuncion')::date AS first_day,
      ((v_period_end - interval '1 microsecond') AT TIME ZONE 'America/Asuncion')::date AS last_day
  ),
  days AS (
    SELECT generate_series(first_day::timestamp, last_day::timestamp, interval '1 day')::date AS day
    FROM bounds
    WHERE first_day <= last_day
  )
  SELECT jsonb_agg(jsonb_build_object('date', day, 'orders', order_count) ORDER BY day) INTO v_daily_trend
  FROM (
    SELECT d.day, count(o.id) AS order_count
    FROM days d
    LEFT JOIN public.orders o
      ON o.created_at >= v_period_start
     AND o.created_at < v_period_end
     AND (o.created_at AT TIME ZONE 'America/Asuncion')::date = d.day
    GROUP BY d.day
  ) q;

  -- 10. Cliente con más órdenes
  SELECT jsonb_build_object(
    'client_name', client_name,
    'order_count', order_count
  ) INTO v_top_client
  FROM (
    SELECT client_name, count(*) AS order_count
    FROM public.orders
    WHERE created_at >= v_period_start AND created_at < v_period_end
      AND client_name IS NOT NULL AND client_name <> ''
    GROUP BY client_name
    ORDER BY order_count DESC
    LIMIT 1
  ) q;

  -- 11. Material más utilizado (una relación material–orden por orden)
  WITH period_orders AS (
    SELECT id, material
    FROM public.orders
    WHERE created_at >= v_period_start AND created_at < v_period_end
  ),
  file_material_values AS (
    SELECT
      po.id AS order_id,
      nullif(regexp_replace(btrim(material_value), '\s+', ' ', 'g'), '') AS material_name
    FROM period_orders po
    JOIN public.order_production_files f ON f.order_id = po.id
    CROSS JOIN LATERAL unnest(coalesce(f.material_names, ARRAY[]::text[])) AS names(material_value)
  ),
  file_material_rows AS (
    SELECT
      order_id,
      lower(material_name) AS material_key,
      material_name
    FROM file_material_values
    WHERE material_name IS NOT NULL
  ),
  file_materials_per_order AS (
    SELECT DISTINCT ON (order_id, material_key)
      order_id,
      material_key,
      material_name
    FROM file_material_rows
    ORDER BY order_id, material_key, length(material_name) DESC, material_name
  ),
  file_orders AS (
    SELECT DISTINCT order_id
    FROM file_materials_per_order
  ),
  legacy_material_values AS (
    SELECT
      po.id AS order_id,
      nullif(regexp_replace(btrim(material_value), '\s+', ' ', 'g'), '') AS material_name
      FROM period_orders po
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(po.material, ''), '[,;/|]+') AS names(material_value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM file_orders fo
      WHERE fo.order_id = po.id
    )
  ),
  legacy_material_rows AS (
    SELECT DISTINCT ON (order_id, material_key)
      order_id,
      lower(material_name) AS material_key,
      material_name
    FROM (
      SELECT
        order_id,
        material_name,
        lower(material_name) AS material_key
      FROM legacy_material_values
      WHERE material_name IS NOT NULL
    ) q
    ORDER BY order_id, material_key, length(material_name) DESC, material_name
  ),
  material_refs AS (
    SELECT order_id, material_key, material_name
    FROM file_materials_per_order
    UNION ALL
    SELECT order_id, material_key, material_name
    FROM legacy_material_rows
  ),
  material_variants AS (
    SELECT material_key, material_name, count(*) AS variant_count
    FROM material_refs
    GROUP BY material_key, material_name
  ),
  material_rollup AS (
    SELECT
      material_key,
      sum(variant_count)::integer AS reference_count,
      (array_agg(material_name ORDER BY variant_count DESC, length(material_name) DESC, material_name))[1] AS material_name
    FROM material_variants
    GROUP BY material_key
  )
  SELECT jsonb_build_object(
    'material_name', material_name,
    'reference_count', reference_count
  ) INTO v_top_material
  FROM (
    SELECT material_key, material_name, reference_count
    FROM material_rollup
    ORDER BY reference_count DESC, material_key
    LIMIT 1
  ) q;

  -- 12. Vendedor con más órdenes completadas
  SELECT jsonb_build_object(
    'seller_name', COALESCE(p.name, 'Sin asignar'),
    'completed_count', completed_count
  ) INTO v_top_seller_completed
  FROM (
    SELECT seller_id, count(*) AS completed_count
    FROM public.orders
    WHERE created_at >= v_period_start AND created_at < v_period_end
      AND lower(coalesce(status, '')) IN ('in_completed', 'in_delivered')
      AND seller_id IS NOT NULL
    GROUP BY seller_id
    ORDER BY completed_count DESC
    LIMIT 1
  ) q
  LEFT JOIN public.profiles p ON p.id = q.seller_id;

  -- 13. Diseñador con más órdenes completadas
  SELECT jsonb_build_object(
    'designer_name', COALESCE(p.name, 'Sin asignar'),
    'completed_count', completed_count
  ) INTO v_top_designer_completed
  FROM (
    SELECT designer_id, count(*) AS completed_count
    FROM public.orders
    WHERE created_at >= v_period_start AND created_at < v_period_end
      AND lower(coalesce(status, '')) IN ('in_completed', 'in_delivered')
      AND designer_id IS NOT NULL
    GROUP BY designer_id
    ORDER BY completed_count DESC
    LIMIT 1
  ) q
  LEFT JOIN public.profiles p ON p.id = q.designer_id;

  -- 14. Pipeline por estado (workflow real)
  SELECT jsonb_agg(
    jsonb_build_object(
      'status', status,
      'label', label,
      'count', cnt,
      'pct', CASE WHEN v_total_orders > 0 THEN round(cnt::numeric / v_total_orders * 100, 1) ELSE 0 END,
      'color', color
    ) ORDER BY sort_order
  ) INTO v_pipeline
  FROM (
    VALUES
      ('pending', 'Pendiente', 1, '#F59E0B'),
      ('in_design', 'Diseño', 2, '#8B5CF6'),
      ('in_quote', 'Cotización', 3, '#06B6D4'),
      ('in_production', 'Producción', 4, '#F97316'),
      ('in_termination', 'Terminación', 5, '#0284C7'),
      ('in_completed', 'Completada', 6, '#10B981'),
      ('in_delivered', 'Entregada', 7, '#6366F1'),
      ('cancelled', 'Cancelada', 8, '#EF4444')
  ) AS s(status, label, sort_order, color)
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM public.orders
    WHERE created_at >= v_period_start AND created_at < v_period_end
      AND lower(coalesce(status, '')) = s.status
  ) c ON true;

  -- 15. Comparativa: Estado × Prioridad (Normal/911 por cada estado)
  SELECT jsonb_agg(
    jsonb_build_object(
      'status', status,
      'label', label,
      'total', total,
      'normal', normal,
      'urgent_911', urgent_911,
      'pct_urgent', CASE WHEN total > 0 THEN round(urgent_911::numeric / total * 100, 1) ELSE 0 END,
      'completed', completed,
      'cancelled', cancelled,
      'pct_completion', CASE WHEN total > 0 THEN round((completed + cancelled)::numeric / total * 100, 1) ELSE 0 END
    ) ORDER BY sort_order
  ) INTO v_comparison
  FROM (
    VALUES
      ('pending', 'Pendiente', 1),
      ('in_design', 'Diseño', 2),
      ('in_quote', 'Cotización', 3),
      ('in_production', 'Producción', 4),
      ('in_termination', 'Terminación', 5),
      ('in_completed', 'Completada', 6),
      ('in_delivered', 'Entregada', 7),
      ('cancelled', 'Cancelada', 8)
  ) AS s(status, label, sort_order)
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE lower(trim(coalesce(order_type, ''))) <> 'orden 911') AS normal,
      count(*) FILTER (WHERE lower(trim(coalesce(order_type, ''))) = 'orden 911') AS urgent_911,
      count(*) FILTER (WHERE lower(coalesce(status, '')) IN ('in_completed', 'in_delivered')) AS completed,
      count(*) FILTER (WHERE lower(coalesce(status, '')) = 'cancelled') AS cancelled
    FROM public.orders
    WHERE created_at >= v_period_start AND created_at < v_period_end
      AND lower(coalesce(status, '')) = s.status
  ) c ON true;

  -- Retornar todo el JSON agregado
  RETURN jsonb_build_object(
    'total_orders', v_total_orders,
    'active_orders', v_active_orders,
    'cancelled_orders', v_cancelled_orders,
    'completed_orders', v_completed_orders,
    'delivered_orders', v_delivered_orders,
    'active_credit_orders', v_active_credit_orders,
    'normal_orders', v_normal_orders,
    'urgent_911_orders', v_urgent_911_orders,
    'internal_design_orders', v_internal_design_orders,
    'external_design_orders', v_external_design_orders,
    'daily_trend', COALESCE(v_daily_trend, '[]'::jsonb),
    'top_client', COALESCE(v_top_client, jsonb_build_object('client_name', 'Sin datos', 'order_count', 0)),
    'top_material', COALESCE(v_top_material, jsonb_build_object('material_name', 'Sin datos', 'reference_count', 0)),
    'top_seller_completed', COALESCE(v_top_seller_completed, jsonb_build_object('seller_name', 'Sin datos', 'completed_count', 0)),
    'top_designer_completed', COALESCE(v_top_designer_completed, jsonb_build_object('designer_name', 'Sin datos', 'completed_count', 0)),
    'pipeline', COALESCE(v_pipeline, '[]'::jsonb),
    'comparison', COALESCE(v_comparison, '[]'::jsonb),
    'period', jsonb_build_object(
      'date_from', v_period_start,
      'date_to', v_period_end
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_admin_orders_statistics(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kpi_admin_orders_statistics(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';
