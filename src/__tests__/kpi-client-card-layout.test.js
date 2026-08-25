import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(resolve(process.cwd(), path), 'utf8')
const clientAnalytics = readProjectFile('src/components/kpi/KPIClientAnalytics.jsx')
const styles = readProjectFile('src/css-components/page-kpi.css')

describe('tarjetas superiores de Clientes KPI', () => {
  it('ancla los filtros en el extremo superior derecho de cada tarjeta', () => {
    expect(styles).toContain('.kpi-client-overview .kpi-hero-card {\n  position: relative;')
    expect(styles).toContain('.kpi-client-overview .kpi-hero-filter {\n  position: absolute;\n  right: 18px;\n  top: 18px;')
  })

  it('no muestra subtítulos debajo del resultado de las tarjetas', () => {
    const cardBlocks = clientAnalytics.match(/<article key=\{c\.id\} className="kpi-hero-card">[\s\S]*?<\/article>/g) || []

    expect(cardBlocks).toHaveLength(2)
    cardBlocks.forEach(block => expect(block).not.toContain('kpi-hero-subtitle'))
  })

  it('usa el azul aprobado solo dentro del apartado de Clientes KPI', () => {
    expect(clientAnalytics).toContain("iconColor: '#1E40AF'")
    expect(clientAnalytics).toContain("cyan: '#1E40AF'")
    expect(styles).toContain('.kpi-client-workspace-tabs button.is-active { border-color: #1e40af; color: #1e40af;')
    expect(styles).toContain('.kpi-client-workspace-metric.is-cyan .kpi-client-metric-icon { background: rgba(30, 64, 175, .1); color: #1e40af; }')
  })

  it('mantiene los estados de pago del modal dentro de cada fila', () => {
    expect(styles).toContain('.kpi-payment-item { align-items: center; box-sizing: border-box; display: flex; gap: 12px; min-width: 0; overflow: hidden; padding: 12px 16px; width: 100%; }')
    expect(styles).toContain('.kpi-payment-value { flex: 0 0 auto; padding-left: 12px;')
  })
})
