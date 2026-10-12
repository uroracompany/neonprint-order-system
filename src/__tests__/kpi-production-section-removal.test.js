import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getKpiTabFromSearch, getKpiTabSearch, readKpiWorkspace } from '../utils/kpiWorkspace'

const readKpiModule = () => readFileSync(resolve(globalThis.process.cwd(), 'src/components/kpi/KPIModule.jsx'), 'utf8')

describe('KPI production section removal', () => {
  it('removes the production tab and its detail render paths while keeping the executive summary widget', () => {
    const source = readKpiModule()

    expect(source).not.toContain("{ id: 'production', label: 'Producción'")
    expect(source).not.toContain("activeTab === 'production'")
    expect(source).not.toContain("import KPIProductionInsights")
    expect(source).not.toContain('ProductionAreaDetailView')
    expect(source).not.toContain('ProductionEmployeeDetailView')
    expect(source).toContain('<KPIProductionMini data={data} />')
    expect(source).toContain("{ id: 'overview', label: 'Resumen Ejecutivo'")
    expect(source).toContain("{ id: 'orders', label: 'Órdenes'")
  })

  it('normalizes production deep links and saved production details', () => {
    expect(getKpiTabFromSearch('?kpiTab=production')).toBe('overview')
    expect(getKpiTabSearch('?kpiTab=production', 'production')).toBe('')

    const storage = {
      getItem: () => JSON.stringify({
        version: 1,
        userId: 'user-1',
        activeTab: 'production',
        period: 'month',
        customDateFrom: '',
        customDateTo: '',
        pipelineFilters: {},
        detail: { type: 'production-area', id: 'digital' },
        savedAt: Date.now(),
      }),
      removeItem: () => {},
    }

    expect(readKpiWorkspace('user-1', storage)).toMatchObject({ activeTab: 'overview', detail: null })
  })
})
