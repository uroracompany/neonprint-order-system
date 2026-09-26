-- Funciones auxiliares para los mini-filtros del Panel de Clientes KPI
-- Agrega: conteo de clientes sin órdenes, inactivos por umbral

CREATE OR REPLACE FUNCTION public.count_clients_without_orders()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.clients c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.client_id = c.id
  );

  RETURN jsonb_build_object('count', COALESCE(v_count, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_clients_without_orders() TO authenticated;

CREATE OR REPLACE FUNCTION public.kpi_new_client_activation(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'with_first_order', COUNT(*) FILTER (WHERE first_order_at IS NOT NULL),
      'pending_first_order', COUNT(*) FILTER (WHERE first_order_at IS NULL)
    )
    FROM public.clients c
    LEFT JOIN LATERAL (
      SELECT MIN(o.created_at) AS first_order_at
      FROM public.orders o
      WHERE o.client_id = c.id
    ) first_order ON true
    WHERE (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at < p_date_to)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_new_client_activation(timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.kpi_inactive_by_threshold()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_build_object(
      'd90', COUNT(*) FILTER (WHERE days > 90),
      'd180', COUNT(*) FILTER (WHERE days > 180),
      'd365', COUNT(*) FILTER (WHERE days > 365)
    ), jsonb_build_object('d90', 0, 'd180', 0, 'd365', 0))
    FROM (
      SELECT
        o.client_id,
        EXTRACT(EPOCH FROM (now() - MAX(o.created_at))) / 86400 AS days
      FROM public.orders o
      WHERE o.client_id IS NOT NULL
      GROUP BY o.client_id
    ) sub
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_inactive_by_threshold() TO authenticated;

NOTIFY pgrst, 'reload schema';
