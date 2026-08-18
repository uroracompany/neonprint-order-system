export const KPI_TAB_PARAM = 'kpiTab'
export const KPI_DEFAULT_TAB = 'overview'

const STORAGE_VERSION = 1
const MAX_AGE_MS = 12 * 60 * 60 * 1000
const KPI_TABS = new Set(['overview', 'orders', 'clients', 'materials', 'users', 'production', 'alerts'])
const DETAIL_TYPES = new Set(['seller', 'designer', 'quote', 'production-area', 'production-employee', 'delivery-user'])

const storageKey = userId => `neonprint:kpi-workspace:v${STORAGE_VERSION}:${userId}`
const stringValue = value => typeof value === 'string' ? value : ''

export function getKpiTabFromSearch(search = '') {
  const tab = new URLSearchParams(search).get(KPI_TAB_PARAM)
  return KPI_TABS.has(tab) ? tab : KPI_DEFAULT_TAB
}

export function getKpiTabSearch(search = '', tab = KPI_DEFAULT_TAB) {
  const params = new URLSearchParams(search)
  if (!KPI_TABS.has(tab) || tab === KPI_DEFAULT_TAB) params.delete(KPI_TAB_PARAM)
  else params.set(KPI_TAB_PARAM, tab)
  const nextSearch = params.toString()
  return nextSearch ? `?${nextSearch}` : ''
}

function normalizeDetail(detail) {
  if (!detail || !DETAIL_TYPES.has(detail.type)) return null
  if (detail.type === 'production-employee') {
    return detail.employeeId && detail.areaCode ? { type: detail.type, employeeId: detail.employeeId, areaCode: detail.areaCode } : null
  }
  return detail.id ? { type: detail.type, id: detail.id } : null
}

export function readKpiWorkspace(userId, storage = globalThis.sessionStorage) {
  if (!userId || !storage) return null
  try {
    const raw = storage.getItem(storageKey(userId))
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (saved?.version !== STORAGE_VERSION || saved?.userId !== userId || !Number.isFinite(saved?.savedAt) || Date.now() - saved.savedAt > MAX_AGE_MS) {
      storage.removeItem(storageKey(userId))
      return null
    }
    return {
      activeTab: KPI_TABS.has(saved.activeTab) ? saved.activeTab : KPI_DEFAULT_TAB,
      period: ['today', 'week', 'month', 'year', 'custom'].includes(saved.period) ? saved.period : 'month',
      customDateFrom: stringValue(saved.customDateFrom),
      customDateTo: stringValue(saved.customDateTo),
      pipelineFilters: {
        designType: stringValue(saved.pipelineFilters?.designType) || 'all',
        orderType: stringValue(saved.pipelineFilters?.orderType) || 'all',
      },
      detail: normalizeDetail(saved.detail),
      scrollY: Number.isFinite(saved.scrollY) && saved.scrollY >= 0 ? saved.scrollY : 0,
    }
  } catch {
    return null
  }
}

export function writeKpiWorkspace(userId, workspace, storage = globalThis.sessionStorage) {
  if (!userId || !workspace || !storage) return
  try {
    storage.setItem(storageKey(userId), JSON.stringify({
      version: STORAGE_VERSION,
      userId,
      activeTab: KPI_TABS.has(workspace.activeTab) ? workspace.activeTab : KPI_DEFAULT_TAB,
      period: workspace.period,
      customDateFrom: stringValue(workspace.customDateFrom),
      customDateTo: stringValue(workspace.customDateTo),
      pipelineFilters: {
        designType: stringValue(workspace.pipelineFilters?.designType) || 'all',
        orderType: stringValue(workspace.pipelineFilters?.orderType) || 'all',
      },
      detail: normalizeDetail(workspace.detail),
      scrollY: Number.isFinite(workspace.scrollY) && workspace.scrollY >= 0 ? workspace.scrollY : 0,
      savedAt: Date.now(),
    }))
  } catch {
    // The KPI remains usable when browser session storage is unavailable.
  }
}
