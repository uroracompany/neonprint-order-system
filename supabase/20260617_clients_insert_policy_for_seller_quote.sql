-- =============================================================
-- Migration: Allow seller and quote roles to insert clients
-- Description: Extends the clients insert policy so Vendedor
-- and Cotización can register new clients directly from their
-- workflow without needing admin access.
-- =============================================================

DROP POLICY IF EXISTS clients_insert_non_admin ON public.clients;

CREATE POLICY clients_insert_non_admin
  ON public.clients FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_profile_role() IN ('seller', 'quote')
  );
