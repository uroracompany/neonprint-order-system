import { useState, useEffect, useRef } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, getTrendConfig, KPI_CHART_COLORS } from '../../utils/kpiHelpers'
import { Pagination } from '../ui/Pagination'

const SEMANTIC = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
}

const PALETTE = {
  cyan: '#06B6D4', green: '#10B981', rose: '#F43F5E', amber: '#F59E0B',
  violet: '#8B5CF6', orange: '#F97316', pink: '#EC4899', teal: '#14B8A6',
  indigo: '#6366F1', red: '#EF4444',
  pie: KPI_CHART_COLORS,
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
      {label && <p style={{ margin: 0, fontWeight: 600, color: '#091127', marginBottom: 4 }}>{label}</p>}
      {payload.map((e, i) => (
        <p key={i} style={{ margin: '2px 0', color: e.color || e.payload?.color, fontWeight: 500 }}>{e.name}: {e.value}</p>
      ))}
    </div>
  )
}

function Badge({ color, bg, children }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: bg, color }}>
      {children}
    </span>
  )
}

function AnimatedNumber({ value, duration = 600 }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef(null)
  const numValue = typeof value === 'string' ? parseFloat(value) : Number(value) || 0
  const isDecimal = String(value).includes('.')
  useEffect(() => {
    const start = display
    const diff = numValue - start
    if (diff === 0) return
    const startTime = performance.now()
    const animate = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(start + diff * eased)
      if (progress < 1) ref.current = requestAnimationFrame(animate)
    }
    ref.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(ref.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numValue])
  return <>{isDecimal ? display.toFixed(1) : Math.round(display)}</>
}

function getDeliveryBadge(days) {
  if (days > 10) return { color: '#DC2626', bg: '#FEF2F2', text: 'Lento' }
  if (days > 5) return { color: '#D97706', bg: '#FFFBEB', text: 'Moderado' }
  return { color: '#16A34A', bg: '#F0FDF4', text: 'Rápido' }
}

