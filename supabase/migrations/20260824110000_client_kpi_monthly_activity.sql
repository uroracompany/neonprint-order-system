-- Serie determinista para la gráfica general de Clientes KPI.
-- Devuelve todos los meses solicitados, incluidos los que aún no tienen órdenes.

CREATE OR REPLACE FUNCTION public.kpi_client_monthly_activity(
  p_months integer DEFAULT 3
)
RETURNS TABLE (
  month text,
  orders integer,
  active_clients integer
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_months integer := GREATEST(1, LEAST(COALESCE(p_months, 3), 3));
  v_current_month timestamptz := date_trunc('month', now());
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  RETURN QUERY
  WITH requested_months AS (
    SELECT generate_series(
      v_current_month - make_interval(months => v_months - 1),
      v_current_month,
      interval '1 month'
    ) AS month_start
  )
  SELECT
    to_char(month_start, 'YYYY-MM') AS month,
    COUNT(o.id)::integer AS orders,
    COUNT(DISTINCT o.client_id) FILTER (WHERE o.client_id IS NOT NULL)::integer AS active_clients
  FROM requested_months m
  LEFT JOIN public.orders o
    ON o.created_at IS NOT NULL
    AND o.created_at >= m.month_start
    AND o.created_at < m.month_start + interval '1 month'
  GROUP BY m.month_start
  ORDER BY m.month_start;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_client_monthly_activity(integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
