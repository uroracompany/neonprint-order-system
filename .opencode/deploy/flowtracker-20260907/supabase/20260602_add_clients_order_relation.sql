-- =============================================================
-- Migration: Add clients catalog and order relationship
-- Description: Centralized customer management for Admin and
-- reusable customer selection in order creation forms.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text NOT NULL,
  phone_digits text GENERATED ALWAYS AS (regexp_replace(phone, '[^0-9]', '', 'g')) STORED,
  email       text,
  address     text,
  notes       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_name_min_length CHECK (length(btrim(name)) >= 2),
  CONSTRAINT clients_phone_min_length CHECK (length(btrim(phone)) >= 3)
);

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON public.clients USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_phone_trgm
  ON public.clients USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_phone_digits_trgm
  ON public.clients USING gin (phone_digits gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_created_at
  ON public.clients (created_at DESC);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_client_id
  ON public.orders (client_id);

CREATE OR REPLACE FUNCTION public.set_client_update_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_update_metadata() FROM public;
REVOKE ALL ON FUNCTION public.set_client_update_metadata() FROM anon;
REVOKE ALL ON FUNCTION public.set_client_update_metadata() FROM authenticated;

DROP TRIGGER IF EXISTS trg_set_client_update_metadata ON public.clients;
CREATE TRIGGER trg_set_client_update_metadata
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_client_update_metadata();

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;

DROP POLICY IF EXISTS clients_select_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_insert_admin ON public.clients;
DROP POLICY IF EXISTS clients_update_admin ON public.clients;
DROP POLICY IF EXISTS clients_delete_admin ON public.clients;

CREATE POLICY clients_select_authenticated
  ON public.clients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY clients_insert_admin
  ON public.clients FOR INSERT
  TO authenticated
  WITH CHECK (public.current_profile_is_admin());

CREATE POLICY clients_update_admin
  ON public.clients FOR UPDATE
  TO authenticated
  USING (public.current_profile_is_admin())
  WITH CHECK (public.current_profile_is_admin());

CREATE POLICY clients_delete_admin
  ON public.clients FOR DELETE
  TO authenticated
  USING (public.current_profile_is_admin());
