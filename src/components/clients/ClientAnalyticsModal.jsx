import { useEffect, useRef } from 'react'
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Icons } from '../../utils/icons'
import '../../css-components/page-kpi.css'

const BLUE = '#1E40AF'
const CYAN = '#1E40AF'

const monthLabel = (month) => {
  if (!month) return ''
  const date = new Date(`${month}-01T12:00:00`)
  return new Intl.DateTimeFormat('es-PY', { month: 'short', year: '2-digit' }).format(date).replace('.', '')
}

const healthTone = (health) => ({
  Excelente: 'excellent', Buena: 'good', Media: 'medium', Riesgo: 'risk',
}[health] || 'medium')

const getInitials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const activityBadgeClass = (activity) =>
  activity === 'Alta' ? 'success' : activity === 'Media' ? 'warning' : 'info'

function Metric({ label, value, detail, tone = 'blue', icon }) {
  return (
    <div className={`kpi-client-workspace-metric is-${tone}`}>
      {icon && <div className="kpi-client-metric-icon">{icon}</div>}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

export default function ClientAnalyticsModal({
  client,
  loading = false,
  error = '',
  onRetry,
  onClose,
}) {
  const closeButtonRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!client) return undefined
    previousFocusRef.current = document.activeElement
    closeButtonRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [client, onClose])

  if (!client) return null

  const activity = client.monthly_activity || []
  const activityAreaData = [
    { label: 'Inicio', orders: 0 },
    ...activity.map(item => ({ ...item, label: monthLabel(item.month), orders: Number(item.orders) || 0 })),
  ]
  const activityTicks = activityAreaData
    .filter((_, index) => index === 0 || index === activityAreaData.length - 1 || index % 3 === 0)
    .map(item => item.label)
  const orderMix = [
    { name: '911', value: Number(client.urgent_911_orders) || 0, color: BLUE },
    { name: 'Normal', value: Number(client.normal_orders) || 0, color: CYAN },
  ].filter(item => item.value > 0)
  const totalOrders = orderMix.reduce((sum, item) => sum + item.value, 0)
  const predominant = orderMix.length > 1 ? orderMix.reduce((a, b) => a.value > b.value ? a : b) : orderMix[0]
  const predominantPct = totalOrders > 0 && predominant ? Math.round((predominant.value / totalOrders) * 100) : 0
  const payment = client.payment || {}
  const totalPayment = (payment.credit_active || 0) + (payment.partial_active || 0) + (payment.pending_active || 0)
  const title = client.client_name || 'Cliente'

  return (
    <div className="kpi-client-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="kpi-client-modal" role="dialog" aria-modal="true" aria-labelledby="client-detail-title" aria-busy={loading} onMouseDown={event => event.stopPropagation()}>
        <header className="kpi-client-modal-header">
          <div className="kpi-client-modal-avatar">{getInitials(title)}</div>
          <div>
            <h2 id="client-detail-title">{title}</h2>
            <span className={`kpi-badge ${activityBadgeClass(client.activity)}`}>{client.activity || 'Cliente'}</span>
          </div>
          <button ref={closeButtonRef} type="button" className="kpi-client-modal-close" aria-label="Cerrar detalle" onClick={onClose}><Icons.Close /></button>
        </header>

        {loading ? (
          <div className="kpi-client-modal-state" role="status">Cargando estadísticas del cliente…</div>
        ) : error ? (
          <div className="kpi-client-modal-state kpi-client-modal-state--error" role="alert">
            <strong>No fue posible obtener las estadísticas de este cliente.</strong>
            <span>{error}</span>
            {onRetry && <button type="button" className="kpi-btn primary" onClick={onRetry}>Reintentar</button>}
          </div>
        ) : (
          <>
            <div className="kpi-client-detail-metrics">
              <Metric label="Órdenes totales" value={client.total_orders} detail="Histórico" />
              <Metric label="Cancelación" value={`${client.cancel_rate}%`} detail={`${client.cancelled_orders} órdenes`} tone={client.cancel_rate > 10 ? 'rose' : 'green'} />
              <Metric label="Promedio / mes" value={client.avg_orders_per_month} detail="Meses con actividad" tone="violet" />
            </div>

            <div className="kpi-client-detail-grid">
              <article className="kpi-client-detail-card">
                <h3>911 vs. normal</h3>
                {orderMix.length ? (
                  <div className="kpi-client-order-mix">
                    <div className="kpi-donut-wrapper">
                      <ResponsiveContainer width="100%" height={152}>
                        <PieChart>
                          <Pie data={orderMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3}>
                            {orderMix.map(item => <Cell key={item.name} fill={item.color} />)}
                          </Pie>
                          <Tooltip formatter={(value) => [`${value} órdenes`, '']} />
                        </PieChart>
                      </ResponsiveContainer>
                      {predominantPct > 0 && (
                        <div className="kpi-donut-center">
                          <span className="kpi-donut-pct">{predominantPct}%</span>
                          <span className="kpi-donut-label">{predominant.name}</span>
                        </div>
                      )}
                    </div>
                    <div className="kpi-client-order-legend">
                      {orderMix.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}: <b>{item.value}</b></span>)}
                    </div>
                  </div>
                ) : <p className="kpi-client-empty">Sin órdenes registradas.</p>}
              </article>
              <article className="kpi-client-detail-card">
                <h3>Diseño</h3>
                <div className="kpi-client-design-bars">
                  <span className="is-internal"><b>Interno</b><strong>{client.internal_design_orders}</strong></span>
                  <span className="is-external"><b>Externo</b><strong>{client.external_design_orders}</strong></span>
                </div>
                <div className="kpi-client-health-line"><span>Salud del cliente</span><b className={`is-${healthTone(client.health)}`}>{client.health_score}/100 · {client.health}</b></div>
              </article>
            </div>

            <article className="kpi-client-detail-card kpi-client-activity-chart">
              <h3>Actividad mensual</h3>
              {activity.length ? (
                <>
                  <ResponsiveContainer width="100%" height={190}>
                    <AreaChart data={activityAreaData} margin={{ top: 5, right: 12, bottom: 5, left: -12 }}>
                      <defs><linearGradient id="clientModalActivityGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BLUE} stopOpacity=".3" /><stop offset="100%" stopColor={BLUE} stopOpacity="0" /></linearGradient></defs>
                      <CartesianGrid stroke="#E8EDF8" strokeDasharray="3 3" />
                      <XAxis dataKey="label" ticks={activityTicks} tick={{ fontSize: 11, fill: '#71809a' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 'auto']} allowDecimals={false} tick={{ fontSize: 11, fill: '#71809a' }} axisLine={false} tickLine={false} />
                      <Tooltip labelFormatter={label => label} formatter={(value) => [`${value} órdenes`, 'Órdenes']} />
                      <Area type="monotone" dataKey="orders" name="Órdenes" stroke={BLUE} strokeWidth={2.5} fill="url(#clientModalActivityGradient)" dot={{ fill: BLUE, r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="kpi-client-chart-legend kpi-client-chart-legend--modal"><span><i className="is-orders" />Órdenes mensuales</span></div>
                </>
              ) : <p className="kpi-client-empty">Sin actividad mensual para mostrar.</p>}
            </article>

            <article className="kpi-client-detail-card kpi-client-payment-card">
              <h3>Estados de pago activos</h3>
              {totalPayment > 0 ? (
                <div className="kpi-client-payment-list">
                  <div className="kpi-payment-item"><span className="kpi-payment-badge is-credit"><Icons.Money size={12} /></span><span className="kpi-payment-label">Crédito activo</span><strong className="kpi-payment-value">{payment.credit_active || 0}</strong></div>
                  <div className="kpi-payment-item"><span className="kpi-payment-badge is-partial"><Icons.Money size={12} /></span><span className="kpi-payment-label">Pago parcial</span><strong className="kpi-payment-value">{payment.partial_active || 0}</strong></div>
                  <div className="kpi-payment-item"><span className="kpi-payment-badge is-pending"><Icons.AlertCircle size={12} /></span><span className="kpi-payment-label">Pago pendiente</span><strong className="kpi-payment-value">{payment.pending_active || 0}</strong></div>
                </div>
              ) : <p className="kpi-client-empty">No hay pagos activos pendientes.</p>}
            </article>
          </>
        )}
      </section>
    </div>
  )
}
