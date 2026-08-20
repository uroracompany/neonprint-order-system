/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMaterialGlobalBounds, MATERIAL_GLOBAL_START } from '../utils/kpiHelpers'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('ranking de materiales: alcance temporal propio', () => {
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
    expect(component()).toContain("const rankingQuery = useKPISingle('materials_analytics', rankingBounds, userId)")
    expect(component()).toContain("if (rankingPeriod === 'general') return getMaterialGlobalBounds()")
    expect(component()).toContain("import { useKPISingle } from '../../hooks/useKPI'")
  })

  it('inicia en General y ofrece el filtro temporal del ranking', () => {
    expect(component()).toContain("useState('general')")
    expect(component()).toContain('const RANKING_PERIOD_OPTIONS')
    expect(component()).toContain('label="Período del ranking"')
    expect(component()).toContain('value={rankingPeriod}')
    expect(component()).toContain('onChange={changeRankingPeriod}')
  })

  it('deriva resumen, total, comparación y búsqueda del alcance activo', () => {
    expect(component()).toContain('rankingAnalytics?.period?.summary || EMPTY_ARRAY')
    expect(component()).toContain('Number(rankingAnalytics?.period?.material_references || 0)')
    expect(component()).toContain('rankingAnalytics?.comparison?.summary || null')
    expect(component()).toContain('const hasRankingComparison = Boolean(rankingPrevSummary?.length)')
    expect(component()).toContain('filterKpiMaterials(rankingSummary, deferredMaterialSearch)')
  })

  it('en global sin comparación muestra tendencia plana y participación contra el total global', () => {
    expect(component()).toContain("!hasRankingComparison && <span className=\"kpi-materials-ranking-trend is-flat\" role=\"cell\">—</span>")
    expect(component()).toContain('const pct = rankingTotal > 0 ? Math.round((references / rankingTotal) * 100) : 0')
  })

  it('maneja carga y error del histórico global sin mezclar datos del período', () => {
    expect(component()).toContain('Cargando ranking de materiales…')
    expect(component()).toContain('No fue posible actualizar el ranking de materiales.')
    expect(component()).toContain('onClick={rankingQuery.refresh}')
  })

  it('resuelve el detalle con el mismo dataset del ranking', () => {
    expect(component()).toContain('const detailMaterial = detailMaterialKey ? findKpiMaterialByKey(rankingSummary, detailMaterialKey) : null')
    expect(component()).toContain('findKpiMaterialByKey(rankingPrevSummary || EMPTY_ARRAY, detailMaterialKey)')
    expect(component()).toContain('totalReferences={rankingTotal}')
    expect(component()).toContain('periodMeta={rankingAnalytics?.meta || materialMeta}')
  })

  it('comparte los límites globales con el modal de detalle sin duplicar el ancla', () => {
    const modal = readProjectFile('src/components/kpi/MaterialDetailModal.jsx')

    expect(modal).toContain('getMaterialGlobalBounds')
    expect(modal).not.toContain("const GLOBAL_START")
  })
})
