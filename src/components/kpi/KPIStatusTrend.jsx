import { Icons } from '../../utils/icons'
import { formatDays, formatNumber, getTrendConfig } from '../../utils/kpiHelpers'

function Sparkline({ data, color, width = 120, height = 32 }) {
  if (!data?.length) return null
  const values = data.map(item => Number(item.orders) || 0)
  const max = Math.max(...values, 1)
  const points = values.map((value, index) => `${data.length === 1 ? width / 2 : (index / (data.length - 1)) * width},${height - (value / max) * (height - 4) - 2}`).join(' ')
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

const display = (value, formatter = formatNumber) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? formatter(Number(value)) : 'N/D'

export default function KPIStatusTrend({ data }) {
  const summary = data?.executive_summary
  const period = summary?.period
  const comparison = summary?.comparison
  const trends = summary?.trends
  const coverage = summary?.coverage
  if (!period || !comparison) return null

  const createdTrend = getTrendConfig(period.orders_created || 0, comparison.orders_created || 0)
  const deliveredTrend = getTrendConfig(period.orders_delivered || 0, comparison.orders_delivered || 0)
  const coverageLabel = `${display(coverage?.delivery_cycle_available)} / ${display(coverage?.delivery_cycle_orders)}`
  const cards = [
    { label: 'Órdenes creadas', value: display(period.orders_created), trend: createdTrend, chart: <Sparkline data={trends?.created} color="#06B6D4" />, icon: <Icons.Orders />, badge: 'Altas del período' },
    { label: 'Órdenes entregadas', value: display(period.orders_delivered), trend: deliveredTrend, chart: <Sparkline data={trends?.delivered} color="#10B981" />, icon: <Icons.Truck />, badge: 'Transición auditable' },
    { label: 'Ciclo hasta entrega', value: display(period.avg_delivery_cycle_days, formatDays), caption: 'Solo órdenes con trazabilidad verificable', icon: <Icons.Clock />, badge: 'Tiempo verificado' },
    { label: 'Cobertura de tiempos', value: coverageLabel, caption: 'Entregas con ciclo disponible / entregas auditables', icon: <Icons.Check />, badge: 'Cobertura' },
  ]

  return (
    <div className="kpi-section">
      <div className="kpi-section-header"><div><span className="kpi-section-kicker">Rendimiento del período</span><h2 className="kpi-section-title">Tendencia y comparación</h2><p className="kpi-section-subtitle">Las entregas se basan en transiciones auditables a “entregada”.</p></div></div>
      <div className="kpi-trend-grid">
        {cards.map(card => (
          <article className="kpi-trend-card kpi-lower-metric-card" key={card.label}>
            <div className="kpi-trend-card-header"><span className="kpi-lower-metric-icon">{card.icon}</span><span className="kpi-lower-metric-badge">{card.badge}</span>{card.chart}</div>
            <span className="kpi-trend-card-title">{card.label}</span>
            <div className="kpi-trend-card-value" style={{ color: card.trend?.color }}>{card.value}</div>
            <div className="kpi-trend-card-comparison" style={{ color: card.trend?.color || '#6B7280' }}>
              {card.trend ? <><span>{card.trend.arrow}</span>{card.trend.change !== '0.0' ? <span>{Math.abs(card.trend.change)}% vs. período anterior</span> : <span>Sin variación vs. período anterior</span>}</> : card.caption}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
