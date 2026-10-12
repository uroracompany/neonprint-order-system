import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const read = file => readFileSync(resolve(process.cwd(), file), 'utf8')
const dashboard = read('src/pages/dashboard.jsx')
const overview = read('src/components/kpi/MaterialAnalyticsOverviewModal.jsx')

describe('Administración > Materiales analytics contract', () => {
  it('carga el detalle y resumen de forma diferida y ofrece actividad para Materiales y Terminaciones', () => {
    expect(dashboard).toContain('lazy(() => import("../components/kpi/MaterialDetailModal"))')
    expect(dashboard).toContain('lazy(() => import("../components/kpi/MaterialAnalyticsOverviewModal"))')
    expect(dashboard).toContain('Estadísticas generales')
    expect(dashboard).toContain('className="acm-heading-actions"')
    expect(dashboard).toContain('aria-label={`Ver actividad de ${mat.name}`}')
    expect(dashboard).toContain('setSelectedMaterialAnalytics({ material_id: mat.id, name: mat.name })')
    expect(dashboard).toContain('aria-label={`Ver actividad de ${termination.name}`}')
    expect(dashboard).toContain('setSelectedTerminationAnalytics({')
    expect(dashboard).toContain('<TerminationDetailModal')
  })

  it('deriva el resumen exclusivamente de materials_analytics y no lo presenta como inventario', () => {
    expect(overview).toContain("useKPISingle('materials_analytics'")
    expect(overview).toContain('no representa stock, consumo físico ni disponibilidad de inventario')
    expect(overview).not.toContain('material menos utilizado')
    expect(overview).not.toContain('Cliente que utiliza más')
  })
})
