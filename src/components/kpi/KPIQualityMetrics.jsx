import { Icons } from '../../utils/icons'
import { formatNumber, formatPercent, getTrendConfig } from '../../utils/kpiHelpers'

export default function KPIQualityMetrics({ data }) {
  if (!data) return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Calidad</span>
          <h2 className="kpi-section-title">Calidad y Equipo</h2>
          <p className="kpi-section-subtitle">Indicadores de calidad del servicio y rendimiento del equipo</p>
        </div>
      </div>
      <div className="kpi-empty-state">
        <div className="kpi-empty-icon"><Icons.Clipboard size={28} /></div>
        <div className="kpi-empty-title">Sin datos disponibles</div>
        <div className="kpi-empty-message">Los datos de calidad aún no están disponibles. Intenta refrescar el panel.</div>
      </div>
    </div>
  )

  const current = data.business_summary?.current || {}
  const previous = data.business_summary?.previous || {}
  const clientAnalytics = data.client_analytics || {}
  const userAnalytics = data.user_analytics || {}
  const ordersAnalytics = data.orders_analytics || {}

  const cancellationRate = ordersAnalytics.cancellation_rate || 0
  const returnCount = ordersAnalytics.return_count || 0
  const retentionRate = clientAnalytics.retention_rate?.rate || 0
  const sellers = userAnalytics.sellers || []
  const designers = userAnalytics.designers || []
  const topSeller = sellers[0] || null
  const topDesigner = designers[0] || null
  const topClients = clientAnalytics.top_clients || []
  const topClient = topClients[0] || null
  const inactiveUsers = userAnalytics.inactive_users || []

  const cancelTrend = getTrendConfig(
    current.cancelled_orders || 0,
    previous.cancelled_orders || 0
  )

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Calidad</span>
          <h2 className="kpi-section-title">Calidad y Equipo</h2>
          <p className="kpi-section-subtitle">Indicadores de calidad del servicio y rendimiento del equipo</p>
        </div>
      </div>

      <div className="kpi-quality-grid">
        <div className="kpi-quality-metrics-row">
          <div className="kpi-quality-metric">
            <div className="kpi-quality-metric-header">
              <div className="kpi-quality-metric-icon" style={{ background: '#091127', color: '#ffffff' }}>
                <Icons.AlertCircle />
              </div>
              <span className="kpi-quality-metric-label">Cancelación</span>
            </div>
            <div className="kpi-quality-metric-value">
              {formatPercent(cancellationRate)}
            </div>
            <div className="kpi-quality-metric-trend" style={{ color: cancelTrend.color }}>
              <span>{cancelTrend.arrow}</span>
              {cancelTrend.change !== '0.0' && <span>{Math.abs(cancelTrend.change)}%</span>}
            </div>
          </div>

          <div className="kpi-quality-metric">
            <div className="kpi-quality-metric-header">
              <div className="kpi-quality-metric-icon" style={{ background: '#091127', color: '#ffffff' }}>
                <Icons.Refresh />
              </div>
              <span className="kpi-quality-metric-label">Devoluciones</span>
            </div>
            <div className="kpi-quality-metric-value">
              {formatNumber(returnCount)}
            </div>
            <div className="kpi-quality-metric-trend" style={{ color: '#6B7280' }}>
              Órdenes devueltas
            </div>
          </div>

          <div className="kpi-quality-metric">
            <div className="kpi-quality-metric-header">
              <div className="kpi-quality-metric-icon" style={{ background: '#091127', color: '#ffffff' }}>
                <Icons.Users />
              </div>
              <span className="kpi-quality-metric-label">Retención</span>
            </div>
            <div className="kpi-quality-metric-value">
              {formatPercent(retentionRate)}
            </div>
            <div className="kpi-quality-metric-trend" style={{ color: '#6B7280' }}>
              Clientes que vuelven
            </div>
          </div>
        </div>

        <div className="kpi-quality-side">
          {topSeller && (
            <div className="kpi-quality-top-seller">
              <div className="kpi-quality-top-seller-header" style={{ background: '#E0F2FE', color: '#0284C7' }}>
                <Icons.User size={14} />
                <span>Top Vendedor</span>
              </div>
              <div className="kpi-quality-top-seller-name">{topSeller.name}</div>
              <div className="kpi-quality-top-seller-stat">
                {formatNumber(topSeller.orders_created)} órdenes · {topSeller.completed_rate || 0}% completado
              </div>
            </div>
          )}

          {topDesigner && (
            <div className="kpi-quality-top-seller">
              <div className="kpi-quality-top-seller-header" style={{ background: '#F3E8FF', color: '#9333EA' }}>
                <Icons.Brush size={14} />
                <span>Top Diseñador</span>
              </div>
              <div className="kpi-quality-top-seller-name">{topDesigner.name}</div>
              <div className="kpi-quality-top-seller-stat">
                {formatNumber(topDesigner.orders_processed)} órdenes · {topDesigner.avg_days_per_order ? `${topDesigner.avg_days_per_order.toFixed(1)}d promedio` : 'Sin datos'}
              </div>
            </div>
          )}

          {topClient && (
            <div className="kpi-quality-top-seller">
              <div className="kpi-quality-top-seller-header" style={{ background: '#DCFCE7', color: '#16A34A' }}>
                <Icons.User size={14} />
                <span>Top Cliente</span>
              </div>
              <div className="kpi-quality-top-seller-name">{topClient.name}</div>
              <div className="kpi-quality-top-seller-stat">
                {formatNumber(topClient.total_orders)} órdenes · {topClient.completed_orders || 0} completadas
              </div>
            </div>
          )}

          {inactiveUsers.length > 0 && (
            <div className="kpi-quality-inactive">
              <div className="kpi-quality-inactive-header">
                <Icons.UserMinus size={14} />
                <span>{inactiveUsers.length} usuario{inactiveUsers.length !== 1 ? 's' : ''} inactivo{inactiveUsers.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
