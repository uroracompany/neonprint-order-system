import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { getKpiTabFromSearch, getKpiTabSearch } from '../utils/kpiWorkspace'

const moduleSource = readFileSync(resolve(process.cwd(), 'src/components/kpi/KPIModule.jsx'), 'utf8')

describe('KPI alerts removal', () => {
  it('does not expose alerts as a KPI tab or overview panel', () => {
    expect(moduleSource).not.toContain("KPIAlertsPanel from './KPIAlertsPanel'")
    expect(moduleSource).not.toContain("{ id: 'alerts', label: 'Alertas'")
    expect(moduleSource).not.toContain('<CriticalAlertsInline')
  })

  it('sends legacy alerts links and saved workspace state to the overview', () => {
    expect(getKpiTabFromSearch('?kpiTab=alerts')).toBe('overview')
    expect(getKpiTabSearch('?kpiTab=alerts', 'alerts')).toBe('')
  })
})
