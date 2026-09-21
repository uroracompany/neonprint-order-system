/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMaterialGlobalBounds, getMaterialPeriodBounds, MATERIAL_TIMEZONE } from '../utils/kpiHelpers'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('modal de material: períodos y fuente del detalle', () => {
  const modal = () => readProjectFile('src/components/kpi/MaterialDetailModal.jsx')

  it('calcula el histórico y períodos de materiales en la zona empresarial', () => {
    const now = new Date('2026-09-20T02:30:00.000Z')
    const global = getMaterialGlobalBounds(now)
    const current = getMaterialPeriodBounds('current', now)

    expect(MATERIAL_TIMEZONE).toBe('America/Asuncion')
    expect(global.date_from).toBe('1970-01-01T00:00:00.000Z')
    expect(global.date_to).toBe('2026-09-20T03:00:00.000Z')
    expect(current.date_from).toBe('2026-09-01T03:00:00.000Z')
    expect(current.date_to).toBe('2026-10-01T03:00:00.000Z')
  })

  it('consulta el histórico solo para catálogo y mantiene el período recibido desde KPI', () => {
    expect(modal()).toContain("source = 'kpi'")
    expect(modal()).toContain("source === 'catalog' ? 'history' : 'current'")
    expect(modal()).toContain("if (periodMode === 'history') return getMaterialGlobalBounds()")
    expect(modal()).toContain("if (periodMode === 'current' && source === 'kpi') return null")
    expect(modal()).toContain("useKPISingle('materials_analytics', requestBounds, userId, shouldQuery)")
  })

  it('usa id estricto, conserva la compatibilidad no ambigua por nombre y no consulta cancelaciones aparte', () => {
    expect(modal()).toContain('normalizeId(row?.material_id) === targetId')
    expect(modal()).toContain('return matches.length === 1 ? matches[0] : null')
    expect(modal()).not.toContain("material_cancellation_stats")
    expect(modal()).toContain('activeMaterial?.cancelled_orders')
  })

  it('consume la granularidad de tendencia enviada por la RPC', () => {
    expect(modal()).toContain("activeMaterial?.trend_granularity || 'day'")
    expect(modal()).toContain('labelFormatter={value => formatTrendPeriod(value, granularity)}')
  })
})
