-- =============================================================
-- Migration: Create materials management table
-- Description: Centralized materials catalog for admin management
-- and dynamic loading in order forms (Seller, Admin)
-- =============================================================

-- 1. Create materials table
CREATE TABLE IF NOT EXISTS materials (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials (name);

-- 3. Enable RLS
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Admins get full CRUD; all authenticated users can read
CREATE POLICY "materials_select_all"
  ON materials FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "materials_insert_admin"
  ON materials FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "materials_update_admin"
  ON materials FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "materials_delete_admin"
  ON materials FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- 5. Seed default materials from existing hardcoded list
INSERT INTO materials (name) VALUES
  ('Vinilo'),
  ('Banner'),
  ('Lona'),
  ('Papel Fotografico'),
  ('Carton'),
  ('Adhesivo'),
  ('PVC'),
  ('Acrilico'),
  ('Tela'),
  ('Foam'),
  ('Otro')
ON CONFLICT (name) DO NOTHING;
