import { useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber } from '../../utils/kpiHelpers'
import { useOrderStatistics } from '../../hooks/useOrderStatistics'
import MaterialAnalyticsDialog from '../kpi/MaterialAnalyticsDialog'
import '../../css-components/order-statistics-modal.css'

const CHART_COLORS = ['#06B6D4', '#F43F5E', '#F59E0B', '#10B981', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6']

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Últimos 7 días' },
  { value: 'month', label: 'Mes actual' },
  { value: '2months', label: 'Últimos 2 meses' },
  { value: '3months', label: 'Últimos 3 meses' },
  { value: 'year', label: 'Año actual' },
  { value: 'general', label: 'Historial completo' },
  { value: 'custom', label: 'Personalizado' },
]

const STATUS_COLORS = {
  pending: '#F59E0B',
  in_design: '#8B5CF6',
  in_quote: '#06B6D4',
  in_production: '#F97316',
  in_termination: '#0284C7',
  in_completed: '#10B981',
  in_delivered: '#6366F1',
  cancelled: '#EF4444',
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatTrendDay(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="kpi-chart-tooltip">
      <p className="kpi-chart-tooltip-label">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="kpi-chart-tooltip-row" style={{ color: entry.color || entry.fill || entry.stroke }}>
          <span className="kpi-chart-tooltip-row-color" style={{ background: entry.color || entry.fill || entry.stroke }} />
          {entry.name}: {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  )
}

function MetricCard({ label, value, icon: Icon, color, detail }) {
  return (
    <div className="kpi-order-stats-metric">
      <span className="kpi-order-stats-metric-label">{Icon && <Icon size={14} />}{label}</span>
      <strong>{formatNumber(value)}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function DonutChart({ data, title, subtitle, total, colors, emptyMessage = 'Sin datos' }) {
  const hasData = data.length > 0 && total > 0
  const displayData = hasData ? data : [{ name: '', value: 1 }, { name: '', value: 1 }]
  const displayColors = hasData ? colors : ['#D1D5DB', '#E5E7EB']

  return (
    <div className="kpi-order-stats-donut">
      <div className="kpi-order-stats-donut-header">
        <div className="kpi-order-stats-donut-title">
          <span className="kpi-order-stats-donut-eyebrow">{subtitle}</span>
          <h3 className="kpi-order-stats-donut-name">{title}</h3>
        </div>
        <span className="kpi-order-stats-donut-total">{formatNumber(total)}</span>
      </div>
      <div className="kpi-order-stats-donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={displayData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={hasData ? 3 : 0}
              isAnimationActive={hasData}
            >
              {displayData.map((_, idx) => <Cell key={idx} fill={displayColors[idx % displayColors.length]} />)}
            </Pie>
            {hasData && <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="kpi-order-stats-donut-legend">
        {data.map((entry, index) => (
          <div key={entry.name} className="kpi-order-stats-donut-legend-item">
            <span className="kpi-order-stats-donut-legend-color" style={{ background: colors[index % colors.length] }} />
            <span className="kpi-order-stats-donut-legend-label">{entry.name}</span>
            <strong className="kpi-order-stats-donut-legend-value">{formatNumber(entry.value)}</strong>
          </div>
        ))}
        {!hasData && (
          <div className="kpi-order-stats-donut-legend-item" style={{ color: '#94a3b8', justifyContent: 'center' }}>
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function TrendChart({ data, chartType, onChartTypeChange }) {
  if (data.length === 0) {
    return (
      <div className="kpi-order-stats-trend">
        <div className="kpi-order-stats-empty">No hay datos de tendencia para el período seleccionado.</div>
      </div>
    )
  }

  const singleDay = data.length === 1

  return (
    <div className="kpi-order-stats-trend">
      <div className="kpi-order-stats-trend-heading">
        <div>
          <span className="kpi-order-stats-donut-eyebrow">Actividad</span>
          <h3 style={{ margin: 0, color: '#0f1e40', fontSize: 14 }}>Tendencia de órdenes</h3>
        </div>
        <div className="kpi-order-stats-chart-controls">
          <div className="kpi-order-stats-segmented" aria-label="Tipo de gráfico">
            {['bar', 'line', 'area'].map(type => (
              <button
                key={type}
                type="button"
                className={chartType === type ? 'active' : ''}
                onClick={() => onChartTypeChange(type)}
                aria-pressed={chartType === type}
              >
                {type === 'bar' ? 'Barras' : type === 'line' ? 'Línea' : 'Área'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {singleDay ? (
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: '10px',
          minHeight: '92px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#fbfcff'
        }}>
          <span style={{
            width: 10, height: 10, border: '3px solid #1E40AF', borderRadius: '50%', background: '#fff',
            boxShadow: '0 0 0 4px #edf3ff'
          }} />
          <div style={{ display: 'grid', gap: '3px', minWidth: 0 }}>
            <strong style={{ color: '#0f1e40', fontSize: 13, fontWeight: 700 }}>{formatNumber(data[0].ordenes)} órdenes</strong>
            <span style={{ color: '#71809a', fontSize: 11, fontWeight: 500 }}>{formatTrendDay(data[0].date)}</span>
          </div>
          <p style={{ margin: 0, color: '#64748b', fontSize: 11, lineHeight: 1.45, textAlign: 'right' }}>
            Actividad registrada en un único día del período.
          </p>
        </div>
      ) : (
        <div className="kpi-order-stats-trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e7eef8" strokeDasharray="3 4" />
                <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} labelFormatter={formatTrendDay} />
                <Bar dataKey="ordenes" fill="#06B6D4" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : chartType === 'line' ? (
              <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e7eef8" strokeDasharray="3 4" />
                <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} labelFormatter={formatTrendDay} />
                <Line type="monotone" dataKey="ordenes" stroke="#06B6D4" strokeWidth={2.5} dot={{ r: 4, fill: '#06B6D4', strokeWidth: 0 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
              </LineChart>
            ) : (
              <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="order-trend-gradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#06B6D4" stopOpacity={.16} />
                    <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e7eef8" strokeDasharray="3 4" />
                <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} labelFormatter={formatTrendDay} />
                <Area type="monotone" dataKey="ordenes" stroke="#06B6D4" strokeWidth={2.25} fill="url(#order-trend-gradient)" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function TopIndicators({ indicators }) {
  const items = [
    { label: 'Cliente principal', value: indicators.topClient?.client_name || 'Sin datos', detail: `${formatNumber(indicators.topClient?.order_count)} órdenes`, icon: Icons.User, color: '#1E40AF' },
    { label: 'Material más usado', value: indicators.topMaterial?.material_name || 'Sin datos', detail: `${formatNumber(indicators.topMaterial?.reference_count)} referencias`, icon: Icons.Package, color: '#14B8A6' },
    { label: 'Vendedor top (completadas)', value: indicators.topSeller?.seller_name || 'Sin datos', detail: `${formatNumber(indicators.topSeller?.completed_count)} completadas`, icon: Icons.Users, color: '#06B6D4' },
    { label: 'Diseñador top (completadas)', value: indicators.topDesigner?.designer_name || 'Sin datos', detail: `${formatNumber(indicators.topDesigner?.completed_count)} completadas`, icon: Icons.Paintbrush, color: '#8B5CF6' },
  ]

  return (
    <div className="kpi-order-stats-indicators">
      {items.map((item, idx) => (
        <div key={idx} className="kpi-order-stats-indicator">
          <span className="kpi-order-stats-indicator-icon" style={{ background: `${item.color}18`, color: item.color }}>
            <item.icon size={16} />
          </span>
          <div className="kpi-order-stats-indicator-content">
            <span className="kpi-order-stats-indicator-label">{item.label}</span>
            <strong className="kpi-order-stats-indicator-value">{item.value}</strong>
            <span className="kpi-order-stats-indicator-detail">{item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function PipelineByStatus({ pipeline }) {
  const total = pipeline.reduce((s, p) => s + p.count, 0)

  if (total === 0) {
    return (
      <div className="kpi-order-stats-pipeline">
        <h3 className="kpi-order-stats-comparison-title"><Icons.Orders size={16} />Pipeline por estado</h3>
        <div className="kpi-order-stats-empty">No hay órdenes en el período seleccionado.</div>
      </div>
    )
  }

  const pieData = pipeline.map(p => ({ name: p.label, value: p.count, color: p.color }))

  return (
    <div className="kpi-order-stats-pipeline">
      <h3 className="kpi-order-stats-comparison-title"><Icons.Orders size={16} />Pipeline por estado</h3>
      <div className="kpi-order-stats-pipeline-layout">
        <div className="kpi-order-stats-pipeline-pie">
          <ResponsiveContainer width="100%" height="220">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={52}
                outerRadius={80}
                paddingAngle={3}
              >
                {pieData.map((_, idx) => <Cell key={idx} fill={pieData[idx].color} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="kpi-order-stats-pipeline-list">
          {pipeline.map(p => (
            <div key={p.status} className="kpi-order-stats-pipeline-row">
              <span className="kpi-order-stats-pipeline-dot" style={{ background: p.color }} />
              <div className="kpi-order-stats-pipeline-info">
                <span className="kpi-order-stats-pipeline-label">{p.label}</span>
                <div className="kpi-order-stats-pipeline-values">
                  <strong className="kpi-order-stats-pipeline-count">{formatNumber(p.count)}</strong>
                  <span className="kpi-order-stats-pipeline-pct">{formatNumber(p.pct, 1)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ComparisonTable({ comparison }) {
  const hasData = comparison.length > 0

  if (!hasData) {
    return (
      <div className="kpi-order-stats-comparison">
        <h3 className="kpi-order-stats-comparison-title"><Icons.FileText size={16} />Comparativa por estado y prioridad</h3>
        <div className="kpi-order-stats-empty">No hay datos para comparar.</div>
      </div>
    )
  }

  return (
    <div className="kpi-order-stats-comparison">
      <h3 className="kpi-order-stats-comparison-title"><Icons.FileText size={16} />Comparativa por estado y prioridad</h3>
      <div className="kpi-order-stats-table-wrapper">
        <table className="kpi-order-stats-table">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Total</th>
              <th>Normales</th>
              <th>911</th>
              <th>% 911</th>
              <th>Completadas</th>
              <th>Canceladas</th>
              <th>% Cierre</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map(row => (
              <tr key={row.status}>
                <td className="status-cell">
                  <span className="status-dot" style={{ background: STATUS_COLORS[row.status] || '#64748b' }} />
                  <span className="status-label">{row.label}</span>
                </td>
                <td className="count-cell">{formatNumber(row.total)}</td>
                <td className="count-cell">{formatNumber(row.normal)}</td>
                <td className="count-cell">{formatNumber(row.urgent_911)}</td>
                <td className="pct-cell">
                  {row.total > 0 ? (
                    <span className="urgent-badge">{formatNumber(row.pct_urgent, 1)}%</span>
                  ) : '—'}
                </td>
                <td className="count-cell">{formatNumber(row.completed)}</td>
                <td className="count-cell">{formatNumber(row.cancelled)}</td>
                <td className="pct-cell">
                  {row.total > 0 ? (
                    <span className="completion-badge">{formatNumber(row.pct_completion, 1)}%</span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function OrderStatisticsModal({ open, userId, onClose, initialPeriod = 'month' }) {
  const closeButtonRef = useRef(null)
  const returnFocusRef = useRef(null)
  const [period, setPeriod] = useState(initialPeriod)
  const [chartType, setChartType] = useState('area')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const {
    cards,
    donuts,
    trend,
    topIndicators,
    pipeline,
    comparison,
    periodLabel,
    loading,
    fetching,
    error,
    isPlaceholderData,
    refresh,
  } = useOrderStatistics({ period, customDateFrom: customFrom, customDateTo: customTo, userId, enabled: Boolean(open && userId) })

  const isLoading = loading || fetching || isPlaceholderData
  const hasValidData = Boolean(cards) && !isLoading && !error

  const handlePeriodChange = (newPeriod, from = '', to = '') => {
    setPeriod(newPeriod)
    if (newPeriod === 'custom') {
      setCustomFrom(from)
      setCustomTo(to)
    }
  }

  return (
    <MaterialAnalyticsDialog
      open={open}
      onClose={onClose}
      labelledBy="order-stats-title"
      describedBy="order-stats-description"
      dialogClassName="kpi-order-stats-modal"
      overlayClassName="kpi-order-stats-overlay"
      initialFocusRef={closeButtonRef}
      returnFocusRef={returnFocusRef}
    >
      <header className="kpi-order-stats-header">
        <span className="kpi-order-stats-icon"><Icons.BarChart /></span>
        <div>
          <span className="kpi-order-stats-eyebrow">Administración → Gestión de Órdenes</span>
          <h2 id="order-stats-title">Estadísticas de Órdenes</h2>
          <p id="order-stats-description">Período: {periodLabel}</p>
        </div>
        <select
          className="kpi-order-stats-period-select"
          value={period}
          onChange={(e) => handlePeriodChange(e.target.value)}
          aria-label="Período de estadísticas"
        >
          {PERIOD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <button
          type="button"
          className="kpi-order-stats-close"
          onClick={onClose}
          aria-label="Cerrar estadísticas de órdenes"
          ref={closeButtonRef}
        >
          <Icons.Close />
        </button>
      </header>

      <div className="kpi-order-stats-modal-scroll">
        {isLoading && <p className="kpi-order-stats-feedback" role="status">Cargando estadísticas de órdenes…</p>}
        {error && !isLoading && (
          <p className="kpi-order-stats-feedback is-error" role="alert">
            No fue posible obtener las estadísticas.
            <button type="button" onClick={refresh}>Reintentar</button>
          </p>
        )}

        {hasValidData && (
          <>
            {/* Cards principales */}
            <div className="kpi-order-stats-metrics">
              <MetricCard
                label="Total de órdenes"
                value={cards.total}
                icon={Icons.Orders}
                color="#1E40AF"
              />
              <MetricCard
                label="Órdenes activas"
                value={cards.active}
                icon={Icons.TrendUp}
                color="#10B981"
              />
              <MetricCard
                label="Órdenes canceladas"
                value={cards.cancelled}
                icon={Icons.AlertCircle}
                color="#EF4444"
              />
              <MetricCard
                label="Activas a crédito"
                value={cards.activeCredit}
                icon={Icons.Money}
                color="#F59E0B"
              />
            </div>

            {/* Donuts */}
            <section className="kpi-order-stats-donuts" aria-label="Distribuciones de órdenes">
              <DonutChart
                title="Estado de órdenes"
                subtitle="Completadas vs Canceladas"
                data={donuts.status}
                total={donuts.status.reduce((s, d) => s + d.value, 0)}
                colors={['#10B981', '#EF4444']}
              />
              <DonutChart
                title="Por prioridad"
                subtitle="Normales vs 911"
                data={donuts.priority}
                total={donuts.priority.reduce((s, d) => s + d.value, 0)}
                colors={['#06B6D4', '#F43F5E']}
              />
              <DonutChart
                title="Por tipo de diseño"
                subtitle="Interno vs Externo"
                data={donuts.design}
                total={donuts.design.reduce((s, d) => s + d.value, 0)}
                colors={['#8B5CF6', '#F97316']}
              />
            </section>

            {/* Tendencia */}
            <TrendChart data={trend} chartType={chartType} onChartTypeChange={setChartType} />

            {/* Indicadores destacados */}
            <section className="kpi-order-stats-indicators-section" style={{ padding: '0 24px 16px' }}>
              <h3 className="kpi-order-stats-comparison-title"><Icons.CheckCircle size={16} />Indicadores destacados</h3>
              <TopIndicators indicators={topIndicators} />
            </section>

            {/* Pipeline por estado */}
            <PipelineByStatus pipeline={pipeline} />

            {/* Comparativa */}
            <ComparisonTable comparison={comparison} />
          </>
        )}
      </div>
    </MaterialAnalyticsDialog>
  )
}
