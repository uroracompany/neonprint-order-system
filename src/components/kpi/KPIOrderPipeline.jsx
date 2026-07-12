import { useState } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', color: '#F59E0B' },
  in_design: { label: 'Diseño', color: '#8B5CF6' },
  in_quote: { label: 'Cotización', color: '#0EA5E9' },
  in_production: { label: 'Producción', color: '#F97316' },
  in_termination: { label: 'Terminación', color: '#0284C7' },
  in_completed: { label: 'Completada', color: '#22C55E' },
  in_delivered: { label: 'Entregada', color: '#10B981' },
  cancelled: { label: 'Cancelada', color: '#EF4444' },
}

const PIPELINE_ORDER = ['pending', 'in_design', 'in_quote', 'in_production', 'in_termination', 'in_completed', 'in_delivered']

const DATE_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '3m', label: 'Últimos 3 meses' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: '1y', label: 'Último año' },
  { value: '3y', label: 'Últimos 3 años' },
  { value: '5y', label: 'Últimos 5 años' },
  { value: 'all', label: 'Todo' },
  { value: 'custom', label: 'Personalizado...' },
]

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#fff', border: '1px solid #DDE3EF', borderRadius: '8px',
        padding: '12px', boxShadow: '0 4px 16px rgba(15,30,64,0.10)', fontSize: '13px'
      }}>
        <p style={{ margin: 0, fontWeight: 600, color: payload[0]?.payload?.color || '#0f1e40' }}>
          {payload[0]?.name}: {payload[0]?.value}
        </p>
      </div>
    )
  }
  return null
}

function getFilteredData(data, designFilter, priorityFilter, dateFilter, customFrom, customTo) {
  if (dateFilter === 'custom') {
    if (!customFrom || !customTo) return null
    const allOrders = data?.orders_analytics?.orders || data?.orders || []
    if (allOrders.length > 0) {
      const from = new Date(customFrom)
      const to = new Date(customTo)
      to.setHours(23, 59, 59, 999)
      const filtered = allOrders.filter(o => {
        const d = new Date(o.created_at)
        return d >= from && d <= to
      })
      const breakdown = {}
      filtered.forEach(o => {
        const s = (o.status || 'unknown').toLowerCase()
        breakdown[s] = (breakdown[s] || 0) + 1
      })
      return breakdown
    }
    return null
  }

  const pipelineByDate = data?.pipeline_by_date
  if (pipelineByDate && pipelineByDate[dateFilter]) {
    return pipelineByDate[dateFilter]
  }

  const analytics = data?.orders_analytics
  if (!analytics) return null

  const bothKey = `${designFilter}|${priorityFilter}`
  const bothData = analytics.status_by_both?.[bothKey]

  if (designFilter !== 'all' && priorityFilter !== 'all' && bothData) {
    return bothData
  }

  if (designFilter !== 'all') {
    return analytics.status_by_design_type?.[designFilter] || null
  }

  if (priorityFilter !== 'all') {
    return analytics.status_by_order_type?.[priorityFilter] || null
  }

  return analytics.status_breakdown || null
}

