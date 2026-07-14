import { useState, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import KPIOrderCountCard from './KPIOrderCountCard'
import KPIOrderPipeline from './KPIOrderPipeline'
import { Pagination } from '../ui/Pagination'
import OrderDetailModal from '../orders/OrderDetailModal'
import '../clients/AdminClientsModule.css'

const PAGE_SIZE = 7

const STATUS_MAP = {
  pending: { label: 'Pendiente', tone: 'warning' },
  Pending: { label: 'Pendiente', tone: 'warning' },
  in_design: { label: 'Diseño', tone: 'violet' },
  in_Design: { label: 'Diseño', tone: 'violet' },
  in_quote: { label: 'Cotización', tone: 'info' },
  in_Quote: { label: 'Cotización', tone: 'info' },
  in_production: { label: 'Producción', tone: 'warning' },
  in_Production: { label: 'Producción', tone: 'warning' },
  in_termination: { label: 'Terminación', tone: 'cyan' },
  in_Termination: { label: 'Terminación', tone: 'cyan' },
  in_completed: { label: 'Completada', tone: 'success' },
  in_Completed: { label: 'Completada', tone: 'success' },
  in_delivered: { label: 'Entregada', tone: 'success' },
  in_Delivered: { label: 'Entregada', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
  Cancelled: { label: 'Cancelada', tone: 'danger' },
}

function generateInsight(trendData) {
  if (!trendData || trendData.length < 2) {
    return { text: 'Necesitas al menos 2 días de datos para ver la tendencia.', type: 'neutral' }
  }

  const values = trendData.map(d => d.ordenes)
  const total = values.reduce((s, v) => s + v, 0)
  const avg = total / values.length
  const max = Math.max(...values)
  const maxIdx = values.indexOf(max)
  const peakDate = trendData[maxIdx]?.displayDate

  const firstHalf = values.slice(0, Math.floor(values.length / 2))
  const secondHalf = values.slice(Math.floor(values.length / 2))
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length
  const changePct = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0

  const volatility = values.length > 1
    ? Math.sqrt(values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length) / (avg || 1)
    : 0

  let trendType = 'stable'

  if (changePct > 15) {
    trendType = 'increasing'
  } else if (changePct < -15) {
    trendType = 'decreasing'
  } else if (volatility > 0.5) {
    trendType = 'volatile'
  }

  const parts = []

  if (trendType === 'increasing') {
    parts.push(`Las órdenes van en aumento. En promedio llegan ${Math.round(avg)} por día.`)
    parts.push(`El mejor día fue ${peakDate} con ${max} órdenes.`)
    parts.push(`Subieron un ${Math.abs(changePct).toFixed(0)}% vs la primera mitad del período.`)
  } else if (trendType === 'decreasing') {
    parts.push(`Las órdenes van bajando. En promedio llegan ${Math.round(avg)} por día.`)
    parts.push(`El mejor día fue ${peakDate} con ${max} órdenes.`)
    parts.push(`Bajaron un ${Math.abs(changePct).toFixed(0)}% vs la primera mitad del período.`)
  } else if (trendType === 'volatile') {
    parts.push(`Las órdenes fluctúan bastante. En promedio llegan ${Math.round(avg)} por día.`)
    parts.push(`El mejor día fue ${peakDate} con ${max} órdenes.`)
    parts.push(`Hay días con mucha actividad y otros con muy poca.`)
  } else {
    parts.push(`Las órdenes se mantienen estables. En promedio llegan ${Math.round(avg)} por día.`)
    parts.push(`El mejor día fue ${peakDate} con ${max} órdenes.`)
    parts.push(`No hubo cambios importantes en el período.`)
  }

  return { text: parts.join(' '), type: trendType }
}

const ChartTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const d = payload[0]?.payload
    return (
      <div style={{
        background: '#fff', border: '1px solid #DDE3EF', borderRadius: '8px',
        padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.10)', fontSize: 12,
      }}>
        <p style={{ margin: 0, fontWeight: 600, color: d?.color || '#091127' }}>{d?.name}</p>
        <p style={{ margin: '4px 0 0', color: '#64748B' }}>{d?.value} órdenes ({d?.pct}%)</p>
      </div>
    )
  }
  return null
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#fff', border: '1px solid #DDE3EF', borderRadius: '8px',
        padding: '12px', boxShadow: '0 4px 16px rgba(15,30,64,0.10)', fontSize: '13px'
      }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#0f1e40' }}>{label}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ margin: '4px 0 0', color: entry.color, fontWeight: 500 }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    )
  }
  return null
}

