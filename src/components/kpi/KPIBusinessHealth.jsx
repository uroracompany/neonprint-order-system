import { Icons } from '../../utils/icons'
import { formatPercent, formatDays } from '../../utils/kpiHelpers'

export default function KPIBusinessHealth({ data }) {
  if (!data) return null

  const healthScore = data.business_summary?.health_score || 0
  const current = data.business_summary?.current || {}
  const trends = data.business_summary?.trends || {}

  const getHealthDescription = () => {
    if (healthScore >= 80) return 'Excelente estado operacional del sistema.'
    if (healthScore >= 60) return 'Buen estado, áreas de oportunidad identificadas.'
    if (healthScore >= 40) return 'Estado moderado, requiere atención.'
    return 'Estado crítico, acciones urgentes necesarias.'
  }

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Resumen Ejecutivo</span>
          <h2 className="kpi-section-title">Estado General del Sistema</h2>
          <p className="kpi-section-subtitle">Resumen ejecutivo del rendimiento operativo</p>
        </div>
      </div>
      <div className="kpi-health-card">
        <div className="kpi-health-content">
          <div className="kpi-health-main">
            <div className="kpi-health-score">
              <span className="kpi-score-value">{healthScore}</span>
              <span className="kpi-score-label">SALUD</span>
            </div>
            <h3>Score Operativo</h3>
            <p className="kpi-health-description">{getHealthDescription()}</p>
            {trends.orders_pct !== undefined && (
              <div className="kpi-health-trend">
                <Icons.TrendUp />
                <span>{Math.abs(trends.orders_pct || 0).toFixed(1)}% órdenes vs mes anterior</span>
              </div>
            )}
          </div>

          <div className="kpi-health-metrics">
            <div className="kpi-metric-item">
              <div className="kpi-metric-value">{current.total_orders || 0}</div>
              <div className="kpi-metric-label">Órdenes</div>
              <div className="kpi-metric-trend">
                <Icons.TrendUp size={12} />
                <span>{Math.abs(trends.orders_pct || 0).toFixed(1)}%</span>
              </div>
            </div>

            <div className="kpi-metric-item">
              <div className="kpi-metric-value">{formatDays(current.avg_cycle_days)}</div>
              <div className="kpi-metric-label">Tiempo Prom.</div>
              <div className="kpi-metric-trend">
                <Icons.Clock size={12} />
              </div>
            </div>

            <div className="kpi-metric-item">
              <div className="kpi-metric-value">{formatPercent(current.completion_rate)}</div>
              <div className="kpi-metric-label">Completado</div>
              <div className="kpi-metric-trend">
                <Icons.TrendUp size={12} />
                <span>{Math.abs(trends.completion_rate_pct || 0).toFixed(1)}%</span>
              </div>
            </div>

            <div className="kpi-metric-item">
              <div className="kpi-metric-value">{current.active_orders || 0}</div>
              <div className="kpi-metric-label">Activas</div>
              <div className="kpi-metric-trend">
                <Icons.TrendUp size={12} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