export default function KPIOrderPipeline({ data }) {
  const [designFilter, setDesignFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [viewMode, setViewMode] = useState('pipeline')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  if (!data) return null

  const statusBreakdown = getFilteredData(data, designFilter, priorityFilter, dateFilter, customFrom, customTo) || {}
  const totalCount = Object.values(statusBreakdown).reduce((sum, v) => sum + v, 0) || 0
  const cancelledCount = statusBreakdown.cancelled || 0
  const activeCount = totalCount - cancelledCount

  const pipelineStages = PIPELINE_ORDER.map(key => ({
    key,
    ...STATUS_CONFIG[key],
    count: statusBreakdown[key] || 0,
    pct: activeCount > 0 ? ((statusBreakdown[key] || 0) / activeCount) * 100 : 0,
  }))

  const maxCount = Math.max(...pipelineStages.map(s => s.count), 1)

  const pieData = pipelineStages
    .filter(s => s.count > 0)
    .map(s => ({
      name: s.label,
      value: s.count,
      color: s.color,
    }))

  if (cancelledCount > 0) {
    pieData.push({ name: 'Cancelada', value: cancelledCount, color: '#EF4444' })
  }

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Embudo</span>
          <h2 className="kpi-section-title">Pipeline de Órdenes</h2>
          <p className="kpi-section-subtitle">Distribución actual por etapa del flujo de trabajo</p>
        </div>
      </div>

      <div className="kpi-pipeline-card">
        <div className="kpi-pipeline-filters">
          <div className="kpi-pipeline-filter-group">
            <label className="kpi-pipeline-filter-label">Tipo de diseño</label>
            <select
              className="kpi-select"
              value={designFilter}
              onChange={e => setDesignFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="INTERNAL_DESING">Diseño Interno</option>
              <option value="EXTERNAL_DESING">Diseño Externo</option>
            </select>
          </div>
          <div className="kpi-pipeline-filter-group">
            <label className="kpi-pipeline-filter-label">Prioridad</label>
            <select
              className="kpi-select"
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="orden normal">Normal</option>
              <option value="orden 911">911</option>
            </select>
          </div>
          <div className="kpi-pipeline-filter-group">
            <label className="kpi-pipeline-filter-label">Fecha</label>
            <select
              className="kpi-select"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
            >
              {DATE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {dateFilter === 'custom' && (
            <>
              <div className="kpi-pipeline-filter-group">
                <label className="kpi-pipeline-filter-label">Desde</label>
                <input
                  type="date"
                  className="kpi-select"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="kpi-pipeline-filter-group">
                <label className="kpi-pipeline-filter-label">Hasta</label>
                <input
                  type="date"
                  className="kpi-select"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="kpi-pipeline-filter-group">
            <label className="kpi-pipeline-filter-label">Vista</label>
            <div className="kpi-pipeline-view-toggle">
              <button
                className={`kpi-pipeline-view-btn ${viewMode === 'pipeline' ? 'active' : ''}`}
                onClick={() => setViewMode('pipeline')}
              >
                Barras
              </button>
              <button
                className={`kpi-pipeline-view-btn ${viewMode === 'pie' ? 'active' : ''}`}
                onClick={() => setViewMode('pie')}
              >
                Pastel
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'pipeline' ? (
          <div className="kpi-pipeline-vertical">
            {pipelineStages.map((stage, idx) => {
              const nextStage = pipelineStages[idx + 1]
              const flowOut = nextStage ? Math.min(stage.count, Math.max(stage.count - nextStage.count, 0)) : 0
              const isAlert = stage.count > 0 && (stage.count / activeCount) > 0.3
              const barWidth = maxCount > 0 ? (stage.count / maxCount) * 100 : 0

              return (
                <div key={stage.key}>
                  <div className={`kpi-pipeline-row ${isAlert ? 'alert' : ''}`}>
                    <div className="kpi-pipeline-row-left">
                      <span className="kpi-pipeline-dot" style={{ background: stage.color }} />
                      <span className="kpi-pipeline-name">{stage.label}</span>
                    </div>
                    <div className="kpi-pipeline-row-center">
                      <div className="kpi-pipeline-bar-bg">
                        <div
                          className="kpi-pipeline-bar-fill"
                          style={{
                            width: `${Math.max(barWidth, stage.count > 0 ? 8 : 0)}%`,
                            background: stage.color,
                          }}
                        />
                      </div>
                    </div>
                    <div className="kpi-pipeline-row-right">
                      <span className="kpi-pipeline-count" style={{ color: stage.color }}>
                        {stage.count}
                      </span>
                      <span className="kpi-pipeline-pct">
                        {activeCount > 0 ? `${stage.pct.toFixed(1)}%` : '0%'}
                      </span>
                    </div>
                  </div>

                  {idx < pipelineStages.length - 1 && (
                    <div className="kpi-pipeline-connector">
                      <div className="kpi-pipeline-connector-line" />
                      {flowOut > 0 && (
                        <span className="kpi-pipeline-connector-label">
                          {flowOut} salen
                        </span>
                      )}
                      <div className="kpi-pipeline-connector-line" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="kpi-pipeline-pie-wrapper">
            {pieData.length > 0 ? (
              <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 400px', height: 420 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={90}
                        outerRadius={160}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="kpi-pipeline-pie-legend">
                  {pieData.map((entry, idx) => (
                    <div key={idx} className="kpi-pipeline-pie-legend-item">
                      <span className="kpi-pipeline-pie-legend-dot" style={{ background: entry.color }} />
                      <span className="kpi-pipeline-pie-legend-label">{entry.name}</span>
                      <span className="kpi-pipeline-pie-legend-value">{entry.value}</span>
                      <span className="kpi-pipeline-pie-legend-pct">
                        {totalCount > 0 ? `${((entry.value / totalCount) * 100).toFixed(1)}%` : '0%'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#8899B5' }}>
                No hay datos para mostrar
              </div>
            )}
          </div>
        )}

        <div className="kpi-pipeline-summary">
          <div className="kpi-pipeline-summary-item">
            <span className="kpi-pipeline-summary-dot" style={{ background: '#10B981' }} />
            <span>Activas: <strong>{activeCount}</strong></span>
          </div>
          {cancelledCount > 0 && (
            <div className="kpi-pipeline-summary-item">
              <span className="kpi-pipeline-summary-dot" style={{ background: '#EF4444' }} />
              <span>Canceladas: <strong>{cancelledCount}</strong></span>
            </div>
          )}
          <div className="kpi-pipeline-summary-item">
            <span className="kpi-pipeline-summary-dot" style={{ background: '#6B7280' }} />
            <span>Total: <strong>{totalCount}</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
