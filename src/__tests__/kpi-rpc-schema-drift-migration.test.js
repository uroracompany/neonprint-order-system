import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260815040000_fix_kpi_rpc_schema_drift.sql'),
  'utf8',
)

describe('KPI RPC schema-drift migration', () => {
  it('replaces the legacy client RPC without referencing orders.completed_at', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.kpi_client_analytics(')
    expect(migration).not.toMatch(/orders\.completed_at/i)
  })

  it('orders smart-alert JSON through JSON fields rather than missing derived columns', () => {
    expect(migration).toContain("ORDER BY alert->>'severity' DESC, alert->>'created_at' DESC")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.kpi_smart_alerts()')
  })

  it('keeps both RPCs callable only through the existing authenticated grant', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.kpi_client_analytics')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.kpi_smart_alerts() TO authenticated;')
  })
})
