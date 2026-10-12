import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getKpiTabFromSearch, getKpiTabSearch, readKpiWorkspace } from '../utils/kpiWorkspace'

const readKpiModule = () => readFileSync(resolve(globalThis.process.cwd(), 'src/components/kpi/KPIModule.jsx'), 'utf8')

describe('KPI client section removal', () => {
  it('removes the Clientes tab and render path from the KPI module', () => {
    const source = readKpiModule()

    expect(source).not.toContain("import KPIClientAnalytics from './KPIClientAnalytics'")
    expect(source).not.toContain("{ id: 'clients', label: 'Clientes'")
    expect(source).not.toContain("activeTab === 'clients'")
  })

  it('normalizes old client deep links and saved workspaces to overview', () => {
    expect(getKpiTabFromSearch('?kpiTab=clients')).toBe('overview')
    expect(getKpiTabSearch('?kpiTab=clients', 'clients')).toBe('')

    const storage = {
      getItem: () => JSON.stringify({
        version: 1,
        userId: 'user-1',
        activeTab: 'clients',
        period: 'month',
        customDateFrom: '',
        customDateTo: '',
        pipelineFilters: {},
        savedAt: Date.now(),
      }),
      removeItem: () => {},
    }

    expect(readKpiWorkspace('user-1', storage).activeTab).toBe('overview')
  })
})
