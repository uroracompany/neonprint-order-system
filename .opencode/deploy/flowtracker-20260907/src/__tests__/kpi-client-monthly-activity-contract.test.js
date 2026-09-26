import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(resolve(process.cwd(), path), 'utf8')
const handler = readProjectFile('server/kpi-data-handler.js')

describe('serie mensual de Clientes KPI', () => {
  it('agrega la actividad por mes, conserva meses sin órdenes y limita la consulta a tres meses', () => {
    const migration = readProjectFile('supabase/migrations/20260824110000_client_kpi_monthly_activity.sql')

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.kpi_client_monthly_activity")
    expect(migration).toContain('generate_series(')
    expect(migration).toContain("o.created_at IS NOT NULL")
    expect(migration).toContain("COUNT(DISTINCT o.client_id)")
    expect(migration).toContain("GREATEST(1, LEAST(COALESCE(p_months, 3), 3))")
  })

  it('expone la serie dedicada en el mismo payload de KPI Clientes', () => {
    expect(handler).toContain("supabase.rpc('kpi_client_monthly_activity', { p_months: 3 })")
    expect(handler).toContain("if (error.code !== 'PGRST202') throw error")
    expect(handler).toContain(".not('created_at', 'is', null)")
    expect(handler).toContain('client_activity_timeline: clientActivityTimelineResult?.data || []')
    expect(handler).toContain("order_design_type, created_at, delivery_date, status_changed_at').range(0, 4999)")
    expect(handler).not.toContain("order_design_type, created_at, delivery_date, completed_at').range(0, 4999)")
  })
})
