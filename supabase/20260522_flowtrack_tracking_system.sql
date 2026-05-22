-- =============================================
-- FLOWTRACK: Sistema de seguimiento para clientes
-- Genera tracking tokens, RPCs públicas y reglas de negocio
-- =============================================

-- 1. Agregar columna tracking_token a orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_token uuid UNIQUE;
CREATE INDEX IF NOT EXISTS idx_orders_tracking_token ON public.orders(tracking_token);

-- 2. Función trigger para auto-generar token en INSERT
CREATE OR REPLACE FUNCTION public.set_tracking_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.tracking_token IS NULL THEN
    NEW.tracking_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_tracking_token
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tracking_token();

-- 3. RPC pública: obtener datos de tracking por token
CREATE OR REPLACE FUNCTION public.get_order_tracking(p_token text)
RETURNS TABLE(
  id uuid,
  client_name text,
  status text,
  payment_status text,
  created_at timestamptz,
  updated_at timestamptz,
  delivery_date text,
  order_type text,
  order_design_type text,
  description text,
  material text,
  termination_type text,
  preview_image text,
  cancellation_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.client_name,
    o.status,
    o.payment_status,
    o.created_at,
    o.updated_at,
    o.delivery_date,
    o.order_type,
    o.order_design_type,
    o.description,
    o.material,
    o.termination_type,
    o.preview_image,
    o.cancellation_reason
  FROM public.orders o
  WHERE o.tracking_token = p_token::uuid
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_tracking TO anon;

-- 4. RPC pública: obtener historial de eventos por token
CREATE OR REPLACE FUNCTION public.get_order_tracking_events(p_token text)
RETURNS TABLE(
  event_type text,
  old_status text,
  new_status text,
  old_payment_status text,
  new_payment_status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    e.event_type,
    e.old_status,
    e.new_status,
    e.old_payment_status,
    e.new_payment_status,
    e.created_at
  FROM public.order_events e
  INNER JOIN public.orders o ON o.id = e.order_id
  WHERE o.tracking_token = p_token::uuid
  ORDER BY e.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_tracking_events TO anon;

-- 5. Función trigger: bloquear producción si pago no está confirmado
CREATE OR REPLACE FUNCTION public.check_production_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'in_Production' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.payment_status IS DISTINCT FROM 'pagado' THEN
      RAISE EXCEPTION 'La orden no puede pasar a producción hasta que el pago sea confirmado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_production_eligibility
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_production_eligibility();

-- 6. Backfill: generar tokens para órdenes existentes
UPDATE public.orders SET tracking_token = gen_random_uuid() WHERE tracking_token IS NULL;
