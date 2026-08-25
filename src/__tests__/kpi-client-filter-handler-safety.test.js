import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const handler = readFileSync(resolve(process.cwd(), 'server/kpi-data-handler.js'), 'utf8')

describe('KPI client filter data loading', () => {
  it('initializes the safe query helper before running the parallel client metrics', () => {
    const allCaseStart = handler.indexOf("case 'all':")
    const helperStart = handler.indexOf('const safeQuery = (fn)', allCaseStart)
    const parallelQueriesStart = handler.indexOf('await Promise.all([', allCaseStart)

    expect(helperStart).toBeGreaterThan(allCaseStart)
    expect(helperStart).toBeLessThan(parallelQueriesStart)
  })

  it('adds the zero-frequency count only after the parallel client queries resolve', () => {
    expect(handler).toContain('const distribution = { zero: 0, one_time: 0, low: 0, medium: 0, high: 0 }')
    expect(handler).toContain('frequency_distribution: frequencyDistribution')
  })

  it('provides first-order activation data only for clients registered in the selected period', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260824100000_client_kpi_filter_functions.sql'), 'utf8')
    const clientAnalytics = readFileSync(resolve(process.cwd(), 'src/components/kpi/KPIClientAnalytics.jsx'), 'utf8')

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.kpi_new_client_activation(')
    expect(migration).toContain("'with_first_order', COUNT(*) FILTER (WHERE first_order_at IS NOT NULL)")
    expect(migration).toContain("'pending_first_order', COUNT(*) FILTER (WHERE first_order_at IS NULL)")
    expect(handler).toContain("supabase.rpc('kpi_new_client_activation', { p_date_from: date_from, p_date_to: date_to })")
    expect(handler).toContain('new_client_activation: newClientActivationResult?.data || null')
    expect(clientAnalytics).toContain('filteredNewCount = newClientActivation.with_first_order')
    expect(clientAnalytics).toContain('filteredNewCount = newClientActivation.pending_first_order')
    expect(clientAnalytics).toContain('aria-label={`Filtro de ${c.label}`}')
  })
})
