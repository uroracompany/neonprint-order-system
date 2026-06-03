-- =============================================================
-- Migration: Optimize clients search
-- Description: Adds normalized phone search support and indexes
-- for responsive client lookup in Seller/Admin order forms.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone_digits text
  GENERATED ALWAYS AS (regexp_replace(phone, '[^0-9]', '', 'g')) STORED;

DROP INDEX IF EXISTS public.idx_clients_name_lower;
DROP INDEX IF EXISTS public.idx_clients_phone_digits;

CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON public.clients USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_phone_trgm
  ON public.clients USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_phone_digits_trgm
  ON public.clients USING gin (phone_digits gin_trgm_ops);
