import { useState } from 'react'
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
import KPIClientAnalytics from './KPIClientAnalytics'
import KPIMaterialsAnalytics from './KPIMaterialsAnalytics'
import KPIUserAnalytics from './KPIUserAnalytics'
import KPIProductionInsights from './KPIProductionInsights'
import KPIAlertsPanel from './KPIAlertsPanel'

const TABS = [
  { id: 'overview', label: 'Resumen Ejecutivo', icon: <Icons.Dashboard /> },
  { id: 'orders', label: 'Órdenes', icon: <Icons.Orders /> },
  { id: 'clients', label: 'Clientes', icon: <Icons.User /> },
  { id: 'materials', label: 'Materiales', icon: <Icons.Package /> },
  { id: 'users', label: 'Usuarios', icon: <Icons.Users /> },
  { id: 'production', label: 'Producción', icon: <Icons.Brush /> },
  { id: 'alerts', label: 'Alertas', icon: <Icons.AlertCircle /> },
]

function CriticalAlertsInline({ alerts }) {
  if (!alerts || alerts.length === 0) return null

  const highAlerts = alerts.filter(a => a.severity === 'high')
  if (highAlerts.length === 0) return null

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Alertas</span>
          <h2 className="kpi-section-title">Alertas Críticas</h2>
          <p className="kpi-section-subtitle">{highAlerts.length} alerta{highAlerts.length !== 1 ? 's' : ''} que requiere{highAlerts.length === 1 ? '' : 'n'} acción inmediata</p>
        </div>
      </div>
      <div className="kpi-alerts-inline">
        {highAlerts.slice(0, 3).map((alert, idx) => (
          <div key={idx} className="kpi-alert-inline high">
            <div className="kpi-alert-inline-icon">
              <Icons.AlertCircle />
            </div>
            <div className="kpi-alert-inline-content">
              <h4 className="kpi-alert-inline-title">{alert.title}</h4>
              <p className="kpi-alert-inline-message">{alert.message}</p>
            </div>
            {alert.action && (
              <span className="kpi-alert-inline-action">{alert.action}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function KPIModule() {
  const {
    data, loading, error, period, setPeriod,
    customDateFrom, setCustomDateFrom,
    customDateTo, setCustomDateTo, refresh,
  } = useKPI()

  const [activeTab, setActiveTab] = useState('overview')

  if (loading && !data) {
    return (
      <section className="pa-section" style={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', border: '3px solid #DDE3EF', borderTopColor: '#06B6D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: '#4A5E80', fontSize: 14, fontWeight: 500 }}>Cargando inteligencia del sistema...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
        period={period}
        setPeriod={setPeriod}
        customDateFrom={customDateFrom}
        setCustomDateFrom={setCustomDateFrom}
        customDateTo={customDateTo}
        setCustomDateTo={setCustomDateTo}
        onRefresh={refresh}
      />

      <div className="kpi-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`kpi-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <KPISummaryCards data={data} />
          <KPIOrderPipeline data={data} />
          <KPIProductionMini data={data} />
          <KPIStatusTrend data={data} />
          <KPICreditsSummary data={data} />
          <KPIQualityMetrics data={data} />
          <CriticalAlertsInline alerts={data?.smart_alerts} />
        </>
      )}

      {activeTab === 'orders' && <KPIOrdersAnalytics data={data} />}
      {activeTab === 'clients' && <KPIClientAnalytics data={data} />}
      {activeTab === 'materials' && <KPIMaterialsAnalytics data={data} />}
      {activeTab === 'users' && <KPIUserAnalytics data={data} />}
      {activeTab === 'production' && <KPIProductionInsights data={data} />}
      {activeTab === 'alerts' && <KPIAlertsPanel data={data} />}
    </section>
  )
}
