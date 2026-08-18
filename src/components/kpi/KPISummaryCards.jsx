import { Icons } from '../../utils/icons'
import { formatNumber } from '../../utils/kpiHelpers'

const SEMANTIC_COLORS = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral: { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
  warning: { iconBg: '#FEF3C7', iconColor: '#D97706', trendBg: '#FEF3C7', trendColor: '#D97706' },
  purple: { iconBg: '#F3E8FF', iconColor: '#9333EA', trendBg: '#F3E8FF', trendColor: '#9333EA' },
}

function getSemanticForCard(cardId, value) {
  if (cardId === 'blocked' || cardId === 'delayed') return Number(value) > 0 ? SEMANTIC_COLORS.warning : SEMANTIC_COLORS.positive
  if (cardId === 'urgent') return Number(value) > 0 ? SEMANTIC_COLORS.negative : SEMANTIC_COLORS.positive
  if (cardId === 'employees') return SEMANTIC_COLORS.purple
  return SEMANTIC_COLORS.neutral
}

export default function KPISummaryCards({ data }) {
  const snapshot = data?.executive_summary?.snapshot
  if (!snapshot) return null

  const cards = [
    { id: 'active', label: 'Órdenes en curso', value: snapshot.active_orders, icon: <Icons.Orders size={18} />, subtitle: 'Foto operativa actual' },
    { id: 'blocked', label: 'Órdenes bloqueadas', value: snapshot.blocked_orders, icon: <Icons.AlertCircle size={18} />, subtitle: 'Requieren desbloqueo' },
    { id: 'delayed', label: 'Estancadas >7 días', value: snapshot.stalled_orders, icon: <Icons.Clock size={18} />, subtitle: 'Abiertas y no bloqueadas' },
    { id: 'urgent', label: 'Órdenes 911 en curso', value: snapshot.urgent_911_orders, icon: <Icons.AlertCircle size={18} />, subtitle: 'Prioridad urgente abierta' },
    { id: 'employees', label: 'Empleados', value: snapshot.employees_active, icon: <Icons.Users size={18} />, subtitle: 'Activos en el sistema' },
    { id: 'clients', label: 'Clientes registrados', value: snapshot.clients_registered, icon: <Icons.User size={18} />, subtitle: 'Total en el sistema' },
  ]

  return (
    <section className="kpi-executive-metrics" aria-label="Indicadores operativos actuales">
      <div className="kpi-hero-grid kpi-hero-grid--6">
        {cards.map(card => {
        const semantic = getSemanticForCard(card.id, card.value)
        const value = card.value !== null && card.value !== undefined && Number.isFinite(Number(card.value)) ? formatNumber(card.value) : 'N/D'
        return (
          <article key={card.id} className="kpi-hero-card">
            <div className="kpi-hero-icon" style={{ background: semantic.iconBg, color: semantic.iconColor }}>{card.icon}</div>
            <div className="kpi-hero-content">
              <div className="kpi-hero-label">{card.label}</div>
              <div className="kpi-hero-value">{value}</div>
              <div className="kpi-hero-footer">
                <div className="kpi-hero-subtitle">{card.subtitle}</div>
                <div className="kpi-hero-trend" style={{ background: semantic.trendBg, color: semantic.trendColor }}><span>Actual</span></div>
              </div>
            </div>
          </article>
        )
        })}
      </div>
    </section>
  )
}
