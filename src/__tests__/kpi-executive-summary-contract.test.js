/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('verified executive KPI contract', () => {
  const migration = () => readProjectFile('supabase/migrations/20260815010000_verified_executive_kpis.sql')
  const completedPipelineMigration = () => readProjectFile('supabase/migrations/20260815020000_kpi_pipeline_completed_stage.sql')
  const realtimeMigration = () => readProjectFile('supabase/migrations/20260815021000_kpi_realtime_publication.sql')

  it('provides an auditable executive contract and records the first delivery timestamp', () => {
    const sql = migration()

    expect(sql).toContain('kpi_executive_summary')
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS delivered_at")
    expect(sql).toContain("NEW.status = 'in_Delivered'")
    expect(sql).toContain("'snapshot', v_snapshot")
    expect(sql).toContain("'period', v_period")
    expect(sql).toContain("'comparison', v_comparison")
    expect(sql).toContain("'coverage', v_coverage")
  })

  it('keeps pending payments older than three days and excludes only cancelled orders', () => {
    const sql = migration()
    const handler = readProjectFile('server/kpi-data-handler.js')

    expect(sql).toContain("created_at < now() - interval '3 days'")
    expect(sql).toContain("lower(coalesce(status, '')) <> 'cancelled'")
    expect(handler).toContain(".in('payment_status', ['Pending_Payment', 'pendiente'])")
    expect(handler).toContain(".neq('status', 'cancelled').lt('created_at', threeDaysAgo.toISOString())")
  })

  it('keeps the detailed analytics RPC additive after the pipeline migration', () => {
    const sql = migration()

    expect(sql).toContain("'payment_status_breakdown'")
    expect(sql).toContain("'return_count'")
    expect(sql).toContain("'cancellation_rate'")
    expect(sql).toContain("'status_by_both'")
  })

  it('does not render missing executive metrics as zero and uses independent trend sources', () => {
    const summary = readProjectFile('src/components/kpi/KPISummaryCards.jsx')
    const trend = readProjectFile('src/components/kpi/KPIStatusTrend.jsx')
    const pipeline = readProjectFile('src/components/kpi/KPIOrderPipeline.jsx')

    expect(summary).toContain("? formatNumber(card.value) : 'N/D'")
    expect(trend).toContain('trends?.created')
    expect(trend).toContain('trends?.delivered')
    expect(pipeline).toContain("in_completed: { label: 'Completadas'")
    expect(pipeline).toContain('Órdenes en curso')
    expect(pipeline).not.toContain("value: 'custom'")
    expect(pipeline).not.toContain('salen')
  })

  it('adds completed orders to the visible pipeline without changing the snapshot active total', () => {
    const sql = completedPipelineMigration()

    expect(sql).toContain("lower(coalesce(status, '')) = 'in_completed'")
    expect(sql).toContain("'open_total', (SELECT count(*) FROM open_orders)")
    expect(sql).toContain("'active_orders', (SELECT count(*) FROM current_orders)")
  })

  it('publishes every KPI source that requires realtime reconciliation', () => {
    const sql = realtimeMigration()
    const hook = readProjectFile('src/hooks/useKPI.js')

    expect(sql).toContain("['order_events', 'profiles', 'clients']")
    expect(hook).toContain("'orders', 'order_events', 'order_production_files', 'profiles', 'clients'")
    expect(hook).toContain("useOrdersRealtimeSync")
    expect(hook).not.toContain("window.addEventListener('focus'")
  })

  it('compares each preset period with an equally sized previous period', async () => {
    const { getComparePeriodBounds, getPeriodBounds } = await import('../utils/kpiHelpers.js')
    const current = getPeriodBounds('week')
    const previous = getComparePeriodBounds('week')

    expect(new Date(current.dateTo) - new Date(current.dateFrom)).toBe(new Date(previous.dateTo) - new Date(previous.dateFrom))
    expect(previous.dateTo).toBe(current.dateFrom)
  })
})
