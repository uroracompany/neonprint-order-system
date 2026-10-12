import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useKPI } from '../../hooks/useKPI'
import { Icons } from '../../utils/icons'
import KPIHeader from './KPIHeader'
import KPISummaryCards from './KPISummaryCards'
import KPIOrderPipeline from './KPIOrderPipeline'
import KPIProductionMini from './KPIProductionMini'
import KPIStatusTrend from './KPIStatusTrend'
import KPICreditsSummary from './KPICreditsSummary'
import KPIQualityMetrics from './KPIQualityMetrics'
import KPIOrdersAnalytics from './KPIOrdersAnalytics'
import { getKpiTabFromSearch, getKpiTabSearch, KPI_TAB_PARAM, readKpiWorkspace, writeKpiWorkspace } from '../../utils/kpiWorkspace'
import '../../css-components/page-kpi.css'

const TABS = [
  { id: 'overview', label: 'Resumen Ejecutivo', icon: <Icons.Dashboard /> },
  { id: 'orders', label: 'Órdenes', icon: <Icons.Orders /> },
]

export default function KPIModule({ userId }) {
  const location = useLocation()
  const navigate = useNavigate()
  const initialWorkspace = useMemo(() => readKpiWorkspace(userId), [userId])
  const hasRouteKpiTab = new URLSearchParams(location.search).has(KPI_TAB_PARAM)
  const {
    data, loading, error, refresh, period, setPeriod, customDateFrom, customDateTo,
  } = useKPI(initialWorkspace || {}, userId)

  const [activeTab, setActiveTab] = useState(() => hasRouteKpiTab ? getKpiTabFromSearch(location.search) : initialWorkspace?.activeTab || 'overview')
  const [pipelineFilters, setPipelineFilters] = useState(() => initialWorkspace?.pipelineFilters || { designType: 'all', orderType: 'all' })
  const scrollYRef = useRef(initialWorkspace?.scrollY || 0)
  const restoredScrollRef = useRef(false)
  const restoredWorkspaceUserRef = useRef(null)

  const selectKpiTab = useCallback((nextTab, { replace = false } = {}) => {
    setActiveTab(nextTab)
    const nextSearch = getKpiTabSearch(location.search, nextTab)
    if (nextSearch !== location.search) navigate({ pathname: location.pathname, search: nextSearch }, { replace })
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    if (!userId || restoredWorkspaceUserRef.current === userId) return
    restoredWorkspaceUserRef.current = userId
    const restored = readKpiWorkspace(userId)
    if (!restored) return
    if (!new URLSearchParams(location.search).has(KPI_TAB_PARAM)) setActiveTab(restored.activeTab)
    setPeriod(restored.period, restored.customDateFrom, restored.customDateTo)
    setPipelineFilters(restored.pipelineFilters)
    scrollYRef.current = restored.scrollY
  }, [location.search, setPeriod, userId])

  useEffect(() => {
    if (!new URLSearchParams(location.search).has(KPI_TAB_PARAM)) return
    const normalizedTab = getKpiTabFromSearch(location.search)
    setActiveTab(normalizedTab)
    const nextSearch = getKpiTabSearch(location.search, normalizedTab)
    if (nextSearch !== location.search) navigate({ pathname: location.pathname, search: nextSearch }, { replace: true })
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    const persistWorkspace = () => writeKpiWorkspace(userId, {
      activeTab,
      period,
      customDateFrom,
      customDateTo,
      pipelineFilters,
      scrollY: scrollYRef.current,
    })
    const captureScroll = () => { scrollYRef.current = window.scrollY }
    persistWorkspace()
    window.addEventListener('scroll', captureScroll, { passive: true })
    window.addEventListener('pagehide', persistWorkspace)
    document.addEventListener('visibilitychange', persistWorkspace)
    return () => {
      captureScroll()
      persistWorkspace()
      window.removeEventListener('scroll', captureScroll)
      window.removeEventListener('pagehide', persistWorkspace)
      document.removeEventListener('visibilitychange', persistWorkspace)
    }
  }, [activeTab, customDateFrom, customDateTo, period, pipelineFilters, userId])

  useEffect(() => {
    if (restoredScrollRef.current || loading || !data) return
    restoredScrollRef.current = true
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollYRef.current, behavior: 'auto' }))
  }, [data, loading])

  if (loading && !data) {
    return (
      <section className="pa-section" style={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="kpi-spinner" />
          <p style={{ color: '#4A5E80', fontSize: 14, fontWeight: 500 }}>Cargando inteligencia del sistema...</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="pa-section">
        <div className="kpi-card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icons.AlertCircle style={{ color: '#EF4444' }} />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#991B1B', marginBottom: 8 }}>Error al cargar datos</h3>
          <p style={{ fontSize: 13, color: '#8899B5', marginBottom: 20 }}>{error}</p>
          <button className="kpi-btn primary" onClick={refresh}>Reintentar</button>
        </div>
      </section>
    )
  }

  return (
    <section className="pa-section">
      <KPIHeader
        meta={data?.executive_summary?.meta}
      />

      <div className="kpi-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => selectKpiTab(tab.id)}
            className={`kpi-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="kpi-tab-content kpi-executive-overview" key="overview">
          <KPISummaryCards data={data} />
          <KPIOrderPipeline data={data} filters={pipelineFilters} onFiltersChange={setPipelineFilters} />
          <KPIProductionMini data={data} />
          <KPIStatusTrend data={data} />
          <KPICreditsSummary data={data} />
          <KPIQualityMetrics data={data} />
        </div>
      )}

      {activeTab === 'orders' && <div className="kpi-tab-content" key="orders"><KPIOrdersAnalytics data={data} /></div>}
    </section>
  )
}
