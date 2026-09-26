import { Icons } from '../../utils/icons'
import { formatNumber } from '../../utils/kpiHelpers'

const display = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? formatNumber(value) : 'N/D'

export default function KPICreditsSummary({ data }) {
  const payments = data?.executive_summary?.snapshot?.payments
  if (!payments) return null

  const cards = [
    { label: 'A crédito', value: payments.credit_orders, subtitle: 'Órdenes no canceladas a crédito', icon: <Icons.Receipt />, tone: 'info' },
    { label: 'Pago pendiente >3 días', value: payments.pending_over_3_days, subtitle: 'Sin pago y no canceladas', icon: <Icons.Clock />, tone: 'warning' },
    { label: 'Pagos pendientes', value: payments.pending_orders, subtitle: 'Sin pago registrado y no canceladas', icon: <Icons.AlertCircle />, tone: 'danger' },
    { label: 'Pagos parciales', value: payments.partial_orders, subtitle: 'Órdenes no canceladas con pago parcial', icon: <Icons.AlertCircle />, tone: 'purple' },
  ]

  return (
    <div className="kpi-section">
      <div className="kpi-section-header"><div><span className="kpi-section-kicker">Foto de cobros</span><h2 className="kpi-section-title">Créditos y pagos pendientes</h2><p className="kpi-section-subtitle">Conteos actuales; no representan montos o saldos por cobrar.</p></div><span className="kpi-section-fact-badge"><Icons.Receipt />Conteos actuales</span></div>
      <div className="kpi-credits-grid">
        {cards.map(card => (
          <article className={`kpi-credit-card kpi-lower-metric-card is-${card.tone}`} key={card.label}>
            <div className="kpi-credit-card-header"><div className="kpi-credit-icon">{card.icon}</div><span className="kpi-lower-metric-badge">Conteo actual</span></div>
            <span className="kpi-credit-label">{card.label}</span>
            <div className="kpi-credit-value">{display(card.value)}</div>
            <div className="kpi-credit-subtitle">{card.subtitle}</div>
          </article>
        ))}
      </div>
    </div>
  )
}
