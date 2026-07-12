import { formatNumber, formatDays, formatPercent, getTrendConfig } from '../../utils/kpiHelpers'

function Sparkline({ data, color = '#06B6D4', width = 120, height = 32 }) {
  if (!data || data.length === 0) return null

  const values = data.map(d => d.orders || 0)
  const max = Math.max(...values, 1)
  const min = 0
  const range = max - min || 1

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  const areaPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`sparkline-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polygon
        points={areaPoints}
        fill={`url(#sparkline-${color.replace('#', '')})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function KPIStatusTrend({ data }) {
  if (!data) return null

  const current = data.business_summary?.current || {}
  const previous = data.business_summary?.previous || {}
  const ordersTrend = data.orders_trend || []

  const completedTrend = getTrendConfig(current.completed_orders, previous.completed_orders)
  const ordersTrendPct = getTrendConfig(current.total_orders, previous.total_orders)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Tendencia</span>
          <h2 className="kpi-section-title">Tendencia y Comparación</h2>
          <p className="kpi-section-subtitle">Evolución del período actual vs anterior</p>
        </div>
      </div>

      <div className="kpi-trend-grid">
        <div className="kpi-trend-card">
          <div className="kpi-trend-card-header">
            <span className="kpi-trend-card-title">Órdenes Totales</span>
            <Sparkline data={ordersTrend} color="#06B6D4" />
          </div>
          <div className="kpi-trend-card-value" style={{ color: ordersTrendPct.color }}>
            {formatNumber(current.total_orders || 0)}
          </div>
          <div className="kpi-trend-card-comparison" style={{ color: ordersTrendPct.color }}>
            <span>{ordersTrendPct.arrow}</span>
            {ordersTrendPct.change !== '0.0' && (
              <span>{Math.abs(ordersTrendPct.change)}% vs anterior</span>
            )}
          </div>
        </div>

        <div className="kpi-trend-card">
          <div className="kpi-trend-card-header">
            <span className="kpi-trend-card-title">Completadas</span>
            <Sparkline data={ordersTrend} color="#10B981" />
          </div>
          <div className="kpi-trend-card-value" style={{ color: completedTrend.color }}>
            {formatNumber(current.completed_orders || 0)}
          </div>
          <div className="kpi-trend-card-comparison" style={{ color: completedTrend.color }}>
            <span>{completedTrend.arrow}</span>
            {completedTrend.change !== '0.0' && (
              <span>{Math.abs(completedTrend.change)}% vs anterior</span>
            )}
          </div>
        </div>

        <div className="kpi-trend-card">
          <div className="kpi-trend-card-header">
            <span className="kpi-trend-card-title">Tiempo Promedio</span>
          </div>
          <div className="kpi-trend-card-value">
            {formatDays(current.avg_cycle_days)}
          </div>
          <div className="kpi-trend-card-comparison" style={{ color: '#6B7280' }}>
            Ciclo promedio por orden
          </div>
        </div>

        <div className="kpi-trend-card">
          <div className="kpi-trend-card-header">
            <span className="kpi-trend-card-title">Tasa Completado</span>
          </div>
          <div className="kpi-trend-card-value">
            {formatPercent(current.completion_rate)}
          </div>
          <div className="kpi-trend-card-comparison" style={{ color: '#6B7280' }}>
            Órdenes completadas / total
          </div>
        </div>
      </div>
    </div>
  )
}
