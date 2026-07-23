import { useState, useCallback } from 'react'
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
import { SellerDetailView } from './KPISellerIntelligence'
import { DesignerDetailView } from './KPIDesignIntelligence'
import { QuoteDetailView } from './KPIQuoteIntelligence'
import { ProductionAreaDetailView, ProductionEmployeeDetailView } from './KPIProductionIntelligence'
import { DeliveryDetailView } from './KPIDeliveryIntelligence'

const TABS = [
  { id: 'overview', label: 'Resumen Ejecutivo', icon: <Icons.Dashboard /> },
  { id: 'orders', label: 'Órdenes', icon: <Icons.Orders /> },
  { id: 'clients', label: 'Clientes', icon: <Icons.User /> },
  { id: 'materials', label: 'Materiales', icon: <Icons.Package /> },
  { id: 'users', label: 'Empleados', icon: <Icons.Users /> },
  { id: 'production', label: 'Producción', icon: <Icons.Brush /> },
  { id: 'alerts', label: 'Alertas', icon: <Icons.AlertCircle /> },
]

function CriticalAlertsInline({ alerts }) {
  if (!alerts || alerts.length === 0) return null

  const highAlerts = alerts.filter(a => ['critical', 'high'].includes(a.severity))
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
              <p className="kpi-alert-inline-message">{alert.description || alert.message}</p>
            </div>
            {(alert.recommended_action || alert.action) && (
              <span className="kpi-alert-inline-action">{alert.recommended_action || alert.action}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function KPIModule() {
  const {
    data, loading, error, refresh, period, customDateFrom, customDateTo,
  } = useKPI()

  const [activeTab, setActiveTab] = useState('overview')
  const [sellerDetailId, setSellerDetailId] = useState(null)
  const [designerDetailId, setDesignerDetailId] = useState(null)
  const [quoteDetailId, setQuoteDetailId] = useState(null)
  const [productionAreaCode, setProductionAreaCode] = useState(null)
  const [productionEmployeeDetail, setProductionEmployeeDetail] = useState(null)
  const [deliveryUserId, setDeliveryUserId] = useState(null)

  const getDateBounds = useCallback(() => {
    if (period === 'custom' && customDateFrom && customDateTo) {
      return { date_from: customDateFrom, date_to: customDateTo }
    }
    const now = new Date()
    let start, end
    switch (period) {
      case 'today': {
        start = new Date(now)
        start.setHours(0, 0, 0, 0)
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
        break
      }
      case 'week': {
        start = new Date(now)
        start.setDate(now.getDate() - now.getDay())
        start.setHours(0, 0, 0, 0)
        end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      }
      case 'year':
        start = new Date(now.getFullYear(), 0, 1)
        end = new Date(now.getFullYear() + 1, 0, 1)
        break
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    }
    return { date_from: start.toISOString(), date_to: end.toISOString() }
  }, [period, customDateFrom, customDateTo])

  const handleSellerClick = useCallback((sellerId) => { setSellerDetailId(sellerId) }, [])
  const handleSellerBack = useCallback(() => { setSellerDetailId(null) }, [])
  const handleDesignerClick = useCallback((designerId) => { setDesignerDetailId(designerId) }, [])
  const handleDesignerBack = useCallback(() => { setDesignerDetailId(null) }, [])
  const handleQuoteClick = useCallback((quoteId) => { setQuoteDetailId(quoteId) }, [])
  const handleQuoteBack = useCallback(() => { setQuoteDetailId(null) }, [])
  const handleProductionAreaClick = useCallback((areaCode) => { setProductionAreaCode(areaCode) }, [])
  const handleProductionAreaBack = useCallback(() => { setProductionAreaCode(null); setProductionEmployeeDetail(null) }, [])
  const handleProductionEmployeeClick = useCallback((employeeId, areaCode) => {
    setProductionEmployeeDetail({ employeeId, areaCode })
  }, [])
  const handleProductionEmployeeBack = useCallback(() => { setProductionEmployeeDetail(null) }, [])
  const handleDeliveryUserClick = useCallback((userId) => { setDeliveryUserId(userId) }, [])
  const handleDeliveryUserBack = useCallback(() => { setDeliveryUserId(null) }, [])
  const handleAlertTarget = useCallback((target = {}) => {
    const module = String(target.module || '').toLowerCase()
    const tabMap = {
      orders: 'orders',
      clients: 'clients',
      materials: 'materials',
      users: 'users',
      production: 'production',
      delivery: 'overview',
      credits: 'overview',
      sales: 'orders',
      overview: 'overview',
    }
    setActiveTab(tabMap[module] || 'overview')
    setSellerDetailId(null)
    setDesignerDetailId(null)
    setQuoteDetailId(null)
    setProductionAreaCode(null)
    setProductionEmployeeDetail(null)
    setDeliveryUserId(null)
  }, [])

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
      {sellerDetailId ? (
        <SellerDetailView sellerId={sellerDetailId} getDateBounds={getDateBounds} onBack={handleSellerBack} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
      ) : designerDetailId ? (
        <DesignerDetailView designerId={designerDetailId} onBack={handleDesignerBack} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
      ) : quoteDetailId ? (
        <QuoteDetailView quoteId={quoteDetailId} onBack={handleQuoteBack} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
      ) : productionEmployeeDetail ? (
        <ProductionEmployeeDetailView
          employeeId={productionEmployeeDetail.employeeId}
          areaCode={productionEmployeeDetail.areaCode}
          onBack={handleProductionEmployeeBack}
          period={period}
          customDateFrom={customDateFrom}
          customDateTo={customDateTo}
        />
      ) : productionAreaCode ? (
        <ProductionAreaDetailView
          areaCode={productionAreaCode}
          onBack={handleProductionAreaBack}
          onEmployeeClick={handleProductionEmployeeClick}
          period={period}
          customDateFrom={customDateFrom}
          customDateTo={customDateTo}
        />
      ) : deliveryUserId ? (
        <DeliveryDetailView deliveryUserId={deliveryUserId} onBack={handleDeliveryUserBack} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
      ) : (
        <>
          <KPIHeader
            onRefresh={refresh}
            loading={loading}
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
            <div className="kpi-tab-content" key="overview">
              <KPISummaryCards data={data} />
              <KPIOrderPipeline data={data} />
              <KPIProductionMini data={data} />
              <KPIStatusTrend data={data} />
              <KPICreditsSummary data={data} />
              <KPIQualityMetrics data={data} />
              <CriticalAlertsInline alerts={data?.alerts_center?.alerts || data?.smart_alerts} />
            </div>
          )}

          {activeTab === 'orders' && <div className="kpi-tab-content" key="orders"><KPIOrdersAnalytics data={data} /></div>}
          {activeTab === 'clients' && <div className="kpi-tab-content" key="clients"><KPIClientAnalytics data={data} /></div>}
          {activeTab === 'materials' && <div className="kpi-tab-content" key="materials"><KPIMaterialsAnalytics data={data} /></div>}
          {activeTab === 'users' && <div className="kpi-tab-content" key="users"><KPIUserAnalytics data={data} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} onSellerClick={handleSellerClick} onDesignerClick={handleDesignerClick} onQuoteClick={handleQuoteClick} onProductionAreaClick={handleProductionAreaClick} onProductionEmployeeClick={handleProductionEmployeeClick} onDeliveryUserClick={handleDeliveryUserClick} /></div>}
          {activeTab === 'production' && <div className="kpi-tab-content" key="production"><KPIProductionInsights data={data} onAreaClick={handleProductionAreaClick} /></div>}
          {activeTab === 'alerts' && <div className="kpi-tab-content" key="alerts"><KPIAlertsPanel data={data} onNavigateTarget={handleAlertTarget} /></div>}
        </>
      )}
    </section>
  )
}
