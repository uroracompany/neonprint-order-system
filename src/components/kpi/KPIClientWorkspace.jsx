import { useDeferredValue, useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Icons } from '../../utils/icons'
import { FilterSelect } from '../../components/ui/FilterSelect'
import KPISearchBox from './KPISearchBox'

const PAGE_SIZE = 10
const BLUE = '#1E40AF'
const CYAN = '#1E40AF'
const PINK = 'var(--kpi-secondary)'

const monthLabel = (month) => {
  if (!month) return ''
  const date = new Date(`${month}-01T12:00:00`)
  return new Intl.DateTimeFormat('es-PY', { month: 'short', year: '2-digit' }).format(date).replace('.', '')
}

const healthTone = (health) => ({
  Excelente: 'excellent', Buena: 'good', Media: 'medium', Riesgo: 'risk',
}[health] || 'medium')

const clientKey = (item) => String(item?.client_id || item?.id || item?.client_name || item?.name || '').trim()
const clientName = (item) => String(item?.client_name || item?.name || '').trim()

const getInitials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const activityBadgeClass = (activity) =>
  activity === 'Alta' ? 'success' : activity === 'Media' ? 'warning' : 'info'

const healthBadgeClass = (health) =>
  health === 'Excelente' ? 'success' : health === 'Buena' ? 'cyan' : health === 'Media' ? 'warning' : 'danger'

// The former KPI payload remains useful during a partial API rollout. This
// adapter ensures the simplified workspace still has real records when the
// complete workspace query is temporarily unavailable.
function buildLegacyClientWorkspace({ client = {}, kpis = {}, paymentSummary = {} } = {}) {
  const records = new Map()
  const ensure = (item) => {
    const name = clientName(item)
    const key = clientKey(item) || `name:${name || 'sin-nombre'}`
    const existingByName = name && [...records.values()].find(record => record.client_name.localeCompare(name, 'es', { sensitivity: 'accent' }) === 0)
    if (existingByName) return existingByName
    if (!records.has(key)) records.set(key, {
      client_id: key, client_name: name || 'Cliente sin nombre', total_orders: 0,
      cancelled_orders: 0, normal_orders: 0, urgent_911_orders: 0,
      internal_design_orders: 0, external_design_orders: 0, payment: {
        credit_active: 0, partial_active: 0, pending_active: 0,
      }, materials: {}, months: {}, on_time: 0, late: 0, total_delivered: 0,
    })
    return records.get(key)
  }

  ;(client.top_clients || []).forEach(item => {
    const entry = ensure(item)
    entry.total_orders = Math.max(entry.total_orders, Number(item.total_orders || item.completed_orders || 0))
  })
  ;(client.new_clients?.clients || []).forEach(ensure)
  ;(client.inactive_clients?.clients || []).forEach(ensure)
  ;(kpis.cancellation_by_client || []).forEach(item => {
    const entry = ensure(item)
    entry.total_orders = Math.max(entry.total_orders, Number(item.total_orders || 0))
    entry.cancelled_orders = Math.max(entry.cancelled_orders, Number(item.cancelled_orders || 0))
  })
  ;(kpis.materials_by_client || []).forEach(item => {
    const entry = ensure(item)
    ;(item.materials || []).forEach(material => {
      const name = typeof material === 'string' ? material : material.name
      if (name) entry.materials[name] = (entry.materials[name] || 0) + Number(material.count || 1)
    })
  })
  ;(kpis.order_type_by_client || []).forEach(item => {
    const entry = ensure(item)
    entry.normal_orders = Math.max(entry.normal_orders, Number(item.normal || 0))
    entry.urgent_911_orders = Math.max(entry.urgent_911_orders, Number(item.urgent_911 || item.urgent || 0))
    entry.total_orders = Math.max(entry.total_orders, Number(item.total || 0))
  })
  ;(kpis.delivery_time_by_client || []).forEach(item => {
    const entry = ensure(item)
    entry.on_time = Math.max(entry.on_time, Number(item.on_time || 0))
    entry.late = Math.max(entry.late, Number(item.late || 0))
    entry.total_delivered = Math.max(entry.total_delivered, Number(item.total_delivered || 0))
  })
  ;(kpis.frequency_by_client || []).forEach(item => {
    const entry = ensure(item)
    entry.total_orders = Math.max(entry.total_orders, Number(item.total_orders || 0))
    entry.avg_orders_per_month = Number(item.orders_per_month || 0)
    entry.activity = item.frequency
    entry.months = { ...(item.months || {}) }
  })
  ;(paymentSummary.by_client || []).forEach(item => {
    const entry = ensure(item)
    entry.payment.credit_active = Number(item.credito_count || 0)
    entry.payment.partial_active = Number(item.parcial_count || 0)
    entry.payment.pending_active = Number(item.pending_count || 0)
  })

  return [...records.values()].map(entry => {
    const activeMonths = Object.keys(entry.months).length
    const cancel_rate = entry.total_orders ? Math.round((entry.cancelled_orders / entry.total_orders) * 1000) / 10 : 0
    const favorite_material = Object.entries(entry.materials)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0]?.[0] || 'Sin material'
    const avg_orders_per_month = entry.avg_orders_per_month || (activeMonths ? Math.round((entry.total_orders / activeMonths) * 10) / 10 : 0)
    const activity = entry.activity === 'Alta' || entry.activity === 'Media' || entry.activity === 'Baja'
      ? entry.activity
      : avg_orders_per_month >= 4 ? 'Alta' : avg_orders_per_month >= 1 ? 'Media' : 'Baja'
    const deliveryScore = entry.total_delivered ? (entry.on_time / entry.total_delivered) * 100 : 50
    const health_score = Math.round(Math.min(100, avg_orders_per_month * 10) * 0.4 + (100 - cancel_rate) * 0.3 + deliveryScore * 0.3)
    return {
      ...entry, favorite_material, avg_orders_per_month, cancel_rate, activity, health_score,
      health: health_score >= 80 ? 'Excelente' : health_score >= 60 ? 'Buena' : health_score >= 40 ? 'Media' : 'Riesgo',
      monthly_activity: Object.entries(entry.months).sort((a, b) => a[0].localeCompare(b[0])).map(([month, orders]) => ({ month, orders })),
    }
  })
}

