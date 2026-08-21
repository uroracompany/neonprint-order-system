-- Métrica de cancelación del detalle de material.
-- Ambas cifras se calculan sobre la misma población de órdenes únicas que
-- contienen el material dentro del rango solicitado.

CREATE OR REPLACE FUNCTION public.kpi_material_cancellation_stats(
  p_material_name text,
  p_date_from timestamptz,
  p_date_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_material_key text := lower(regexp_replace(btrim(coalesce(p_material_name, '')), '[[:space:]]+', ' ', 'g'));
BEGIN
  IF NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar KPIs.';
  END IF;

  IF v_material_key = '' OR p_date_from IS NULL OR p_date_to IS NULL OR p_date_to <= p_date_from THEN
    RAISE EXCEPTION 'El material y un rango de fechas válido son requeridos.';
  END IF;

  RETURN (
    WITH material_orders AS (
      SELECT DISTINCT
        o.id,
        lower(coalesce(o.status, '')) AS status
      FROM public.orders o
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+') AS part(raw_material)
      WHERE o.created_at >= p_date_from
        AND o.created_at < p_date_to
        AND coalesce(o.is_archived, false) = false
        AND lower(regexp_replace(btrim(part.raw_material), '[[:space:]]+', ' ', 'g')) = v_material_key
    )
    SELECT jsonb_build_object(
      'total_orders', count(*),
      'cancelled_orders', count(*) FILTER (WHERE status = 'cancelled')
    )
    FROM material_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_material_cancellation_stats(text, timestamptz, timestamptz) TO authenticated;
