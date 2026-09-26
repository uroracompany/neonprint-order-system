/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('alineación visual de las tarjetas KPI de materiales', () => {
  it('reutiliza las reglas canónicas de las tarjetas del resumen ejecutivo', () => {
    const styles = readProjectFile('src/css-components/page-kpi.css')

    expect(styles).toContain('.kpi-executive-overview .kpi-hero-card,\n.kpi-materials-analytics .kpi-materials-metric-card {')
    expect(styles).toContain('.kpi-executive-overview .kpi-hero-icon,\n.kpi-materials-analytics .kpi-hero-icon {')
    expect(styles).not.toContain('.kpi-materials-analytics .kpi-materials-metric-card.is-snapshot')
  })

  it('mantiene los iconos de las siete tarjetas con el tamaño del patrón ejecutivo', () => {
    const component = readProjectFile('src/components/kpi/KPIMaterialsAnalytics.jsx')
    const cardsStart = component.indexOf('<section className="kpi-materials-snapshot"')
    const cardsEnd = component.indexOf('{/* ─── EVOLUTION CHART ─── */}', cardsStart)
    const cardsMarkup = component.slice(cardsStart, cardsEnd)

    expect((cardsMarkup.match(/size=\{18\}/g) || [])).toHaveLength(7)
    expect(cardsMarkup).not.toContain('size={16}')
  })
})
