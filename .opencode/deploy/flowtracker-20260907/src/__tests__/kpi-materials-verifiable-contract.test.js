/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('contrato verificable de KPI Materiales', () => {
  const migration = () => readProjectFile('supabase/migrations/20260815030000_verified_materials_kpis.sql')

  it('distingue órdenes con material de referencias de material', () => {
    const sql = migration()

    expect(sql).toContain("'orders_with_material'")
    expect(sql).toContain("'material_references'")
    expect(sql).toContain('count(DISTINCT r.order_id)')
    expect(sql).toContain("regexp_split_to_table(coalesce(o.material, ''), '[,;/|]+')")
  })

  it('atribuye cancelaciones únicamente a transiciones auditables del período', () => {
    const sql = migration()

    expect(sql).toContain("lower(coalesce(e.new_status, '')) = 'cancelled'")
    expect(sql).toContain("lower(coalesce(e.old_status, '')) <> 'cancelled'")
    expect(sql).toContain('count(DISTINCT r.order_id) AS cancelled_orders')
    expect(sql).toContain("'cancellation_events_auditable'")
  })

  it('expone cobertura y evita afirmar inventario inexistente', () => {
    const sql = migration()
    const component = readProjectFile('src/components/kpi/KPIMaterialsAnalytics.jsx')

    expect(sql).toContain("'material_assignment_history_available', false")
    expect(sql).toContain("'unrecognized_period_references'")
    expect(component).toContain('no representa stock, consumo físico ni disponibilidad de inventario')
    expect(component).toContain('Cancelaciones auditables')
    expect(component).not.toContain('Tasa de Cancelación')
  })

  it('conecta el handler al RPC estable de materiales', () => {
    const handler = readProjectFile('server/kpi-data-handler.js')

    expect(handler).toContain("supabase.rpc('kpi_materials_analytics'")
    expect(handler).toContain('materials_analytics: materialAnalytics.data || null')
  })

  it('expone el desglose de orden y vendedores requerido por el detalle del material', () => {
    const sql = migration()

    expect(sql).toContain("coalesce(seller_id, created_by) AS seller_id")
    expect(sql).toContain("'internal_design_orders'")
    expect(sql).toContain("'external_design_orders'")
    expect(sql).toContain("'top_sellers'")
    expect(sql).toContain("p.role = 'seller'")
  })

  it('expone combinaciones de prioridad y origen para comparar órdenes filtradas', () => {
    const sql = migration()

    expect(sql).toContain("'normal_internal_orders'")
    expect(sql).toContain("'normal_external_orders'")
    expect(sql).toContain("'urgent_internal_orders'")
    expect(sql).toContain("'urgent_external_orders'")
    expect(sql).toContain("o.order_design_type")
  })
})
