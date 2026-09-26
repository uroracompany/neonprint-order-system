import { describe, expect, it } from 'vitest'
import { getKpiTabFromSearch, getKpiTabSearch, readKpiWorkspace, writeKpiWorkspace } from '../utils/kpiWorkspace'
import { getAdminTabSearch } from '../utils/adminTabRoute'

const createStorage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

describe('KPI workspace persistence', () => {
  it('keeps the selected KPI section in the route and clears it when leaving KPI', () => {
    const kpiSearch = getKpiTabSearch('?tab=kpi', 'production')
    expect(kpiSearch).toBe('?tab=kpi&kpiTab=production')
    expect(getKpiTabFromSearch(kpiSearch)).toBe('production')
    expect(getAdminTabSearch(kpiSearch, 'materials')).toBe('?tab=materials')
  })

  it('restores period, filters, detail and scroll for the same user session', () => {
    const storage = createStorage()
    writeKpiWorkspace('user-1', {
      activeTab: 'users',
      period: 'custom',
      customDateFrom: '2026-08-01',
      customDateTo: '2026-08-15',
      pipelineFilters: { designType: 'INTERNAL_DESING', orderType: 'orden 911' },
      detail: { type: 'production-employee', employeeId: 'employee-1', areaCode: 'dtf' },
      scrollY: 640,
    }, storage)

    expect(readKpiWorkspace('user-1', storage)).toMatchObject({
      activeTab: 'users',
      period: 'custom',
      pipelineFilters: { designType: 'INTERNAL_DESING', orderType: 'orden 911' },
      detail: { type: 'production-employee', employeeId: 'employee-1', areaCode: 'dtf' },
      scrollY: 640,
    })
  })
})
