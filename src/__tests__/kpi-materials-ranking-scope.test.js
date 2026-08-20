/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMaterialGlobalBounds, MATERIAL_GLOBAL_START } from '../utils/kpiHelpers'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('ranking de materiales: alcance global por defecto con filtro global/período', () => {
  const component = () => readProjectFile('src/components/kpi/KPIMaterialsAnalytics.jsx')

  it('define los límites globales con el ancla de todo el historial y comparación vacía', () => {
    const bounds = getMaterialGlobalBounds()

    expect(bounds.date_from).toBe('1970-01-01T00:00:00.000Z')
    expect(bounds.compare_from).toBe(MATERIAL_GLOBAL_START)
    expect(bounds.compare_to).toBe(MATERIAL_GLOBAL_START)
    expect(new Date(bounds.date_to).getTime()).toBeGreaterThan(Date.now())
    expect(bounds.date_to).not.toBe(bounds.date_from)
  })

  it('consulta el histórico global mediante useKPISingle con los límites compartidos', () => {
    expect(component()).toContain("useKPISingle('materials_analytics', getMaterialGlobalBounds(), userId, rankingScope === 'global')")
    expect(component()).toContain("import { useKPISingle } from '../../hooks/useKPI'")
  })

  it('muestra el ranking global por defecto y ofrece el filtro global/período', () => {
    expect(component()).toContain("useState('global')")
    expect(component()).toContain('aria-label="Alcance del ranking de materiales"')
    expect(component()).toContain("aria-pressed={rankingScope === 'global'}")
    expect(component()).toContain("aria-pressed={rankingScope === 'period'}")
    expect(component()).toContain("onClick={() => changeRankingScope('global')}")
    expect(component()).toContain("onClick={() => changeRankingScope('period')}")
    expect(component()).toContain('rankingScope === \'global\' ? \'Materiales con mayor número de referencias en todo el historial registrado.')
  })

  it('deriva resumen, total, comparación y búsqueda del alcance activo', () => {
    expect(component()).toContain('rankingGlobalQuery.data?.period?.summary || EMPTY_ARRAY')
    expect(component()).toContain('Number(rankingGlobalQuery.data?.period?.material_references || 0)')
    expect(component()).toContain('rankingGlobalQuery.data?.comparison?.summary || null')
    expect(component()).toContain('const hasRankingComparison = Boolean(rankingPrevSummary?.length)')
    expect(component()).toContain('filterKpiMaterials(rankingSummary, deferredMaterialSearch)')
  })

  it('en global sin comparación muestra tendencia plana y participación contra el total global', () => {
    expect(component()).toContain("!hasRankingComparison && <span className=\"kpi-materials-ranking-trend is-flat\" role=\"cell\">—</span>")
    expect(component()).toContain('const pct = rankingTotal > 0 ? Math.round((references / rankingTotal) * 100) : 0')
  })

  it('maneja carga y error del histórico global sin mezclar datos del período', () => {
    expect(component()).toContain('Cargando histórico de materiales…')
    expect(component()).toContain('No fue posible obtener el histórico global de materiales.')
    expect(component()).toContain('onClick={rankingGlobalQuery.refresh}')
  })

  it('mantiene el detalle del material en el período del módulo para el modal', () => {
    expect(component()).toContain('const detailMaterial = detailMaterialKey ? findKpiMaterialByKey(summary, detailMaterialKey) : null')
    expect(component()).toContain('totalReferences={totalCurrent}')
  })

  it('comparte los límites globales con el modal de detalle sin duplicar el ancla', () => {
    const modal = readProjectFile('src/components/kpi/MaterialDetailModal.jsx')

    expect(modal).toContain('getMaterialGlobalBounds')
    expect(modal).not.toContain("const GLOBAL_START")
  })
})