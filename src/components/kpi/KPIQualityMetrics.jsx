import { Icons } from '../../utils/icons'
import { formatNumber, formatPercent, getTrendConfig } from '../../utils/kpiHelpers'

const display = (value, formatter = formatNumber) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? formatter(Number(value)) : 'N/D'

function Ranking({ title, ranking, icon, color }) {
  if (!ranking) return null
  return <article className="kpi-quality-top-seller"><div className="kpi-quality-top-seller-header" style={{ background: color.background, color: color.foreground }}>{icon}<span>{title}</span></div><div className="kpi-quality-top-seller-name">{ranking.name}</div><div className="kpi-quality-top-seller-stat">{display(ranking.total)} órdenes del período</div></article>
}

export default function KPIQualityMetrics({ data }) {
  const summary = data?.executive_summary
  const period = summary?.period
  const comparison = summary?.comparison
  if (!period || !comparison) return null

  const cancellationTrend = getTrendConfig(period.orders_cancelled || 0, comparison.orders_cancelled || 0)
  const rankings = period.rankings || {}
  const metrics = [
    { label: 'Cancelaciones / altas', value: display(period.cancellation_rate, formatPercent), icon: <Icons.AlertCircle />, badge: 'Eventos registrados', footer: cancellationTrend.change !== '0.0' ? `${Math.abs(cancellationTrend.change)}% cancelaciones vs. anterior` : 'Sin variación vs. período anterior', color: cancellationTrend.color },
    { label: 'Devoluciones', value: display(period.return_count), icon: <Icons.Refresh />, badge: 'Eventos registrados', footer: 'Eventos de devolución del período', color: '#64748B' },
    { label: 'Retención', value: display(period.retention_rate, formatPercent), icon: <Icons.Users />, badge: 'Período actual', footer: 'Clientes previos que volvieron en el período', color: '#64748B' },
  ]

  return (
    <div className="kpi-section">
      <div className="kpi-section-header"><div><span className="kpi-section-kicker">Calidad del período</span><h2 className="kpi-section-title">Calidad y equipo</h2><p className="kpi-section-subtitle">Las cancelaciones y devoluciones se contabilizan por eventos registrados.</p></div></div>
      <div className="kpi-quality-grid">
        <div className="kpi-quality-metrics-row">
          {metrics.map(metric => <article className="kpi-quality-metric kpi-lower-metric-card" key={metric.label}><div className="kpi-quality-metric-header"><span className="kpi-lower-metric-icon">{metric.icon}</span><span className="kpi-lower-metric-badge">{metric.badge}</span></div><span className="kpi-quality-metric-label">{metric.label}</span><div className="kpi-quality-metric-value">{metric.value}</div><div className="kpi-quality-metric-trend" style={{ color: metric.color }}>{metric.footer}</div></article>)}
        </div>
        <div className="kpi-quality-side">
          <Ranking title="Top vendedor" ranking={rankings.top_seller} icon={<Icons.User size={14} />} color={{ background: '#E0F2FE', foreground: '#0284C7' }} />
          <Ranking title="Top diseñador" ranking={rankings.top_designer} icon={<Icons.Brush size={14} />} color={{ background: '#F3E8FF', foreground: '#9333EA' }} />
          <Ranking title="Top cliente" ranking={rankings.top_client} icon={<Icons.User size={14} />} color={{ background: '#DCFCE7', foreground: '#16A34A' }} />
        </div>
      </div>
    </div>
  )
}
