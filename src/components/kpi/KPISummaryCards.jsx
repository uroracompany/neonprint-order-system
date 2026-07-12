import { Icons } from '../../utils/icons'
import { formatNumber, getTrendConfig } from '../../utils/kpiHelpers'

const SEMANTIC_COLORS = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
  warning:  { iconBg: '#FEF3C7', iconColor: '#D97706', trendBg: '#FEF3C7', trendColor: '#D97706' },
  purple:   { iconBg: '#F3E8FF', iconColor: '#9333EA', trendBg: '#F3E8FF', trendColor: '#9333EA' },
}

function getSemanticForCard(cardId, value, prevValue) {
  switch (cardId) {
    case 'health':
      if (value >= 70) return SEMANTIC_COLORS.positive
      if (value >= 40) return SEMANTIC_COLORS.warning
      return SEMANTIC_COLORS.negative
    case 'active':
      return value > (prevValue || 0) ? SEMANTIC_COLORS.positive : SEMANTIC_COLORS.neutral
    case 'delayed':
      return value > 0 ? SEMANTIC_COLORS.negative : SEMANTIC_COLORS.positive
    case 'urgent':
      return value > 0 ? SEMANTIC_COLORS.negative : SEMANTIC_COLORS.positive
    case 'employees':
      return SEMANTIC_COLORS.purple
    case 'clients':
      return SEMANTIC_COLORS.neutral
    default:
      return SEMANTIC_COLORS.neutral
  }
}

export default function KPISummaryCards({ data }) {
  if (!data) return null

  const current = data.business_summary?.current || {}
  const previous = data.business_summary?.previous || {}
  const ordersAnalytics = data.orders_analytics || {}
  const delayedOrders = ordersAnalytics.delayed_orders?.count || 0
  const urgentCount = ordersAnalytics.type_breakdown?.urgent_911 || 0
  const healthScore = data.business_summary?.health_score || 0
  const totalEmployees = data.total_employees || 0
  const totalClients = data.total_clients || 0

  const previousHealthScore = previous.total_orders > 0
    ? Math.round(
        (previous.completion_rate || 0) * 0.4 +
        (50) * 0.3 +
        ((previous.active_orders || 0) > 0 ? 20 : 0) * 0.3
      )
    : 0

  const getScoreLabel = (score) => {
    if (score >= 70) return 'Buen estado'
    if (score >= 40) return 'Requiere atención'
    return 'Estado crítico'
  }

  const cards = [
    {
      id: 'health',
      label: 'Puntaje de Salud',
      value: healthScore,
      format: 'score',
      icon: <Icons.CheckCircle size={16} />,
      trend: getTrendConfig(healthScore, previousHealthScore || 50),
      subtitle: getScoreLabel(healthScore),
    },
    {
      id: 'active',
      label: 'Órdenes Activas',
      value: current.active_orders || 0,
      format: 'number',
      icon: <Icons.Orders size={18} />,
      trend: getTrendConfig(current.active_orders || 0, previous.active_orders || 0),
      subtitle: `de ${current.total_orders || 0} totales`,
    },
    {
      id: 'delayed',
      label: 'Estancadas >7 días',
      value: delayedOrders,
      format: 'number',
      icon: <Icons.Clock size={18} />,
      trend: getTrendConfig(delayedOrders, 0),
      subtitle: delayedOrders > 0 ? 'Requiere acción' : 'Fluido',
    },
    {
      id: 'urgent',
      label: 'Órdenes 911',
      value: urgentCount,
      format: 'number',
      icon: <Icons.AlertCircle size={18} />,
      trend: getTrendConfig(urgentCount, 0),
      subtitle: urgentCount > 0 ? 'Emergencias activas' : 'Sin urgentes',
    },
    {
      id: 'employees',
      label: 'Empleados',
      value: totalEmployees,
      format: 'number',
      icon: <Icons.Users size={18} />,
      trend: { color: '#9333EA', bg: '#F3E8FF', arrow: '→', change: '0.0' },
      subtitle: 'Activos en el sistema',
    },
    {
      id: 'clients',
      label: 'Clientes Registrados',
      value: totalClients,
      format: 'number',
      icon: <Icons.User size={18} />,
      trend: { color: '#0284C7', bg: '#E0F2FE', arrow: '→', change: '0.0' },
      subtitle: 'Total en el sistema',
    },
  ]

  return (
    <div className="kpi-hero-grid kpi-hero-grid--6">
      {cards.map((card, index) => {
        const semantic = getSemanticForCard(card.id, card.value, card.id === 'health' ? previousHealthScore : null)
        return (
          <div key={index} className="kpi-hero-card">
            <div className="kpi-hero-header">
              <div className="kpi-hero-label">{card.label}</div>
              <div className="kpi-hero-icon" style={{ background: semantic.iconBg, color: semantic.iconColor }}>
                {card.icon}
              </div>
            </div>
            <div className="kpi-hero-value">
              {card.format === 'score' ? card.value : formatNumber(card.value)}
            </div>
            <div className="kpi-hero-footer">
              <div className="kpi-hero-subtitle">{card.subtitle}</div>
              <div className="kpi-hero-trend" style={{ background: semantic.trendBg, color: semantic.trendColor }}>
                <span>{card.trend.arrow}</span>
                {card.trend.change && card.trend.change !== '0.0' && <span>{Math.abs(Number(card.trend.change))}%</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