const EMPTY_SLICES = [
  { name: '', value: 1 },
  { name: '', value: 1 },
]
const EMPTY_COLORS = ['#D1D5DB', '#E5E7EB']

function MiniPieChart({ data, title, subtitle, insight, colors }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const isEmpty = total === 0

  const displayData = isEmpty ? EMPTY_SLICES : data
  const displayColors = isEmpty ? EMPTY_COLORS : colors

  return (
    <div style={{
      flex: '1 1 300px', background: '#fff', borderRadius: 14,
      border: '1px solid #dbe3ef', boxShadow: '0 10px 28px rgba(15,30,64,.055)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 22px 0' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#091127' }}>{title}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>{subtitle}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 22px', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: '0 0 160px', height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={displayData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={isEmpty ? 0 : 3}
                dataKey="value"
                isAnimationActive={!isEmpty}
              >
                {displayData.map((_, idx) => (
                  <Cell key={idx} fill={displayColors[idx % displayColors.length]} />
                ))}
              </Pie>
              {!isEmpty && <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />}
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.map((entry, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: colors[idx % colors.length], flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: '#334155', fontWeight: 500 }}>{entry.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{entry.value}</span>
              <span style={{ fontSize: 11, color: '#64748B', minWidth: 36, textAlign: 'right' }}>
                {total > 0 ? `${((entry.value / total) * 100).toFixed(0)}%` : '0%'}
              </span>
            </div>
          ))}
          {isEmpty && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#D1D5DB', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>Sin datos</span>
            </div>
          )}
        </div>
      </div>

      {insight && (
        <div style={{ padding: '12px 22px', borderTop: '1px solid #E8EDF8', background: '#F8FAFC' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>{insight}</p>
        </div>
      )}
    </div>
  )
}

const MATERIAL_COLORS = ['#091127', '#8B5CF6', '#F97316']

function MaterialsRanking({ materials }) {
  const ranking = useMemo(() => {
    if (!materials || materials.length === 0) return []
    const total = materials.reduce((s, d) => s + d.count, 0)
    return materials.slice(0, 3).map((d, i) => ({
      ...d,
      rank: i + 1,
      pct: total > 0 ? (d.count / total) * 100 : 0,
      pctLabel: total > 0 ? ((d.count / total) * 100).toFixed(0) : '0',
    }))
  }, [materials])

  if (ranking.length === 0) {
    return (
      <div style={{
        flex: '1 1 300px', background: '#fff', borderRadius: 14,
        border: '1px solid #dbe3ef', boxShadow: '0 10px 28px rgba(15,30,64,.055)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px 0' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#091127' }}>Top 3 Materiales</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>Materiales más utilizados en órdenes</p>
        </div>
        <div style={{ padding: '32px 22px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#9CA3AF', fontStyle: 'italic' }}>Sin datos disponibles</p>
        </div>
      </div>
    )
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div style={{
      flex: '1 1 300px', background: '#fff', borderRadius: 14,
      border: '1px solid #dbe3ef', boxShadow: '0 10px 28px rgba(15,30,64,.055)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 22px 0' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#091127' }}>Top 3 Materiales Más Utilizados</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>Distribución por uso en órdenes del período</p>
      </div>

      <div style={{ padding: '20px 22px 12px' }}>
        <div style={{
          position: 'relative', height: 36, background: '#F1F5F9', borderRadius: 8,
          overflow: 'hidden', display: 'flex',
        }}>
          {ranking.map((item) => {
            const isFirst = item.rank === 1
            const isLast = item.rank === ranking.length

            return (
              <div
                key={item.rank}
                className="material-bar-segment"
                style={{
                  width: `${item.pct}%`,
                  background: MATERIAL_COLORS[item.rank - 1],
                  borderRadius: isFirst && isLast ? 8
                    : isFirst ? '8px 0 0 8px'
                    : isLast ? `0 8px 8px 0`
                    : 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  '--seg-delay': `${(item.rank - 1) * 200}ms`,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {item.pct >= 12 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#fff',
                    textShadow: '0 1px 2px rgba(0,0,0,.2)',
                    whiteSpace: 'nowrap', zIndex: 1,
                  }}>
                    {item.pctLabel}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ padding: '8px 22px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ranking.map((item) => (
          <div key={item.rank} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 12, height: 12, borderRadius: 3, flexShrink: 0,
              background: MATERIAL_COLORS[item.rank - 1],
            }} />
            <span style={{ fontSize: 14 }}>{medals[item.rank - 1]}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#091127' }}>{item.name}</span>
            <span style={{ fontSize: 12, color: '#64748B' }}>{item.count} usos</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#091127', minWidth: 42, textAlign: 'right' }}>{item.pctLabel}%</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 22px', borderTop: '1px solid #E8EDF8', background: '#F8FAFC' }}>
        <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
          <strong>{ranking[0]?.name}</strong> es el material más demandado con {ranking[0]?.count} órdenes ({ranking[0]?.pctLabel}% del total).
        </p>
      </div>
    </div>
  )
}

export default function KPIOrdersAnalytics({ data }) {
  const [chartMode, setChartMode] = useState('line')
  const [delayedPage, setDelayedPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState(null)

  const dailyTrend = useMemo(() => data?.orders_analytics?.daily_trend || [], [data])

  const trendData = useMemo(() =>
    dailyTrend.map(d => ({
      date: d.date,
      displayDate: new Date(d.date).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }),
      ordenes: d.orders,
      'Órdenes': d.orders,
    })),
  [dailyTrend])

  const insight = useMemo(() => generateInsight(trendData), [trendData])

  const totalOrders = useMemo(() => trendData.reduce((s, d) => s + d.ordenes, 0), [trendData])
  const avgOrders = useMemo(() => trendData.length > 0 ? Math.round(totalOrders / trendData.length) : 0, [trendData, totalOrders])
  const maxOrders = useMemo(() => Math.max(...trendData.map(d => d.ordenes), 0), [trendData])

  const analyticsData = useMemo(() => {
    if (!data?.orders_analytics) return null
    const oa = data.orders_analytics
    const breakdown = oa.status_breakdown || {}
    const typeBreakdown = oa.type_breakdown || {}
    const designBreakdown = oa.status_by_design_type || {}

    const completed = (breakdown.in_completed || 0) + (breakdown.in_Completed || 0)
      + (breakdown.in_delivered || 0) + (breakdown.in_Delivered || 0)
    const cancelled = breakdown.cancelled || breakdown.Cancelled || 0

    const normal = typeBreakdown.normal || 0
    const urgent = typeBreakdown.urgent_911 || 0

    let internal = 0
    let external = 0
    Object.entries(designBreakdown).forEach(([key, val]) => {
      if (key === 'INTERNAL_DESING' || key === 'internal_desing') {
        const counts = typeof val === 'object' ? val : {}
        internal = Object.values(counts).reduce((s, v) => s + v, 0)
      } else if (key === 'EXTERNAL_DESING' || key === 'external_desing') {
        const counts = typeof val === 'object' ? val : {}
        external = Object.values(counts).reduce((s, v) => s + v, 0)
      }
    })

    return { completed, cancelled, normal, urgent, internal, external }
  }, [data])

  const statusChart = useMemo(() => {
    if (!analyticsData) return []
    return [
      { name: 'Completadas / Entregadas', value: analyticsData.completed, color: '#10B981' },
      { name: 'Canceladas', value: analyticsData.cancelled, color: '#EF4444' },
    ].filter(d => d.value > 0)
  }, [analyticsData])

  const priorityChart = useMemo(() => {
    if (!analyticsData) return []
    return [
      { name: 'Normales', value: analyticsData.normal, color: '#06B6D4' },
      { name: '911 (Urgentes)', value: analyticsData.urgent, color: '#F43F5E' },
    ].filter(d => d.value > 0)
  }, [analyticsData])

  const designChart = useMemo(() => {
    if (!analyticsData) return []
    return [
      { name: 'Diseño Interno', value: analyticsData.internal, color: '#8B5CF6' },
      { name: 'Diseño Externo', value: analyticsData.external, color: '#F97316' },
    ].filter(d => d.value > 0)
  }, [analyticsData])

  const pieColors = ['#10B981', '#EF4444']
  const priorityColors = ['#06B6D4', '#F43F5E']
  const designColors = ['#8B5CF6', '#F97316']

  const statusInsight = useMemo(() => {
    if (!analyticsData) return ''
    const total = analyticsData.completed + analyticsData.cancelled
    if (total === 0) return 'No hay órdenes completadas o canceladas en este período.'
    const pctCompleted = ((analyticsData.completed / total) * 100).toFixed(0)
    if (pctCompleted >= 80) return `Excelente. El ${pctCompleted}% de las órdenes se completaron exitosamente.`
    if (pctCompleted >= 50) return `El ${pctCompleted}% de las órdenes se completaron. Hay margen de mejora.`
    return `Solo el ${pctCompleted}% se completaron. Revisar los motivos de cancelación.`
  }, [analyticsData])

  const priorityInsight = useMemo(() => {
    if (!analyticsData) return ''
    const total = analyticsData.normal + analyticsData.urgent
    if (total === 0) return 'No hay datos de prioridad disponibles.'
    const pctUrgent = ((analyticsData.urgent / total) * 100).toFixed(0)
    if (pctUrgent > 30) return `Alto volumen de órdenes urgentes (${pctUrgent}%). Considerar optimizar la capacidad de respuesta.`
    return `Las órdenes normales predominan. Solo el ${pctUrgent}% son urgentes.`
  }, [analyticsData])

  const designInsight = useMemo(() => {
    if (!analyticsData) return ''
    const total = analyticsData.internal + analyticsData.external
    if (total === 0) return 'No hay datos de diseño disponibles.'
    const pctExternal = ((analyticsData.external / total) * 100).toFixed(0)
    if (pctExternal > 60) return `La mayoría de diseños son externos (${pctExternal}%). Los clientes prefieren enviar su propio diseño.`
    if (pctExternal < 30) return `Predominan los diseños internos. El equipo de diseño está muy activo.`
    return `Distribución equilibrada entre diseños internos y externos.`
  }, [analyticsData])

  if (!data) return null

  const { orders_analytics } = data
  const delayedOrders = orders_analytics?.delayed_orders || {}

  const insightBg = insight.type === 'increasing' ? '#ECFDF5'
    : insight.type === 'decreasing' ? '#FEF2F2'
    : insight.type === 'volatile' ? '#FFFBEB'
    : '#F0F5FF'

  const insightBorder = insight.type === 'increasing' ? '#A7F3D0'
    : insight.type === 'decreasing' ? '#FECACA'
    : insight.type === 'volatile' ? '#FDE68A'
    : '#C7D2FE'

  const insightColor = insight.type === 'increasing' ? '#065F46'
    : insight.type === 'decreasing' ? '#991B1B'
    : insight.type === 'volatile' ? '#92400E'
    : '#3730A3'

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Órdenes</span>
          <h2 className="kpi-section-title">Análisis de Órdenes</h2>
          <p className="kpi-section-subtitle">Flujo de trabajo, distribución y rendimiento</p>
        </div>
      </div>

      <KPIOrderCountCard data={data} />

      <KPIOrderPipeline data={data} />

      <div className="kpi-section">
        <div className="kpi-section-header">
          <div>
            <span className="kpi-section-kicker">Panel de Tendencia</span>
            <h2 className="kpi-section-title">Tendencia Diaria</h2>
            <p className="kpi-section-subtitle">Evolución diaria de órdenes creadas</p>
          </div>
          <div className="kpi-pipeline-view-toggle">
            <button
              className={`kpi-pipeline-view-btn ${chartMode === 'bar' ? 'active' : ''}`}
              onClick={() => setChartMode('bar')}
            >
              Barras
            </button>
            <button
              className={`kpi-pipeline-view-btn ${chartMode === 'line' ? 'active' : ''}`}
              onClick={() => setChartMode('line')}
            >
              Línea
            </button>
            <button
              className={`kpi-pipeline-view-btn ${chartMode === 'area' ? 'active' : ''}`}
              onClick={() => setChartMode('area')}
            >
              Área
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{
            flex: '1 1 160px', padding: '14px 18px', borderRadius: 12,
            background: '#ffffff', border: '1px solid #E2E8F0',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Total
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#091127' }}>{totalOrders}</div>
          </div>
          <div style={{
            flex: '1 1 160px', padding: '14px 18px', borderRadius: 12,
            background: '#ffffff', border: '1px solid #E2E8F0',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Promedio
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#091127' }}>{avgOrders}</div>
          </div>
          <div style={{
            flex: '1 1 160px', padding: '14px 18px', borderRadius: 12,
            background: '#ffffff', border: '1px solid #E2E8F0',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Pico máximo
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#091127' }}>{maxOrders}</div>
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 24, marginBottom: 16 }}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'bar' ? (
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="displayDate" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} label={{ value: 'Órdenes', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#64748B' } }} />
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                  <Bar dataKey="Órdenes" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : chartMode === 'line' ? (
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="displayDate" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} label={{ value: 'Órdenes', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#64748B' } }} />
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                  <Line type="monotone" dataKey="Órdenes" stroke="#06B6D4" strokeWidth={2.5} dot={{ r: 4, fill: '#06B6D4', strokeWidth: 0 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
                </LineChart>
              ) : (
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#06B6D4" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="displayDate" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} label={{ value: 'Órdenes', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#64748B' } }} />
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                  <Area type="monotone" dataKey="Órdenes" stroke="#06B6D4" strokeWidth={2.5} fill="url(#trendGradient)" dot={{ r: 4, fill: '#06B6D4', strokeWidth: 0 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{
          padding: '16px 20px',
          borderRadius: 12,
          background: insightBg,
          border: `1px solid ${insightBorder}`,
        }}>
          <div style={{
            fontSize: 13, lineHeight: '1.7', color: insightColor, fontWeight: 500,
          }}>
            {insight.text}
          </div>
        </div>
      </div>

      {analyticsData && (
        <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Panel de Análisis</span>
              <h2 className="kpi-section-title">Comparativa de Órdenes</h2>
              <p className="kpi-section-subtitle">Distribución por estado, prioridad y tipo de diseño</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
            <MiniPieChart
              title="Estado de Órdenes"
              subtitle="Completadas vs Canceladas"
              data={statusChart}
              colors={pieColors}
              insight={statusInsight}
            />
            <MiniPieChart
              title="Por Prioridad"
              subtitle="Normales vs 911"
              data={priorityChart}
              colors={priorityColors}
              insight={priorityInsight}
            />
            <MiniPieChart
              title="Por Tipo de Diseño"
              subtitle="Interno vs Externo"
              data={designChart}
              colors={designColors}
              insight={designInsight}
            />
            <MaterialsRanking materials={data.top_materials || []} />
          </div>
        </div>
      )}

      {delayedOrders.orders && delayedOrders.orders.length > 0 && (() => {
        const allDelayed = delayedOrders.orders
        const totalDelayed = allDelayed.length
        const totalDelayedPages = Math.ceil(totalDelayed / PAGE_SIZE)
        const delayedStart = (delayedPage - 1) * PAGE_SIZE
        const paginatedDelayed = allDelayed.slice(delayedStart, delayedStart + PAGE_SIZE)

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Panel de Alertas</span>
                <h2 className="kpi-section-title">Órdenes Estancadas</h2>
                <p className="kpi-section-subtitle">Órdenes con más de 7 días sin movimiento</p>
              </div>
            </div>
            <div className="pa-panel acm-table-panel">
              <div className="pa-panel-head pa-panel-head-results">
                <h2>Órdenes estancadas</h2>
                <span className="pa-results-count">{totalDelayed} resultado{totalDelayed === 1 ? '' : 's'}</span>
              </div>
              <div className="ps-table-wrap">
                <table className="ps-table acm-table">
                  <thead>
                    <tr>
                      <th>Orden</th>
                      <th>Cliente</th>
                      <th>Estado</th>
                      <th>Días Estancada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDelayed.map(order => {
                      const status = STATUS_MAP[order.status] || { label: order.status, tone: 'neutral' }
                      const initials = (order.client_name || 'S/N').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                      return (
                        <tr
                          key={order.id}
                          className="row-hover"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedOrder(order)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedOrder(order) } }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Ver detalles de orden ${order.id?.slice(0, 8).toUpperCase()}`}
                        >
                          <td className="td-pad" style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#091127' }}>
                            #{order.id?.slice(0, 8).toUpperCase()}
                          </td>
                          <td className="td-pad">
                            <div className="acm-client-cell">
                              <span className="acm-avatar acm-avatar-small">{initials}</span>
                              <span>
                                <strong>{order.client_name || 'Sin nombre'}</strong>
                              </span>
                            </div>
                          </td>
                          <td className="td-pad">
                            <span className={`acm-badge ${status.tone}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="td-pad" style={{ fontWeight: 600, color: '#091127' }}>
                            {Math.round(order.days_stuck)} días
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="acm-pagination-footer">
                <Pagination currentPage={delayedPage} totalPages={totalDelayedPages} onPageChange={setDelayedPage} />
              </div>
            </div>
          </div>
        )
      })()}

      <OrderDetailModal
        open={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        showPrimaryAction={false}
      />
    </div>
  )
}
