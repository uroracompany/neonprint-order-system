/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('KPI Materiales: controles y comparación', () => {
  const component = () => readProjectFile('src/components/kpi/KPIMaterialsAnalytics.jsx')
  const styles = () => readProjectFile('src/css-components/page-kpi.css')

  it('conserva el selector de evolución dentro de la tarjeta de gráfica', () => {
    const source = component()
    const chartStart = source.indexOf('className="kpi-card kpi-materials-chart-card"')
    const chartEnd = source.indexOf('<MaterialsComparisonPanel', chartStart)
    const chartMarkup = source.slice(chartStart, chartEnd)

    expect(chartMarkup).toContain('className="kpi-materials-evolution-filter"')
    expect(chartMarkup).toContain('searchable')
    expect(chartMarkup).not.toContain('<span>Material</span>')
  })

  it('mantiene el ranking completo como disparador accesible del modal', () => {
    const source = component()
    const css = styles()

    expect(source).toContain('kpi-materials-ranking-row is-interactive')
    expect(source).toContain('aria-label={`Ver detalle de ${m.name}`}')
    expect(source).toContain("event.key === 'Enter' || event.key === ' '")
    expect(css).toContain('.kpi-materials-ranking-row.is-interactive { cursor: pointer; }')
  })

  it('incorpora tres métricas gráficas y visualizaciones adecuadas', () => {
    const comparison = readProjectFile('src/components/kpi/MaterialsComparisonPanel.jsx')
    const css = styles()

    expect(comparison).toContain("references: { label: 'Referencias registradas'")
    expect(comparison).toContain("orders: { label: 'Órdenes con material'")
    expect(comparison).toContain("variety: { label: 'Variedad de materiales'")
    expect(comparison).toContain('<ComposedChart')
    expect(comparison).toContain('<BarChart')
    const colorLogic = readProjectFile('src/utils/materialsComparisonColors.js')
    expect(colorLogic).toContain('NEGATIVE_COMPARISON_SCALE')
    expect(colorLogic).toContain('getComparisonDelta')
    expect(colorLogic).toContain('getComparisonColor')
    expect(colorLogic).toContain('getPreviousPeriodPeak')
    expect(comparison).toContain('currentGradientStops')
    const chartRows = readProjectFile('src/utils/materialsComparisonChart.js')
    expect(chartRows).toContain('comparisonReference: previousPeak')
    expect(comparison).toContain('materials-period-current-stroke')
    expect(comparison).toContain('kpi-materials-comparison-shares')
    expect(comparison).toContain('type="monotone" dataKey="periodA"')
    expect(comparison).not.toContain('type="step"')
    expect(comparison).toContain('getComparePeriodBounds')
    expect(css).toContain('.kpi-materials-comparison-chart-tabs')
    expect(css).toContain('.kpi-materials-comparison-chart-canvas')
  })

  it('mantiene el acento principal y los controles responsive', () => {
    const source = component()
    const css = styles()

    expect(source).toContain("cyan: '#2454D9'")
    expect(css).toContain('--kpi-materials-accent: #2454d9;')
    expect(css).toContain('.kpi-materials-comparison-chart { padding: 14px; }')
    expect(css).toContain('.kpi-materials-compare-date-grid.is-equivalent')
  })

  it('mantiene el ranking como única vista de detalle de materiales', () => {
    const source = component()

    expect(source).toContain('aria-label="Ranking de materiales"')
    expect(source).not.toContain("detailTab === 'heatmap'")
    expect(source).not.toContain("detailTab === 'alerts'")
    expect(source).not.toContain("['heatmap', 'Heatmap']")
    expect(source).not.toContain("['alerts', 'Alertas']")
  })
})