export default function KPIClientAnalytics({ data }) {
  const [topView, setTopView] = useState('ranking')
  const [selectedClientIdx, setSelectedClientIdx] = useState(-1)
  const [orderSearch, setOrderSearch] = useState('')
  const [cancelIdx, setCancelIdx] = useState(-1)
  const [cancelSearch, setCancelSearch] = useState('')
  const [freqIdx, setFreqIdx] = useState(-1)
  const [freqSearch, setFreqSearch] = useState('')
  const [matIdx, setMatIdx] = useState(-1)
  const [matSearch, setMatSearch] = useState('')
  const [healthIdx, setHealthIdx] = useState(-1)
  const [healthSearch, setHealthSearch] = useState('')
  const [evoMonths, setEvoMonths] = useState(6)
  const [evoIdx, setEvoIdx] = useState(-1)
  const [evoSearch, setEvoSearch] = useState('')
  const [evoCustom, setEvoCustom] = useState(false)
  const [evoDateFrom, setEvoDateFrom] = useState('')
  const [evoDateTo, setEvoDateTo] = useState('')
  const [payIdx, setPayIdx] = useState(-1)
  const [paySearch, setPaySearch] = useState('')
  const [payPage, setPayPage] = useState(1)
  const [now] = useState(() => Date.now())

  if (!data) return null

  const client = data.client_analytics || {}
  const kpis = data.client_kpis || {}
  const topClients = client.top_clients || []
  const inactiveClients = client.inactive_clients?.clients || []
  const newCount = client.new_clients?.count || 0
  const recurringCount = client.recurring_clients?.count || 0
  const totalCount = data.total_clients || 0
  const inactiveCount = inactiveClients.length

  const cancellationData = kpis.cancellation_by_client || []
  const orderTypeData = kpis.order_type_by_client || []
  const deliveryData = kpis.delivery_time_by_client || []
  const frequencyData = kpis.frequency_by_client || []
  const retentionRate = kpis.retention_new_clients?.rate || 0

  const topClientsSorted = [...topClients].sort((a, b) => (b.completed_orders || 0) - (a.completed_orders || 0))
  const barData = topClientsSorted.slice(0, 5).map(c => ({
    name: c.name?.length > 14 ? c.name.slice(0, 14) + '...' : c.name,
    fullName: c.name,
    Completadas: c.completed_orders || 0,
  }))

  const totalRI = recurringCount + inactiveCount
  const pctR = totalRI > 0 ? ((recurringCount / totalRI) * 100).toFixed(1) : '0.0'
  const pctI = totalRI > 0 ? ((inactiveCount / totalRI) * 100).toFixed(1) : '0.0'

  const compPie = [
    { name: 'Recurrentes', value: recurringCount, color: PALETTE.green, pct: pctR },
    { name: 'Inactivos', value: inactiveCount, color: PALETTE.red, pct: pctI },
  ].filter(d => d.value > 0)

  const topPie = topClientsSorted.slice(0, 5).map((c, i) => ({
    name: c.name?.length > 16 ? c.name.slice(0, 16) + '...' : c.name,
    value: c.completed_orders || 0,
    color: PALETTE.pie[i % PALETTE.pie.length],
  }))

  const heroCards = [
    { id: 'total', label: 'Total Clientes', value: totalCount, icon: <Icons.User size={16} />, sem: SEMANTIC.neutral, sub: 'Registrados en el sistema', trend: { color: '#0284C7', bg: '#E0F2FE', arrow: '→', change: '0.0' } },
    { id: 'new', label: 'Clientes Nuevos', value: newCount, icon: <Icons.UserCheck size={16} />, sem: SEMANTIC.positive, sub: 'Últimos 3 días', trend: getTrendConfig(newCount, 0) },
    { id: 'recurring', label: 'Recurrentes', value: recurringCount, icon: <Icons.Users size={16} />, sem: SEMANTIC.positive, sub: 'Repiten pedidos', trend: getTrendConfig(recurringCount, 0) },
    { id: 'retention', label: 'Retención', value: retentionRate, icon: <Icons.TrendUp size={16} />, sem: SEMANTIC.positive, sub: 'Tasa de retorno', trend: getTrendConfig(retentionRate, 0), suffix: '%' },
    { id: 'inactive', label: 'Inactivos', value: inactiveCount, icon: <Icons.UserMinus size={16} />, sem: SEMANTIC.negative, sub: 'Sin actividad >180 días', trend: getTrendConfig(inactiveCount, 0) },
  ]

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Clientes</span>
          <h2 className="kpi-section-title">Análisis de Clientes</h2>
          <p className="kpi-section-subtitle">Métricas, distribución y tendencias para comprender mejor la base de clientes.</p>
        </div>
      </div>

      <div className="kpi-hero-grid kpi-hero-grid--5">
        {heroCards.map(c => (
          <div key={c.id} className="kpi-hero-card">
            <div className="kpi-hero-header">
              <div className="kpi-hero-label">{c.label}</div>
              <div className="kpi-hero-icon" style={{ background: c.sem.iconBg, color: c.sem.iconColor }}>{c.icon}</div>
            </div>
            <div className="kpi-hero-value">{formatNumber(c.value)}{c.suffix || ''}</div>
            <div className="kpi-hero-footer">
              <div className="kpi-hero-subtitle">{c.sub}</div>
              <div className="kpi-hero-trend" style={{ background: c.sem.trendBg, color: c.sem.trendColor }}>
                <span>{c.trend.arrow}</span>
                {c.trend.change !== '0.0' && <span>{Math.abs(Number(c.trend.change))}%</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {(() => {
        const newClientsList = client.new_clients?.clients || []
        return newClientsList.length > 0 ? (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Onboarding</span>
                <h2 className="kpi-section-title">Clientes Nuevos Recientes</h2>
                <p className="kpi-section-subtitle">Últimos clientes registrados en el sistema.</p>
              </div>
            </div>
            <div className="kpi-table-wrapper">
              <table className="kpi-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Cliente</th>
                    <th style={{ textAlign: 'right' }}>Fecha de Registro</th>
                    <th style={{ textAlign: 'right' }}>Días desde Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {newClientsList.map((c, i) => {
                    const daysSince = Math.max(0, Math.round((now - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24)))
                    const isNew = daysSince <= 3
                    return (
                      <tr key={i} style={isNew ? { background: '#F0FDFA' } : undefined}>
                        <td className="kpi-table-rank">{i + 1}</td>
                        <td className="kpi-table-name">{c.name}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, color: '#64748b' }}>{new Date(c.created_at).toLocaleDateString('es-MX')}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Badge color={isNew ? '#16A34A' : '#64748b'} bg={isNew ? '#DCFCE7' : '#F1F5F9'}>{daysSince}d</Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null
      })()}

      {(() => {
        const vipAlert = (data.smart_alerts || []).find(a => a.type === 'vip_inactive')
        return vipAlert ? (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Alerta</span>
                <h2 className="kpi-section-title">Clientes VIP Inactivos</h2>
                <p className="kpi-section-subtitle">Clientes importantes que requieren atención.</p>
              </div>
            </div>
            <div className="kpi-card" style={{ padding: 20, borderLeft: '4px solid #DC2626', background: '#FEF2F2' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>
                  <Icons.AlertCircle size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>{vipAlert.title}</div>
                  <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.5, marginBottom: 8 }}>{vipAlert.message}</div>
                  <Badge color="#991B1B" bg="#FEE2E2">{vipAlert.action}</Badge>
                </div>
              </div>
            </div>
          </div>
        ) : null
      })()}

      <div className="kpi-section">
        <div className="kpi-section-header">
          <div>
            <span className="kpi-section-kicker">Distribución</span>
            <h2 className="kpi-section-title">Recurrentes vs. Inactivos</h2>
            <p className="kpi-section-subtitle">Proporción entre clientes que repiten y ceux sin actividad reciente.</p>
          </div>
          <Badge
            color={retentionRate >= 30 ? '#16A34A' : retentionRate >= 15 ? '#D97706' : '#DC2626'}
            bg={retentionRate >= 30 ? '#DCFCE7' : retentionRate >= 15 ? '#FFFBEB' : '#FEE2E2'}
          >
            Retención: {retentionRate}%
          </Badge>
        </div>
        <div className="kpi-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
            <div style={{ flex: '0 0 240px', height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={compPie} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                    {compPie.map((e, i) => <Cell key={i} fill={e.color} stroke="#fff" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
                        <p style={{ margin: 0, fontWeight: 600, color: d.color }}>{d.name}</p>
                        <p style={{ margin: '4px 0 0', fontWeight: 500 }}>{formatNumber(d.value)} clientes — {d.pct}%</p>
                      </div>
                    )
                  }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {compPie.map(item => (
                <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#091127', marginBottom: 4 }}>{item.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${item.pct}%`, height: '100%', background: item.color, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 18, fontWeight: 800, color: item.color, minWidth: 55, textAlign: 'right' }}>{item.pct}%</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{formatNumber(item.value)} clientes</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(() => {
        const frequency = kpis.frequency_by_client || []
        if (frequency.length === 0) return null
        const filteredEvoClients = frequency.filter(c => c.client_name?.toLowerCase().includes(evoSearch.toLowerCase()))
        const isAllEvo = evoIdx === -1
        const selectedClient = isAllEvo ? null : frequency[evoIdx] || frequency[0]
        const nowDate = new Date()

        const useCustom = evoCustom && evoDateFrom && evoDateTo
        let dateFrom, dateTo, totalDays
        if (useCustom) {
          dateFrom = new Date(evoDateFrom + 'T00:00:00')
          dateTo = new Date(evoDateTo + 'T23:59:59')
          totalDays = Math.round((dateTo - dateFrom) / (1000 * 60 * 60 * 24)) + 1
        }

        const isDaily = useCustom ? totalDays <= 31 : evoMonths === 1
        const isWeekly = useCustom ? totalDays > 31 && totalDays <= 120 : evoMonths === 3

        let evoData, evoStats, evoSubtitle, evoLegend
        if (isDaily) {
          const dayLabels = []
          if (useCustom) {
            for (let i = 0; i < totalDays; i++) {
              const d = new Date(dateFrom)
              d.setDate(d.getDate() + i)
              dayLabels.push(d.toISOString().slice(0, 10))
            }
          } else {
            for (let i = 29; i >= 0; i--) {
              const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - i)
              dayLabels.push(d.toISOString().slice(0, 10))
            }
          }
          if (isAllEvo) {
            const activeByDay = dayLabels.map(day => frequency.filter(c => c.daily && c.daily[day] > 0).length)
            const ordersByDay = dayLabels.map(day => frequency.reduce((s, c) => s + (c.daily?.[day] || 0), 0))
            evoData = dayLabels.map((d, i) => ({
              name: new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
              Clientes: activeByDay[i],
              Órdenes: ordersByDay[i],
            }))
            evoStats = [
              { label: useCustom ? 'Días en rango' : 'Días analizados', value: dayLabels.length, color: PALETTE.cyan },
              { label: 'Pico de actividad', value: Math.max(...ordersByDay, 0), color: PALETTE.green },
              { label: 'Promedio activos', value: activeByDay.length > 0 ? Math.round(activeByDay.reduce((s, v) => s + v, 0) / activeByDay.length) : 0, color: PALETTE.violet },
            ]
            evoSubtitle = useCustom
              ? `Comportamiento diario del ${dateFrom.toLocaleDateString('es-MX')} al ${dateTo.toLocaleDateString('es-MX')}.`
              : 'Comportamiento diario de la base de clientes en el último mes.'
            evoLegend = (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.cyan }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Clientes Activos</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.green }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Órdenes Totales</span>
                </div>
              </div>
            )
          } else {
            const ordersByDay = dayLabels.map(day => selectedClient?.daily?.[day] || 0)
            const totalOrders = ordersByDay.reduce((s, v) => s + v, 0)
            evoData = dayLabels.map((d, i) => ({
              name: new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
              Órdenes: ordersByDay[i],
            }))
            evoStats = [
              { label: useCustom ? 'Días en rango' : 'Días analizados', value: dayLabels.length, color: PALETTE.cyan },
              { label: 'Pico de actividad', value: Math.max(...ordersByDay, 0), color: PALETTE.green },
              { label: 'Órdenes totales', value: totalOrders, color: PALETTE.violet },
            ]
            evoSubtitle = useCustom
              ? `Órdenes diarias de ${selectedClient?.client_name} del ${dateFrom.toLocaleDateString('es-MX')} al ${dateTo.toLocaleDateString('es-MX')}.`
              : `Órdenes diarias de ${selectedClient?.client_name} en el último mes.`
            evoLegend = (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.green }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Órdenes de {selectedClient?.client_name}</span>
                </div>
              </div>
            )
          }
        } else if (isWeekly) {
          const weekLabels = []
          const weekStarts = []
          if (useCustom) {
            let cursor = new Date(dateFrom)
            cursor.setDate(cursor.getDate() - cursor.getDay())
            while (cursor <= dateTo) {
              weekLabels.push(cursor.toISOString().slice(0, 10))
              weekStarts.push(new Date(cursor))
              cursor.setDate(cursor.getDate() + 7)
            }
          } else {
            for (let i = 12; i >= 0; i--) {
              const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - (i * 7))
              const weekStart = new Date(d)
              weekStart.setDate(d.getDate() - d.getDay())
              weekLabels.push(weekStart.toISOString().slice(0, 10))
              weekStarts.push(weekStart)
            }
          }
          const dayLabels = []
          if (useCustom) {
            for (let i = 0; i < totalDays; i++) {
              const d = new Date(dateFrom)
              d.setDate(d.getDate() + i)
              dayLabels.push(d.toISOString().slice(0, 10))
            }
          } else {
            for (let i = 89; i >= 0; i--) {
              const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - i)
              dayLabels.push(d.toISOString().slice(0, 10))
            }
          }
          if (isAllEvo) {
            const ordersByWeek = weekLabels.map((ws, wi) => {
              const weekEnd = new Date(weekStarts[wi])
              weekEnd.setDate(weekEnd.getDate() + 7)
              const weStr = weekEnd.toISOString().slice(0, 10)
              return dayLabels.filter(day => day >= ws && day < weStr)
                .reduce((s, day) => s + frequency.reduce((sc, c) => sc + (c.daily?.[day] || 0), 0), 0)
            })
            const activeByWeek = weekLabels.map((ws, wi) => {
              const weekEnd = new Date(weekStarts[wi])
              weekEnd.setDate(weekEnd.getDate() + 7)
              const weStr = weekEnd.toISOString().slice(0, 10)
              const weekDays = dayLabels.filter(day => day >= ws && day < weStr)
              return frequency.filter(c => weekDays.some(day => c.daily?.[day] > 0)).length
            })
            evoData = weekStarts.map((ws, i) => ({
              name: `Sem ${ws.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`,
              Clientes: activeByWeek[i],
              Órdenes: ordersByWeek[i],
            }))
            evoStats = [
              { label: useCustom ? 'Semanas en rango' : 'Semanas analizadas', value: weekLabels.length, color: PALETTE.cyan },
              { label: 'Pico de actividad', value: Math.max(...ordersByWeek, 0), color: PALETTE.green },
              { label: 'Promedio activos', value: activeByWeek.length > 0 ? Math.round(activeByWeek.reduce((s, v) => s + v, 0) / activeByWeek.length) : 0, color: PALETTE.violet },
            ]
            evoSubtitle = useCustom
              ? `Comportamiento semanal del ${dateFrom.toLocaleDateString('es-MX')} al ${dateTo.toLocaleDateString('es-MX')}.`
              : 'Comportamiento semanal de la base de clientes en los últimos 3 meses.'
            evoLegend = (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.cyan }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Clientes Activos</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.green }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Órdenes Totales</span>
                </div>
              </div>
            )
          } else {
            const ordersByWeek = weekLabels.map((ws, wi) => {
              const weekEnd = new Date(weekStarts[wi])
              weekEnd.setDate(weekEnd.getDate() + 7)
              const weStr = weekEnd.toISOString().slice(0, 10)
              return dayLabels.filter(day => day >= ws && day < weStr)
                .reduce((s, day) => s + (selectedClient?.daily?.[day] || 0), 0)
            })
            const totalOrders = ordersByWeek.reduce((s, v) => s + v, 0)
            evoData = weekStarts.map((ws, i) => ({
              name: `Sem ${ws.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`,
              Órdenes: ordersByWeek[i],
            }))
            evoStats = [
              { label: useCustom ? 'Semanas en rango' : 'Semanas analizadas', value: weekLabels.length, color: PALETTE.cyan },
              { label: 'Pico de actividad', value: Math.max(...ordersByWeek, 0), color: PALETTE.green },
              { label: 'Órdenes totales', value: totalOrders, color: PALETTE.violet },
            ]
            evoSubtitle = useCustom
              ? `Órdenes semanales de ${selectedClient?.client_name} del ${dateFrom.toLocaleDateString('es-MX')} al ${dateTo.toLocaleDateString('es-MX')}.`
              : `Órdenes semanales de ${selectedClient?.client_name} en los últimos 3 meses.`
            evoLegend = (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.green }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Órdenes de {selectedClient?.client_name}</span>
                </div>
              </div>
            )
          }
        } else {
          const monthLabels = []
          if (useCustom) {
            const startMonth = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1)
            const endMonth = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1)
            let cursor = new Date(startMonth)
            while (cursor <= endMonth) {
              monthLabels.push(cursor.toISOString().slice(0, 7))
              cursor.setMonth(cursor.getMonth() + 1)
            }
          } else {
            for (let i = evoMonths - 1; i >= 0; i--) {
              const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)
              monthLabels.push(d.toISOString().slice(0, 7))
            }
          }
          if (isAllEvo) {
            const activeByMonth = monthLabels.map(m => frequency.filter(c => c.months && c.months[m] > 0).length)
            const ordersByMonth = monthLabels.map(m => frequency.reduce((s, c) => s + (c.months?.[m] || 0), 0))
            evoData = monthLabels.map((m, i) => ({
              name: new Date(m + '-01').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
              Clientes: activeByMonth[i],
              Órdenes: ordersByMonth[i],
            }))
            evoStats = [
              { label: useCustom ? 'Meses en rango' : 'Meses analizados', value: monthLabels.length, color: PALETTE.cyan },
              { label: 'Pico de actividad', value: Math.max(...ordersByMonth, 0), color: PALETTE.green },
              { label: 'Promedio activos', value: activeByMonth.length > 0 ? Math.round(activeByMonth.reduce((s, v) => s + v, 0) / activeByMonth.length) : 0, color: PALETTE.violet },
            ]
            evoSubtitle = useCustom
              ? `Comportamiento mensual del ${dateFrom.toLocaleDateString('es-MX')} al ${dateTo.toLocaleDateString('es-MX')}.`
              : 'Comportamiento de la base de clientes en los últimos meses.'
            evoLegend = (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.cyan }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Clientes Activos</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.green }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Órdenes Totales</span>
                </div>
              </div>
            )
          } else {
            const ordersByMonth = monthLabels.map(m => selectedClient?.months?.[m] || 0)
            const totalOrders = ordersByMonth.reduce((s, v) => s + v, 0)
            evoData = monthLabels.map((m, i) => ({
              name: new Date(m + '-01').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
              Órdenes: ordersByMonth[i],
            }))
            evoStats = [
              { label: useCustom ? 'Meses en rango' : 'Meses analizados', value: monthLabels.length, color: PALETTE.cyan },
              { label: 'Pico de actividad', value: Math.max(...ordersByMonth, 0), color: PALETTE.green },
              { label: 'Órdenes totales', value: totalOrders, color: PALETTE.violet },
            ]
            evoSubtitle = useCustom
              ? `Órdenes de ${selectedClient?.client_name} del ${dateFrom.toLocaleDateString('es-MX')} al ${dateTo.toLocaleDateString('es-MX')}.`
              : `Órdenes de ${selectedClient?.client_name} en los últimos ${evoMonths} meses.`
            evoLegend = (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.green }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Órdenes de {selectedClient?.client_name}</span>
                </div>
              </div>
            )
          }
        }

        return (
          <div className="kpi-section">
            <div className="kpi-section-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
              <div>
                <span className="kpi-section-kicker">Tendencias</span>
                <h2 className="kpi-section-title">Evolución de Clientes</h2>
                <p className="kpi-section-subtitle">{evoSubtitle}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div className="kpi-filter-row" style={{ flex: '0 0 auto', margin: 0 }}>
                  <label>
                    <span>Buscar</span>
                    <input type="text" placeholder="Nombre del cliente..." value={evoSearch} onChange={e => { setEvoSearch(e.target.value); setEvoIdx(-1) }} />
                  </label>
                  <label>
                    <span>Cliente</span>
                    <select value={evoIdx} onChange={e => setEvoIdx(+e.target.value)}>
                      <option value={-1}>Todos</option>
                      {filteredEvoClients.map((cl, i) => <option key={i} value={frequency.indexOf(cl)}>{cl.client_name}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginLeft: 'auto' }}>
                  {!evoCustom && (
                    <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                      {[1, 3, 6, 12].map(m => (
                        <button key={m} className={`kpi-pipeline-view-btn ${evoMonths === m ? 'active' : ''}`} onClick={() => setEvoMonths(m)}>{m}m</button>
                      ))}
                    </div>
                  )}
                  <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                    <button
                      className={`kpi-pipeline-view-btn ${evoCustom ? 'active' : ''}`}
                      onClick={() => setEvoCustom(!evoCustom)}
                      style={evoCustom ? { height: 40, padding: '0 14px', borderRadius: 10, fontSize: 12 } : undefined}
                    >{evoCustom ? 'Usar fechas por defecto' : 'Personalizar fecha'}</button>
                  </div>
                </div>
                {evoCustom && (
                  <div className="kpi-filter-row" style={{ flex: '0 0 auto', margin: 0 }}>
                    <label>
                      <span>Desde</span>
                      <input type="date" value={evoDateFrom} onChange={e => setEvoDateFrom(e.target.value)} />
                    </label>
                    <label>
                      <span>Hasta</span>
                      <input type="date" value={evoDateTo} onChange={e => setEvoDateTo(e.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="kpi-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                {evoStats.map(s => (
                  <div key={s.label} style={{ flex: 1, padding: '12px 16px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ height: 280 }} key={`evo-container-${isAllEvo ? 'all' : evoIdx}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart key={`evo-chart-${isAllEvo ? 'all' : evoIdx}`} data={evoData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id={`gradCyan-${isAllEvo ? 'all' : evoIdx}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.cyan} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={PALETTE.cyan} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`gradGreen-${isAllEvo ? 'all' : evoIdx}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.green} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={PALETTE.green} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                    <Area type="monotone" dataKey="Clientes" stroke={PALETTE.cyan} fill={`url(#gradCyan-${isAllEvo ? 'all' : evoIdx})`} strokeWidth={2} hide={!isAllEvo} />
                    <Area type="monotone" dataKey="Órdenes" stroke={PALETTE.green} fill={`url(#gradGreen-${isAllEvo ? 'all' : evoIdx})`} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {evoLegend}
            </div>
          </div>
        )
      })()}

      <div className="kpi-section">
        <div className="kpi-section-header">
          <div>
            <span className="kpi-section-kicker">Ranking</span>
            <h2 className="kpi-section-title">Top Clientes por Órdenes</h2>
            <p className="kpi-section-subtitle">Los 5 clientes con mayor cantidad de órdenes completadas (sin cancelaciones).</p>
          </div>
          <div className="kpi-pipeline-view-toggle">
            <button className={`kpi-pipeline-view-btn ${topView === 'ranking' ? 'active' : ''}`} onClick={() => setTopView('ranking')}>Ranking</button>
            <button className={`kpi-pipeline-view-btn ${topView === 'pie' ? 'active' : ''}`} onClick={() => setTopView('pie')}>Pastel</button>
            <button className={`kpi-pipeline-view-btn ${topView === 'table' ? 'active' : ''}`} onClick={() => setTopView('table')}>Tabla</button>
          </div>
        </div>
        <div className="kpi-card" style={{ padding: 24 }}>
          {topView === 'ranking' && barData.length === 0 ? (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de clientes</div></div>
          ) : topView === 'ranking' ? (
            <div style={{ height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={105} />
                  <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                  <Bar dataKey="Completadas" fill={PALETTE.cyan} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : topView === 'table' ? (
            <div className="kpi-table-wrapper">
              <table className="kpi-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Cliente</th>
                    <th style={{ textAlign: 'center' }}>Completadas</th>
                    <th style={{ textAlign: 'center' }}>Activas</th>
                    <th style={{ textAlign: 'right' }}>Última Orden</th>
                    <th style={{ textAlign: 'right' }}>Nivel</th>
                  </tr>
                </thead>
                <tbody>
                  {topClientsSorted.slice(0, 5).map((c, i) => {
                    const tc = c.completed_orders || 0
                    const level = tc >= 20 ? { text: 'VIP', color: '#D4A017', bg: '#FEF9C3' }
                      : tc >= 8 ? { text: 'Activo', color: '#16A34A', bg: '#DCFCE7' }
                      : { text: 'Normal', color: '#64748B', bg: '#F1F5F9' }
                    const lastDate = c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('es-MX') : '—'
                    return (
                      <tr key={i}>
                        <td className="kpi-table-rank">{i + 1}</td>
                        <td className="kpi-table-name">{c.name}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{tc}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: c.active_orders > 0 ? '#06B6D4' : '#94A3B8' }}>{c.active_orders || 0}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, color: '#64748b' }}>{lastDate}</td>
                        <td style={{ textAlign: 'right' }}><Badge color={level.color} bg={level.bg}>{level.text}</Badge></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div key={topView} style={{ height: 480 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={topPie} cx="50%" cy="50%" innerRadius={80} outerRadius={160} paddingAngle={2} dataKey="value"
                    isAnimationActive={true}
                    animationBegin={0}
                    animationDuration={800}
                    animationEasing="ease-out"
                    label={({ cx, cy, midAngle, outerRadius, name, percent }) => {
                      if (percent < 0.05) return null
                      const RADIAN = Math.PI / 180
                      const radius = outerRadius + 28
                      const x = cx + radius * Math.cos(-midAngle * RADIAN)
                      const y = cy + radius * Math.sin(-midAngle * RADIAN)
                      const pct = (percent * 100).toFixed(0)
                      return (
                        <text x={x} y={y} fill="#091127" fontSize={13} fontWeight={600} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
                          {name} {pct}%
                        </text>
                      )
                    }}
                    labelLine={{ stroke: '#CBD5E1', strokeWidth: 1, length: 12 }}
                  >
                    {topPie.map((e, i) => <Cell key={i} fill={e.color} stroke="#fff" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    const total = topPie.reduce((s, x) => s + x.value, 0)
                    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0'
                    return (
                      <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
                        <p style={{ margin: 0, fontWeight: 600, color: d.color }}>{d.name}</p>
                        <p style={{ margin: '4px 0 0', fontWeight: 500 }}>{formatNumber(d.value)} órdenes — {pct}%</p>
                      </div>
                    )
                  }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="kpi-section">
        <div className="kpi-section-header">
          <div>
            <span className="kpi-section-kicker">Retención</span>
            <h2 className="kpi-section-title">Retención de Clientes Nuevos</h2>
            <p className="kpi-section-subtitle">Porcentaje de clientes nuevos que realizaron al menos un segundo pedido.</p>
          </div>
        </div>
        <div className="kpi-card" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 80, height: 80, position: 'relative', flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={[{ value: retentionRate }, { value: 100 - retentionRate }]} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={38} startAngle={90} endAngle={-270} paddingAngle={0} stroke="none">
                  <Cell fill={retentionRate >= 30 ? '#16A34A' : retentionRate >= 15 ? '#F97316' : '#EF4444'} />
                  <Cell fill="#E2E8F0" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#091127' }}>{retentionRate}%</span>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#091127', marginBottom: 2 }}>
              {retentionRate >= 30 ? 'Excelente retención' : retentionRate >= 15 ? 'Retención moderada' : 'Retención baja'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              {retentionRate >= 30 ? 'Los clientes nuevos repiten consistentemente.' : retentionRate >= 15 ? 'Clientes nuevos regresan parcialmente. Considerar fidelización.' : 'Pocos repiten. Revisar experiencia de primera compra.'}
            </div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Meta</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>30%</div>
          </div>
        </div>
      </div>

      {(() => {
        const ps = data.payment_summary || {}
        const credito = ps.credito || 0
        const parcial = ps.parcial || 0
        const pendingPayment = ps.pending_payment || 0
        const agedOrders = ps.pending_payment_aged?.orders || []
        const byClient = ps.by_client || []
        const totalPending = credito + parcial + pendingPayment
        if (totalPending === 0) return null

        const filteredPayClients = byClient.filter(cl =>
          cl.client_name?.toLowerCase().includes(paySearch.toLowerCase())
        )
        const isPayAll = payIdx === -1
        let payClient, payDetail
        if (isPayAll) {
          payClient = { client_name: 'Todos los clientes' }
          payDetail = {
            credito_count: credito,
            parcial_count: parcial,
            total_pending: byClient.reduce((s, c) => s + c.total_pending, 0),
            orders: byClient.flatMap(c => c.orders),
          }
        } else {
          payClient = filteredPayClients[payIdx] || filteredPayClients[0]
          payDetail = payClient || null
        }

        const creditPartialPie = [
          { name: 'Crédito', value: credito, color: PALETTE.rose },
          { name: 'Parcial', value: parcial, color: PALETTE.amber },
        ].filter(d => d.value > 0)

        const pendingPie = [
          { name: 'Pendiente', value: pendingPayment, color: PALETTE.orange },
        ].filter(d => d.value > 0)

        const getSeverity = (days) => {
          if (days > 30) return { color: '#DC2626', bg: '#FEE2E2', text: `${Math.round(days)}d` }
          if (days > 15) return { color: '#D97706', bg: '#FFFBEB', text: `${Math.round(days)}d` }
          return { color: '#06B6D4', bg: '#E0F2FE', text: `${Math.round(days)}d` }
        }

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Finanzas</span>
                <h2 className="kpi-section-title">Pagos Pendientes por Cliente</h2>
                <p className="kpi-section-subtitle">Órdenes con crédito o pago pendiente que requieren seguimiento.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#091127', marginBottom: -8 }}>Crédito / Parcial</div>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={creditPartialPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                        {creditPartialPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const denom = credito + parcial || 1
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes — {Math.round((d.value / denom) * 100)}%</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}><AnimatedNumber value={credito + parcial} /></div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>crédito / parcial</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {creditPartialPie.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: e.color }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#091127', marginBottom: -8 }}>Pago Pendiente</div>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pendingPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                        {pendingPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}><AnimatedNumber value={pendingPayment} /></div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>pendientes</div>
                  </div>
                </div>
                {pendingPie.length > 0 && (
                  <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {pendingPie.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: e.color }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{e.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {byClient.length > 0 && (
              <div className="kpi-filter-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
                <label>
                  <span>Buscar</span>
                    <input type="text" placeholder="Nombre del cliente..." value={paySearch} onChange={e => { setPaySearch(e.target.value); setPayIdx(-1); setPayPage(1) }} />
                </label>
                <label>
                  <span>Cliente</span>
                    <select value={payIdx} onChange={e => { setPayIdx(+e.target.value); setPayPage(1) }}>
                    <option value={-1}>Todos</option>
                    {filteredPayClients.map((cl, i) => <option key={i} value={byClient.indexOf(cl)}>{cl.client_name}</option>)}
                  </select>
                </label>
              </div>
            )}

            {payDetail && (
              <div className="kpi-card" style={{ padding: '24px 28px', marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: PALETTE.indigo + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icons.User size={18} color={PALETTE.indigo} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#091127' }}>{payDetail.client_name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{payDetail.orders.length} órdenes con credito/parcial</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div style={{ padding: '14px 16px', borderRadius: 10, background: '#FFF1F2', border: '1px solid #FECDD3' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#9F1239', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Crédito</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#BE123C' }}>{payDetail.credito_count}</div>
                  </div>
                  <div style={{ padding: '14px 16px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Parcial</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#D97706' }}>{payDetail.parcial_count}</div>
                  </div>
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Detalle de Órdenes</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {payDetail.orders.length === 0 ? (
                    <div className="kpi-empty-state" style={{ padding: 16 }}><div className="kpi-empty-title">Sin órdenes</div></div>
                  ) : (() => {
                    const PAGE_SIZE = 7
                    const totalPages = Math.ceil(payDetail.orders.length / PAGE_SIZE)
                    const paged = payDetail.orders.slice((payPage - 1) * PAGE_SIZE, payPage * PAGE_SIZE)
                    return (
                      <>
                        {paged.map((o, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                            <Badge
                              color={o.payment_status === 'credito' ? '#9F1239' : '#92400E'}
                              bg={o.payment_status === 'credito' ? '#FFF1F2' : '#FFFBEB'}
                            >
                              {o.payment_status === 'credito' ? 'Crédito' : 'Parcial'}
                            </Badge>
                            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#475569' }}>
                              {new Date(o.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                              {o.invoice_number || 'Sin factura'}
                            </div>
                          </div>
                        ))}
                        {totalPages > 1 && (
                          <div style={{ marginTop: 8 }}>
                            <Pagination currentPage={payPage} totalPages={totalPages} onPageChange={setPayPage} />
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}

            {agedOrders.length > 0 && (
              <div className="kpi-card" style={{ padding: '24px 28px', marginTop: 16 }}>
                <div style={{ paddingBottom: 12, borderBottom: '1px solid #F1F5F9', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Órdenes Vencidas ({agedOrders.length})</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>Pagos pendientes con más de 3 días de antigüedad.</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflow: 'auto' }}>
                  {agedOrders.slice(0, 8).map((o, i) => {
                    const sv = getSeverity(o.days_pending)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#091127', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.client_name}</div>
                        </div>
                        <Badge color={sv.color} bg={sv.bg}>{sv.text}</Badge>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {(() => {
        const materialsByClient = kpis.materials_by_client || []
        if (materialsByClient.length === 0) return null
        const filteredMatClients = materialsByClient.filter(cl => cl.client_name?.toLowerCase().includes(matSearch.toLowerCase()))
        const isAllMat = matIdx === -1
        let matClient, matMaterials, matTotal
        if (isAllMat) {
          const globalMats = {}
          materialsByClient.forEach(cl => {
            cl.materials.forEach(m => {
              globalMats[m.name] = (globalMats[m.name] || 0) + m.count
            })
          })
          matMaterials = Object.entries(globalMats)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
          matTotal = matMaterials.reduce((s, m) => s + m.count, 0)
          matClient = { client_name: 'Todos los clientes' }
        } else {
          const cl = materialsByClient[matIdx] || materialsByClient[0]
          matClient = cl
          matMaterials = cl.materials || []
          matTotal = matMaterials.reduce((s, m) => s + m.count, 0)
        }
        const matPie = matMaterials.slice(0, 6).map((m, i) => ({
          name: m.name?.length > 16 ? m.name.slice(0, 16) + '...' : m.name,
          value: m.count,
          color: PALETTE.pie[i % PALETTE.pie.length],
        }))
        const maxMatCount = matMaterials.length > 0 ? matMaterials[0].count : 1
        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Materiales</span>
                <h2 className="kpi-section-title">Materiales Preferidos por Cliente</h2>
                <p className="kpi-section-subtitle">Materiales que más consume cada cliente.</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                  <input type="text" placeholder="Nombre del cliente..." value={matSearch} onChange={e => { setMatSearch(e.target.value); setMatIdx(-1) }} />
                </label>
                <label>
                  <span>Cliente</span>
                  <select value={matIdx} onChange={e => setMatIdx(+e.target.value)}>
                    <option value={-1}>Todos</option>
                    {filteredMatClients.map((cl, i) => <option key={i} value={materialsByClient.indexOf(cl)}>{cl.client_name}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie key={matIdx} data={matPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                        {matPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes — {matTotal > 0 ? Math.round((d.value / matTotal) * 100) : 0}%</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}><AnimatedNumber key={matIdx} value={matTotal} /></div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>usos</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{matClient.client_name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{matMaterials.length} material{matMaterials.length !== 1 ? 'es' : ''}</div>
                </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Ranking de Materiales</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'auto' }}>
                  {matMaterials.length === 0 ? (
                    <div className="kpi-empty-state" style={{ padding: 16 }}><div className="kpi-empty-title">Sin datos</div></div>
                  ) : matMaterials.map((m, i) => {
                    const pct = maxMatCount > 0 ? (m.count / maxMatCount) * 100 : 0
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 20, fontSize: 12, fontWeight: 600, color: '#94A3B8', textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#091127', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: PALETTE.pie[i % PALETTE.pie.length], marginLeft: 8, flexShrink: 0 }}>{m.count}</span>
                          </div>
                          <div style={{ width: '100%', height: 5, background: '#E8EDF8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[i % PALETTE.pie.length], borderRadius: 3, transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {cancellationData.length > 0 && (() => {
        const filteredCancel = cancellationData.filter(cl => cl.client_name?.toLowerCase().includes(cancelSearch.toLowerCase()))
        const isAllCancel = cancelIdx === -1
        let c, completed
        if (isAllCancel) {
          const agg = cancellationData.reduce((a, cl) => ({ total_orders: a.total_orders + (cl.total_orders || 0), cancelled_orders: a.cancelled_orders + (cl.cancelled_orders || 0) }), { total_orders: 0, cancelled_orders: 0 })
          c = { client_name: 'Todos los clientes', total_orders: agg.total_orders, cancelled_orders: agg.cancelled_orders, cancel_rate: agg.total_orders > 0 ? Math.round((agg.cancelled_orders / agg.total_orders) * 1000) / 10 : 0 }
        } else {
          c = cancellationData[cancelIdx] || cancellationData[0]
        }
        completed = (c.total_orders || 0) - (c.cancelled_orders || 0)
        const cancelPie = [
          { name: 'Completadas', value: completed, color: PALETTE.green },
          { name: 'Canceladas', value: c.cancelled_orders || 0, color: PALETTE.rose },
        ].filter(d => d.value > 0)

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Calidad</span>
                <h2 className="kpi-section-title">Cancelación por Cliente</h2>
                <p className="kpi-section-subtitle">Tasa de cancelación por cliente.</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                  <input type="text" placeholder="Nombre del cliente..." value={cancelSearch} onChange={e => { setCancelSearch(e.target.value); setCancelIdx(-1) }} />
                </label>
                <label>
                  <span>Cliente</span>
                  <select value={cancelIdx} onChange={e => setCancelIdx(+e.target.value)}>
                    <option value={-1}>Todos</option>
                    {filteredCancel.map((cl, i) => <option key={i} value={cancellationData.indexOf(cl)}>{cl.client_name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie key={cancelIdx} data={cancelPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                        {cancelPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes — {c.total_orders > 0 ? Math.round((d.value / c.total_orders) * 100) : 0}%</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: 36, fontWeight: 800, color: c.cancel_rate >= 20 ? '#DC2626' : c.cancel_rate >= 10 ? '#D97706' : '#16A34A', lineHeight: 1 }}><AnimatedNumber key={cancelIdx} value={c.cancel_rate} />%</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>cancelación</div>
                      {!isAllCancel && (() => {
                        const avgRate = cancellationData.length > 0
                          ? cancellationData.reduce((s, cl) => s + (cl.cancel_rate || 0), 0) / cancellationData.length
                          : 0
                        const diff = c.cancel_rate - avgRate
                        const improved = diff < 0
                        return (
                          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: improved ? '#DCFCE7' : '#FEE2E2', color: improved ? '#16A34A' : '#DC2626' }}>
                            {improved ? '▲' : '▼'} {improved ? 'Mejoró' : 'Empeoró'} vs promedio ({avgRate.toFixed(1)}%)
                          </div>
                        )
                      })()}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 28, justifyContent: 'center' }}>
                  {cancelPie.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: e.color }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Cliente</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>{c.client_name}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                    <div style={{ width: 4, background: PALETTE.green, flexShrink: 0 }} />
                    <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Completadas</span>
                        <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{completed}</span>
                      </div>
                      <span style={{ fontSize: 20, fontWeight: 800, color: '#16A34A' }}>{c.total_orders > 0 ? Math.round((completed / c.total_orders) * 100) : 0}%</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                    <div style={{ width: 4, background: PALETTE.rose, flexShrink: 0 }} />
                    <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Canceladas</span>
                        <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{c.cancelled_orders}</span>
                      </div>
                      <span style={{ fontSize: 20, fontWeight: 800, color: '#F43F5E' }}>{c.cancel_rate}%</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 4, padding: '10px 14px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>Total de órdenes</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#091127' }}>{c.total_orders}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {deliveryData.length > 0 && (
        <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Operaciones</span>
              <h2 className="kpi-section-title">Tiempo de Entrega por Cliente</h2>
              <p className="kpi-section-subtitle">Desempeño de entrega: a tiempo vs con retraso.</p>
            </div>
          </div>
          <div className="kpi-table-wrapper">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th style={{ textAlign: 'center' }}>Entregadas</th>
                  <th style={{ textAlign: 'center' }}>A Tiempo</th>
                  <th style={{ textAlign: 'center' }}>Retraso</th>
                  <th style={{ textAlign: 'right' }}>Desempeño</th>
                </tr>
              </thead>
              <tbody>
                {deliveryData.map((c, i) => {
                  const b = getDeliveryBadge(c.avg_delivery_days)
                  return (
                    <tr key={i}>
                      <td className="kpi-table-rank">{i + 1}</td>
                      <td className="kpi-table-name">{c.client_name}</td>
                      <td style={{ textAlign: 'center' }}>{c.total_delivered}</td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: '#16A34A' }}>{c.on_time}</td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: c.late > 0 ? '#DC2626' : '#94A3B8' }}>{c.late}</td>
                      <td style={{ textAlign: 'right' }}><Badge {...b}>{b.text}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(() => {
            const ranges = [
              { name: '0-3 días', min: 0, max: 3, color: '#16A34A' },
              { name: '4-7 días', min: 3.01, max: 7, color: '#06B6D4' },
              { name: '8-14 días', min: 7.01, max: 14, color: '#F97316' },
              { name: '15+ días', min: 14.01, max: Infinity, color: '#EF4444' },
            ]
            const distData = ranges.map(r => ({
              name: r.name,
              Cantidad: deliveryData.filter(c => c.avg_delivery_days >= r.min && c.avg_delivery_days <= r.max).reduce((s, c) => s + c.total_delivered, 0),
              color: r.color,
            }))
            const maxVal = Math.max(...distData.map(d => d.Cantidad), 1)
            return (
              <div className="kpi-card" style={{ padding: 24, marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#091127', marginBottom: 16 }}>Distribución de Días de Entrega</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {distData.map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 80, fontSize: 12, fontWeight: 500, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>{d.name}</span>
                      <div style={{ flex: 1, height: 24, background: '#F1F5F9', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                        <div style={{ width: `${(d.Cantidad / maxVal) * 100}%`, height: '100%', background: d.color, borderRadius: 6, transition: 'width 0.4s ease', minWidth: d.Cantidad > 0 ? 24 : 0 }} />
                        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: d.Cantidad > 0 ? '#fff' : '#94A3B8' }}>{d.Cantidad}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {frequencyData.length > 0 && (() => {
        const filteredFreq = frequencyData.filter(cl => cl.client_name?.toLowerCase().includes(freqSearch.toLowerCase()))
        const isAllFreq = freqIdx === -1
        let freqClient, freqTotal, freqActiveMonths, freqAvg
        if (isAllFreq) {
          const agg = frequencyData.reduce((a, c) => ({
            total_orders: a.total_orders + (c.total_orders || 0),
            active_months: a.active_months + (c.active_months || 0),
          }), { total_orders: 0, active_months: 0 })
          freqClient = { client_name: 'Todos los clientes' }
          freqTotal = agg.total_orders
          freqActiveMonths = agg.active_months
          freqAvg = frequencyData.length > 0 ? (agg.total_orders / frequencyData.length).toFixed(1) : '0.0'
        } else {
          freqClient = frequencyData[freqIdx] || frequencyData[0]
          freqTotal = freqClient.total_orders || 0
          freqActiveMonths = freqClient.active_months || 0
          freqAvg = freqClient.orders_per_month || '0.0'
        }

        const avgNum = Number(freqAvg) || 0
        const GOLD = '#D4A017'
        let barColor, barLevel, barMsg, barPct
        if (avgNum >= 21) {
          barColor = GOLD; barLevel = 'Excelente'; barPct = 100
          barMsg = 'Rendimiento excepcional. Cliente de alto valor. Excelente desempeño y alta frecuencia de pedidos.'
        } else if (avgNum >= 13) {
          barColor = '#16A34A'; barLevel = 'Alto'; barPct = 75
          barMsg = 'Excelente nivel de actividad.'
        } else if (avgNum >= 6) {
          barColor = '#F97316'; barLevel = 'Medio'; barPct = 50
          barMsg = 'Buen rendimiento, pero aún puede mejorar.'
        } else {
          barColor = '#EF4444'; barLevel = 'Bajo'; barPct = 25
          barMsg = 'Necesita más órdenes.'
        }
        const isGold = barColor === GOLD

        let freqPie, freqPieTotal
        if (isAllFreq) {
          freqPie = [
            { name: 'Clientes', value: frequencyData.length, color: barColor },
          ]
          freqPieTotal = frequencyData.length
        } else {
          const months = freqClient.months || {}
          const monthEntries = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]))
          if (monthEntries.length > 0) {
            freqPie = monthEntries.map(([month, count]) => ({
              name: month,
              value: count,
              color: barColor,
            }))
          } else {
            freqPie = [
              { name: 'Órdenes', value: freqTotal, color: barColor },
            ].filter(d => d.value > 0)
          }
          freqPieTotal = freqTotal || 1
        }

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Engagement</span>
                <h2 className="kpi-section-title">Frecuencia de Órdenes</h2>
                <p className="kpi-section-subtitle">Promedio de órdenes mensuales por cliente.</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                  <input type="text" placeholder="Nombre del cliente..." value={freqSearch} onChange={e => { setFreqSearch(e.target.value); setFreqIdx(-1) }} />
                </label>
                <label>
                  <span>Cliente</span>
                  <select value={freqIdx} onChange={e => setFreqIdx(+e.target.value)}>
                    <option value={-1}>Todos</option>
                    {filteredFreq.map((cl, i) => <option key={i} value={frequencyData.indexOf(cl)}>{cl.client_name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie key={freqIdx} data={freqPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke={isGold ? '#D4A017' : 'none'}>
                        {freqPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} {isAllFreq ? 'clientes' : 'órdenes'} — {freqPieTotal > 0 ? Math.round((d.value / freqPieTotal) * 100) : 0}%</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}><AnimatedNumber key={freqIdx} value={isAllFreq ? freqAvg : freqTotal} /></div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>{isAllFreq ? 'promedio' : 'órdenes'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 28, justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: barColor }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{barLevel}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                  <h1 style={{ fontSize: 18, fontWeight: 700, color: barColor, margin: 0 }}>{isGold ? 'Rendimiento Excepcional' : barLevel === 'Alto' ? 'Excelente Actividad' : barLevel === 'Medio' ? 'Actividad Moderada' : 'Actividad Baja'}</h1>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>{barMsg}</span>
                </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Cliente</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>{freqClient.client_name}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                    <div style={{ width: 4, background: PALETTE.cyan, flexShrink: 0 }} />
                    <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Órdenes Totales</span>
                        <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{freqTotal}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                    <div style={{ width: 4, background: PALETTE.green, flexShrink: 0 }} />
                    <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Promedio/Mes</span>
                        <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{freqAvg}</span>
                      </div>
                    </div>
                  </div>

                  {!isAllFreq && (
                    <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                      <div style={{ width: 4, background: PALETTE.violet, flexShrink: 0 }} />
                      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Meses Activos</span>
                          <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{freqActiveMonths}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ padding: '16px', borderRadius: 10, background: '#F8FAFC', border: isGold ? '1px solid rgba(212, 160, 23, 0.3)' : '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Nivel de Actividad</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: barColor }}>{barPct}%</span>
                    </div>
                    <div style={{ width: '100%', height: 10, background: '#E2E8F0', borderRadius: 5, overflow: 'hidden' }}>
                      <div className={isGold ? 'kpi-bar-gold' : ''} style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 5, transition: 'width 0.4s ease' }} />
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 500, color: barColor }}>{barMsg}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {orderTypeData.length > 0 && (() => {
        const filteredOrders = orderTypeData.filter(c => c.client_name?.toLowerCase().includes(orderSearch.toLowerCase()))
        const isAll = selectedClientIdx === -1
        let client, total, pctNormal, pctUrgent
        if (isAll) {
          const agg = orderTypeData.reduce((a, c) => ({ normal: a.normal + (c.normal || 0), urgent_911: a.urgent_911 + (c.urgent_911 || 0) }), { normal: 0, urgent_911: 0 })
          client = { client_name: 'Todos los clientes', normal: agg.normal, urgent_911: agg.urgent_911 }
          total = agg.normal + agg.urgent_911
        } else {
          client = orderTypeData[selectedClientIdx] || orderTypeData[0]
          total = (client.normal || 0) + (client.urgent_911 || 0)
        }
        pctNormal = total > 0 ? Math.round((client.normal / total) * 100) : 0
        pctUrgent = total > 0 ? 100 - pctNormal : 0
        const pieData = [
          { name: 'Normal', value: client.normal || 0, color: PALETTE.cyan },
          { name: 'Urgente 911', value: client.urgent_911 || 0, color: PALETTE.rose },
        ]

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Comportamiento</span>
                <h2 className="kpi-section-title">Tipo de Orden por Cliente</h2>
                <p className="kpi-section-subtitle">Distribución de órdenes normales vs urgentes (911).</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                  <input type="text" placeholder="Nombre del cliente..." value={orderSearch} onChange={e => { setOrderSearch(e.target.value); setSelectedClientIdx(-1) }} />
                </label>
                <label>
                  <span>Cliente</span>
                  <select value={selectedClientIdx} onChange={e => setSelectedClientIdx(+e.target.value)}>
                    <option value={-1}>Todos</option>
                    {filteredOrders.map((c, i) => <option key={i} value={orderTypeData.indexOf(c)}>{c.client_name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie key={selectedClientIdx} data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                              <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                              <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes — {total > 0 ? Math.round((d.value / total) * 100) : 0}%</p>
                            </div>
                          )
                        }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}><AnimatedNumber key={selectedClientIdx} value={total} /></div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>órdenes</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 28, justifyContent: 'center' }}>
                    {pieData.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: e.color }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{e.value}</span>
                      </div>
                    ))}
                  </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Cliente</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>{client.client_name}</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                      <div style={{ width: 4, background: PALETTE.cyan, flexShrink: 0 }} />
                      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Normal</span>
                          <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{client.normal}</span>
                        </div>
                        <span style={{ fontSize: 20, fontWeight: 800, color: '#06B6D4' }}>{pctNormal}%</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                      <div style={{ width: 4, background: PALETTE.rose, flexShrink: 0 }} />
                      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>Urgente 911</span>
                          <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{client.urgent_911}</span>
                        </div>
                        <span style={{ fontSize: 20, fontWeight: 800, color: '#F43F5E' }}>{pctUrgent}%</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 4, padding: '10px 14px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>Total de órdenes</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#091127' }}>{total}</span>
                  </div>
              </div>
            </div>
          </div>
        )
      })()}

      {(() => {
        const frequency = kpis.frequency_by_client || []
        const cancellation = kpis.cancellation_by_client || []
        const delivery = kpis.delivery_time_by_client || []
        if (frequency.length === 0 && cancellation.length === 0 && delivery.length === 0) return null

        const clientNames = [...new Set([
          ...frequency.map(c => c.client_name),
          ...cancellation.map(c => c.client_name),
          ...delivery.map(c => c.client_name),
        ])]
        const filteredHealthClients = clientNames.filter(n => n?.toLowerCase().includes(healthSearch.toLowerCase()))
        const isAllHealth = healthIdx === -1

        const calcScore = (name) => {
          const freq = frequency.find(c => c.client_name === name)
          const canc = cancellation.find(c => c.client_name === name)
          const deliv = delivery.find(c => c.client_name === name)
          const freqScore = Math.min(100, ((freq?.orders_per_month || 0) / 10) * 100)
          const cancelScore = 100 - (canc?.cancel_rate || 0)
          const delivScore = deliv?.total_delivered > 0 ? ((deliv.on_time / deliv.total_delivered) * 100) : 50
          return {
            freqScore: Math.round(freqScore),
            cancelScore: Math.round(cancelScore),
            delivScore: Math.round(delivScore),
            total: Math.round(freqScore * 0.4 + cancelScore * 0.3 + delivScore * 0.3),
            freq: freq?.orders_per_month || 0,
            cancelRate: canc?.cancel_rate || 0,
            onTimePct: deliv?.total_delivered > 0 ? Math.round((deliv.on_time / deliv.total_delivered) * 100) : 0,
          }
        }

        let scores, selectedName, selectedScore
        if (isAllHealth) {
          scores = clientNames.map(n => ({ name: n, ...calcScore(n) })).sort((a, b) => b.total - a.total)
          selectedName = 'Todos los clientes'
          selectedScore = {
            total: scores.length > 0 ? Math.round(scores.reduce((s, c) => s + c.total, 0) / scores.length) : 0,
            freqScore: scores.length > 0 ? Math.round(scores.reduce((s, c) => s + c.freqScore, 0) / scores.length) : 0,
            cancelScore: scores.length > 0 ? Math.round(scores.reduce((s, c) => s + c.cancelScore, 0) / scores.length) : 0,
            delivScore: scores.length > 0 ? Math.round(scores.reduce((s, c) => s + c.delivScore, 0) / scores.length) : 0,
          }
        } else {
          selectedName = clientNames[healthIdx] || clientNames[0]
          selectedScore = calcScore(selectedName)
        }

        const scoreColor = selectedScore.total >= 80 ? '#16A34A' : selectedScore.total >= 50 ? '#F97316' : '#EF4444'
        const scoreLabel = selectedScore.total >= 80 ? 'Saludable' : selectedScore.total >= 50 ? 'Regular' : 'En Riesgo'
        const scoreMsg = selectedScore.total >= 80
          ? 'Este cliente tiene una relación sólida con altos niveles de satisfacción.'
          : selectedScore.total >= 50
          ? 'Relación aceptable con oportunidades de mejora.'
          : 'Relación en riesgo. Se requiere atención prioritaria.'

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Análisis</span>
                <h2 className="kpi-section-title">Score de Salud del Cliente</h2>
                <p className="kpi-section-subtitle">Indicador combinado de frecuencia, cancelación y entrega.</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                  <input type="text" placeholder="Nombre del cliente..." value={healthSearch} onChange={e => { setHealthSearch(e.target.value); setHealthIdx(-1) }} />
                </label>
                <label>
                  <span>Cliente</span>
                  <select value={healthIdx} onChange={e => setHealthIdx(+e.target.value)}>
                    <option value={-1}>Todos</option>
                    {filteredHealthClients.map((n, i) => <option key={i} value={clientNames.indexOf(n)}>{n}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 140, height: 140, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[{ value: selectedScore.total }, { value: 100 - selectedScore.total }]} dataKey="value" cx="50%" cy="50%" innerRadius={48} outerRadius={64} startAngle={90} endAngle={-270} paddingAngle={0} stroke="none">
                        <Cell fill={scoreColor} />
                        <Cell fill="#E2E8F0" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{selectedScore.total}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', marginTop: 2 }}>/100</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: scoreColor }}>{scoreLabel}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, maxWidth: 280 }}>{scoreMsg}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{selectedName}</div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Desglose del Score</div>
                {[
                  { label: 'Frecuencia de Compra', sub: '40% del score', value: selectedScore.freqScore, color: PALETTE.cyan, weight: 40 },
                  { label: 'Tasa de Cancelación', sub: '30% del score', value: selectedScore.cancelScore, color: selectedScore.cancelScore >= 80 ? '#16A34A' : selectedScore.cancelScore >= 50 ? '#F97316' : '#EF4444', weight: 30 },
                  { label: 'Entrega a Tiempo', sub: '30% del score', value: selectedScore.delivScore, color: selectedScore.delivScore >= 80 ? '#16A34A' : selectedScore.delivScore >= 50 ? '#F97316' : '#EF4444', weight: 30 },
                ].map(bar => (
                  <div key={bar.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{bar.label}</span>
                        <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 8 }}>{bar.sub}</span>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 800, color: bar.color }}>{bar.value}%</span>
                    </div>
                    <div style={{ width: '100%', height: 8, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${bar.value}%`, height: '100%', background: bar.color, borderRadius: 4, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                ))}
                {!isAllHealth && (
                  <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Frecuencia: {selectedScore.freq || 0}/mes</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Cancelación: {selectedScore.cancelRate || 0}%</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>A tiempo: {selectedScore.onTimePct || 0}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {inactiveClients.length > 0 && (
        <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Inactivos</span>
              <h2 className="kpi-section-title">Clientes Inactivos</h2>
              <p className="kpi-section-subtitle">Sin actividad en los últimos 180 días.</p>
            </div>
          </div>
          <div className="kpi-table-wrapper">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Días Inactivo</th>
                </tr>
              </thead>
              <tbody>
                {inactiveClients.slice(0, 10).map((c, i) => (
                  <tr key={i}>
                    <td className="kpi-table-rank">{i + 1}</td>
                    <td className="kpi-table-name">{c.name}</td>
                    <td className="kpi-table-stat" style={{ color: '#DC2626' }}>{Math.round(c.days_inactive)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