function buildMonthlyActivityTimeline(workspaceClients, period) {
  const months = new Map()
  workspaceClients.forEach(client => (client.monthly_activity || []).forEach(item => {
    const orders = Number(item.orders) || 0
    if (!months.has(item.month)) months.set(item.month, { month: item.month, orders: 0, active_clients: 0, registered_clients: 0 })
    const row = months.get(item.month)
    row.orders += orders
    if (orders > 0) row.active_clients++
  }))
  workspaceClients.forEach(client => {
    const month = String(client.created_at || '').slice(0, 7)
    if (!month) return
    if (!months.has(month)) months.set(month, { month, orders: 0, active_clients: 0, registered_clients: 0 })
    months.get(month).registered_clients++
  })
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-period)
    .map(row => ({ ...row, label: monthLabel(row.month) }))
}

function normalizeMonthlyActivityTimeline(timeline, period) {
  if (!Array.isArray(timeline) || timeline.length === 0) return []

  return timeline
    .filter(item => item?.month)
    .map(item => ({
      month: item.month,
      orders: Number(item.orders) || 0,
      active_clients: Number(item.active_clients) || 0,
      registered_clients: Number(item.registered_clients) || 0,
      label: monthLabel(item.month),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-period)
}

const tooltipMonthLabel = (month, fallbackLabel) => {
  if (!month) return fallbackLabel || ''
  const date = new Date(`${month}-01T12:00:00`)
  return new Intl.DateTimeFormat('es-PY', { month: 'long', year: 'numeric' }).format(date)
}

const formatTooltipValue = (value) => (Number(value) || 0).toLocaleString('es-PY')

export function ClientActivityTooltip({ active, payload, label }) {
  const row = payload?.[0]?.payload
  if (!active || !row || row.isBaseline) return null

  const metrics = [
    { label: 'Clientes registrados', value: row.registered_clients, icon: <Icons.Users />, tone: 'registered' },
    { label: 'Clientes activos', value: row.active_clients, icon: <Icons.UserCheck />, tone: 'active' },
    { label: 'Órdenes', value: row.orders, icon: <Icons.Orders />, tone: 'orders' },
  ]

  return (
    <div className="kpi-client-chart-tooltip" role="status">
      <div className="kpi-client-chart-tooltip-date"><Icons.Calendar /> <span>Fecha</span><strong>{tooltipMonthLabel(row.month, label)}</strong></div>
      <div className="kpi-client-chart-tooltip-metrics">
        {metrics.map(metric => (
          <div className="kpi-client-chart-tooltip-row" key={metric.label}>
            <span className={`kpi-client-chart-tooltip-icon is-${metric.tone}`}>{metric.icon}</span>
            <span className="kpi-client-chart-tooltip-label">{metric.label}</span>
            <strong>{formatTooltipValue(metric.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

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

function ClientDetailModal({ client, onClose }) {
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
    { name: '911', value: client.urgent_911_orders || 0, color: BLUE },
    { name: 'Normal', value: client.normal_orders || 0, color: CYAN },
  ].filter(item => item.value > 0)
  const totalOrders = orderMix.reduce((sum, item) => sum + item.value, 0)
  const predominant = orderMix.length > 1 ? orderMix.reduce((a, b) => a.value > b.value ? a : b) : orderMix[0]
  const predominantPct = totalOrders > 0 && predominant ? Math.round((predominant.value / totalOrders) * 100) : 0
  const payment = client.payment || {}
  const totalPayment = (payment.credit_active || 0) + (payment.partial_active || 0) + (payment.pending_active || 0)

  return (
    <div className="kpi-client-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="kpi-client-modal" role="dialog" aria-modal="true" aria-labelledby="client-detail-title" onMouseDown={event => event.stopPropagation()}>
        <header className="kpi-client-modal-header">
          <div className="kpi-client-modal-avatar">{getInitials(client.client_name)}</div>
          <div>
            <h2 id="client-detail-title">{client.client_name}</h2>
            <span className={`kpi-badge ${activityBadgeClass(client.activity)}`}>{client.activity}</span>
          </div>
          <button type="button" className="kpi-client-modal-close" aria-label="Cerrar detalle" onClick={onClose}><Icons.Close /></button>
        </header>

        <div className="kpi-client-detail-metrics">
          <Metric label="Órdenes totales" value={client.total_orders} detail="Histórico" />
          <Metric label="Material favorito" value={client.favorite_material} detail="Mayor consumo" tone="cyan" />
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
              <div className="kpi-payment-item">
                <span className="kpi-payment-badge is-credit"><Icons.Money size={12} /></span>
                <span className="kpi-payment-label">Crédito activo</span>
                <strong className="kpi-payment-value">{payment.credit_active || 0}</strong>
              </div>
              <div className="kpi-payment-item">
                <span className="kpi-payment-badge is-partial"><Icons.Money size={12} /></span>
                <span className="kpi-payment-label">Pago parcial</span>
                <strong className="kpi-payment-value">{payment.partial_active || 0}</strong>
              </div>
              <div className="kpi-payment-item">
                <span className="kpi-payment-badge is-pending"><Icons.AlertCircle size={12} /></span>
                <span className="kpi-payment-label">Pago pendiente</span>
                <strong className="kpi-payment-value">{payment.pending_active || 0}</strong>
              </div>
            </div>
          ) : (
            <p className="kpi-client-empty">No hay pagos activos pendientes.</p>
          )}
        </article>
      </section>
    </div>
  )
}

export default function KPIClientWorkspace({ clients = [], activityTimeline = [], legacyData, registeredClientCount }) {
  const [view, setView] = useState('general')
  const [period, setPeriod] = useState(1)
  const [search, setSearch] = useState('')
  const [credit, setCredit] = useState('all')
  const [partial, setPartial] = useState('all')
  const [pending, setPending] = useState('all')
  const [sort, setSort] = useState('orders')
  const [page, setPage] = useState(1)
  const [selectedClient, setSelectedClient] = useState(null)
  const deferredSearch = useDeferredValue(search)
  const workspaceClients = useMemo(
    () => clients.length > 0 ? clients : buildLegacyClientWorkspace(legacyData),
    [clients, legacyData],
  )
  const registeredClients = registeredClientCount != null && Number.isFinite(Number(registeredClientCount))
    ? Number(registeredClientCount)
    : workspaceClients.length

  const generalTimeline = useMemo(() => {
    const serverTimeline = normalizeMonthlyActivityTimeline(activityTimeline, period)
    return serverTimeline.length ? serverTimeline : buildMonthlyActivityTimeline(workspaceClients, period)
  }, [activityTimeline, period, workspaceClients])

  // An explicit zero origin keeps the first monthly comparison on the shared
  // axis and gives a single active month a visible bar context.
  const clientChartData = useMemo(() => {
    if (!generalTimeline.length) return []
    return [
      { label: 'Inicio', orders: 0, active_clients: 0, registered_clients: 0, isBaseline: true },
      ...generalTimeline.map(item => ({
        ...item,
        orders: Number(item.orders) || 0,
        active_clients: Number(item.active_clients) || 0,
        registered_clients: registeredClients,
      })),
    ]
  }, [generalTimeline, registeredClients])
  const clientChartTicks = useMemo(
    () => clientChartData.filter((_, index) => index === 0 || index === clientChartData.length - 1 || index % 3 === 0).map(row => row.label),
    [clientChartData],
  )

  const visibleClients = useMemo(() => {
    const text = deferredSearch.trim().toLocaleLowerCase('es')
    const filtered = workspaceClients.filter(client => {
      const payment = client.payment || {}
      return (!text || `${client.client_name} ${client.favorite_material}`.toLocaleLowerCase('es').includes(text))
        && (credit === 'all' || (payment.credit_active || 0) > 0)
        && (partial === 'all' || (payment.partial_active || 0) > 0)
        && (pending === 'all' || (payment.pending_active || 0) > 0)
    })
    return filtered.sort((a, b) => {
      if (sort === 'health') return b.health_score - a.health_score || a.client_name.localeCompare(b.client_name, 'es')
      if (sort === 'cancel') return b.cancel_rate - a.cancel_rate || a.client_name.localeCompare(b.client_name, 'es')
      if (sort === 'name') return a.client_name.localeCompare(b.client_name, 'es')
      return b.total_orders - a.total_orders || a.client_name.localeCompare(b.client_name, 'es')
    })
  }, [workspaceClients, credit, deferredSearch, partial, pending, sort])

  const totalPages = Math.max(1, Math.ceil(visibleClients.length / PAGE_SIZE))
  const activePage = Math.min(page, totalPages)
  const rows = visibleClients.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
  const totalOrders = generalTimeline.reduce((sum, row) => sum + row.orders, 0)
  const peak = generalTimeline.reduce((best, row) => row.orders > (best?.orders || 0) ? row : best, null)
  const activeAverage = generalTimeline.length ? Math.round(generalTimeline.reduce((sum, row) => sum + row.active_clients, 0) / generalTimeline.length) : 0
  const retention = workspaceClients.length ? Math.round((workspaceClients.filter(client => client.total_orders > 1).length / workspaceClients.length) * 100) : 0

  return (
    <section className="kpi-client-workspace" aria-label="Análisis de clientes">
      <div className="kpi-client-workspace-heading">
        <div><span>Clientes</span><h2>Análisis de clientes</h2><p>La información esencial de toda la cartera, en un solo lugar.</p></div>
      </div>
      <div className="kpi-client-workspace-tabs" role="tablist" aria-label="Vistas de análisis de clientes">
        <button type="button" role="tab" aria-selected={view === 'general'} className={view === 'general' ? 'is-active' : ''} onClick={() => setView('general')}><Icons.ChartArea size={14} /> Actividad general</button>
        <button type="button" role="tab" aria-selected={view === 'individual'} className={view === 'individual' ? 'is-active' : ''} onClick={() => setView('individual')}><Icons.User size={14} /> Actividad individual</button>
      </div>

      {view === 'general' ? (
        <>
          <article className="kpi-client-workspace-panel">
            <div className="kpi-client-workspace-panel-header"><div><h3>Actividad de clientes</h3><p>Comparativa mensual de clientes activos y órdenes registradas.</p></div></div>
            <div className="kpi-client-workspace-controls">
              <div className="kpi-client-period" aria-label="Periodo">
                {[1, 2, 3].map(value => <button type="button" key={value} className={period === value ? 'is-active' : ''} onClick={() => setPeriod(value)}>{value}m</button>)}
              </div>
            </div>
            {generalTimeline.length ? (
              <div className="kpi-client-general-chart">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={clientChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }} barGap={4}>
                    <CartesianGrid stroke="#E8EDF8" strokeDasharray="3 3" />
                    <XAxis dataKey="label" ticks={clientChartTicks} tick={{ fontSize: 11, fill: '#71809a' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 'auto']} allowDecimals={false} tick={{ fontSize: 11, fill: '#71809a' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ClientActivityTooltip />} cursor={{ fill: 'rgba(21, 94, 239, .04)' }} />
                    <Bar dataKey="active_clients" name="Clientes activos" fill={PINK} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} />
                    <Bar dataKey="orders" name="Órdenes" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="kpi-client-chart-legend"><span><i className="is-active" />Clientes activos</span><span><i className="is-orders" />Órdenes</span></div>
              </div>
            ) : <p className="kpi-client-empty kpi-client-empty--large">Aún no hay actividad de clientes para este periodo.</p>}
          </article>
          <div className="kpi-client-workspace-summary">
            <Metric label="Pico de actividad" value={peak?.orders || 0} detail={peak?.label || 'Sin registros'} icon={<Icons.BarChart size={16} />} />
            <Metric label="Promedio activos" value={activeAverage} detail={`${period} meses seleccionados`} tone="cyan" icon={<Icons.Users size={16} />} />
            <Metric label="Clientes recurrentes" value={`${retention}%`} detail="Con más de un pedido histórico" tone="violet" icon={<Icons.TrendUp size={16} />} />
            <Metric label="Órdenes analizadas" value={totalOrders} detail="Periodo seleccionado" tone="green" icon={<Icons.Orders size={16} />} />
          </div>
        </>
      ) : (
        <article className="kpi-client-workspace-panel kpi-client-workspace-panel--table">
          <div className="kpi-client-workspace-panel-header">
            <div className="kpi-client-panel-title-group">
              <h3>Actividad individual</h3>
              <p>Ordenado por total de órdenes. Haz clic en un cliente para ver su detalle.</p>
            </div>
            <span className="kpi-badge info">{visibleClients.length} clientes</span>
          </div>
          <div className="kpi-filter-row kpi-client-filter-row">
            <KPISearchBox
              value={search}
              onChange={value => { setSearch(value); setPage(1) }}
              onClear={() => { setSearch(''); setPage(1) }}
              placeholder="Buscar cliente o material…"
              resultCount={rows.length}
              totalCount={visibleClients.length}
            />
            <div className="kpi-materials-filter-control">
              <span>Crédito activo</span>
              <FilterSelect
                icon={<Icons.Money size={14} />}
                value={credit}
                onChange={value => { setCredit(value); setPage(1) }}
                options={[{ value: 'all', label: 'Todos' }, { value: 'yes', label: 'Con crédito' }]}
                placeholder="Seleccionar"
                label="Filtrar clientes con crédito activo"
              />
            </div>
            <div className="kpi-materials-filter-control">
              <span>Pago parcial</span>
              <FilterSelect
                icon={<Icons.Money size={14} />}
                value={partial}
                onChange={value => { setPartial(value); setPage(1) }}
                options={[{ value: 'all', label: 'Todos' }, { value: 'yes', label: 'Con parcial' }]}
                placeholder="Seleccionar"
              />
            </div>
            <div className="kpi-materials-filter-control">
              <span>Pago pendiente</span>
              <FilterSelect
                icon={<Icons.AlertCircle size={14} />}
                value={pending}
                onChange={value => { setPending(value); setPage(1) }}
                options={[{ value: 'all', label: 'Todos' }, { value: 'yes', label: 'Con pendiente' }]}
                placeholder="Seleccionar"
              />
            </div>
            <div className="kpi-materials-filter-control">
              <span>Ordenar</span>
              <FilterSelect
                icon={<Icons.Hash size={14} />}
                value={sort}
                onChange={value => { setSort(value); setPage(1) }}
                options={[
                  { value: 'orders', label: 'Más órdenes' },
                  { value: 'health', label: 'Mejor salud' },
                  { value: 'cancel', label: 'Mayor cancelación' },
                  { value: 'name', label: 'Nombre A–Z' }
                ]}
                placeholder="Seleccionar"
              />
            </div>
          </div>
          <div className="kpi-client-table-scroll">
            <table className="kpi-client-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>Material favorito</th>
                  <th>Actividad</th>
                  <th>Cancelación</th>
                  <th>Promedio/mes</th>
                  <th>Diseño</th>
                  <th>911 / Normal</th>
                  <th>Salud</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((client, index) => (
                  <tr
                    key={client.client_id}
                    tabIndex="0"
                    onClick={() => setSelectedClient(client)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedClient(client) }}
                  >
                    <td>{(activePage - 1) * PAGE_SIZE + index + 1}</td>
                    <td>
                      <div className="kpi-client-name-cell">
                        <span className="kpi-client-avatar">{getInitials(client.client_name)}</span>
                        <div>
                          <strong>{client.client_name}</strong>
                          <small>{client.total_orders} órdenes</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="kpi-client-material">
                        <Icons.Package size={14} />
                        {client.favorite_material}
                      </span>
                    </td>
                    <td>
                      <span className={`kpi-badge ${activityBadgeClass(client.activity)}`}>{client.activity}</span>
                    </td>
                    <td>
                      <b className={client.cancel_rate > 10 ? 'kpi-client-cancel is-high' : 'kpi-client-cancel'}>{client.cancel_rate}%</b>
                    </td>
                    <td>
                      <span className="kpi-client-avg">{client.avg_orders_per_month}</span>
                    </td>
                    <td>
                      <span className="kpi-client-design-cell">
                        <span className="kpi-client-design-internal">I {client.internal_design_orders}</span>
                        <span className="kpi-client-design-external">E {client.external_design_orders}</span>
                      </span>
                    </td>
                    <td>
                      <span className="kpi-client-mix">
                        <span className="kpi-client-mix-urgent">{client.urgent_911_orders}</span>
                        <span aria-hidden="true"> / </span>
                        <span className="kpi-client-mix-normal">{client.normal_orders}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`kpi-badge ${healthBadgeClass(client.health)}`}>
                        {client.health_score} {client.health}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="9"><p className="kpi-client-empty">No hay clientes que coincidan con los filtros.</p></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="kpi-client-table-footer">
            <span>Mostrando {rows.length} de {visibleClients.length} clientes</span>
            <div>
              {Array.from({ length: totalPages }, (_, index) => index + 1)
                .slice(Math.max(0, activePage - 3), activePage + 2)
                .map(value => (
                  <button
                    type="button"
                    key={value}
                    className={value === activePage ? 'is-active' : ''}
                    onClick={() => setPage(value)}
                  >
                    {value}
                  </button>
                ))}
            </div>
          </footer>
        </article>
      )}
      <ClientDetailModal client={selectedClient} onClose={() => setSelectedClient(null)} />
    </section>
  )
}
