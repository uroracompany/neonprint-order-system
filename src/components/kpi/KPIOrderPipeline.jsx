import { useMemo } from 'react'
import { Icons } from '../../utils/icons'
import { FilterSelect } from '../ui/FilterSelect'

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', color: '#F59E0B', Icon: Icons.Clock },
  in_design: { label: 'Diseño', color: '#8B5CF6', Icon: Icons.Brush },
  in_quote: { label: 'Cotización', color: '#0EA5E9', Icon: Icons.FileText },
  in_production: { label: 'Producción', color: '#F97316', Icon: Icons.Package },
  in_termination: { label: 'Terminación', color: '#0284C7', Icon: Icons.Check },
  in_completed: { label: 'Completadas', color: '#16A34A', Icon: Icons.CheckCircle },
}

const PIPELINE_ORDER = Object.keys(STATUS_CONFIG)
const OPEN_PIPELINE_ORDER = PIPELINE_ORDER.filter(status => status !== 'in_completed')
const DESIGN_OPTIONS = [
  { value: 'all', label: 'Todos los diseños' },
  { value: 'INTERNAL_DESING', label: 'Diseño interno' },
  { value: 'EXTERNAL_DESING', label: 'Diseño externo' },
]
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'Todas las prioridades' },
  { value: 'orden normal', label: 'Normal' },
  { value: 'orden 911', label: '911 · Urgente' },
]

function selectBreakdown(pipeline, designType, orderType) {
  if (designType !== 'all' && orderType !== 'all') return pipeline.by_both?.[`${designType}|${orderType}`] || {}
  if (designType !== 'all') return pipeline.by_design_type?.[designType] || {}
  if (orderType !== 'all') return pipeline.by_order_type?.[orderType] || {}
  return pipeline.status_breakdown || {}
}

export default function KPIOrderPipeline({ data, filters, onFiltersChange }) {
  const pipeline = data?.executive_summary?.pipeline
  const designType = filters?.designType || 'all'
  const orderType = filters?.orderType || 'all'
  const statusBreakdown = useMemo(() => pipeline ? selectBreakdown(pipeline, designType, orderType) : {}, [pipeline, designType, orderType])
  const visibleTotal = PIPELINE_ORDER.reduce((sum, status) => sum + (Number(statusBreakdown[status]) || 0), 0)
  const activeTotal = OPEN_PIPELINE_ORDER.reduce((sum, status) => sum + (Number(statusBreakdown[status]) || 0), 0)
  const maximum = Math.max(...PIPELINE_ORDER.map(status => Number(statusBreakdown[status]) || 0), 1)

  if (!pipeline) return null

  const updateFilter = (key, value) => onFiltersChange?.({ designType, orderType, [key]: value })

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Foto operativa actual</span>
          <h2 className="kpi-section-title">Cartera actual por etapa</h2>
          <p className="kpi-section-subtitle">Estados actuales por orden; Completadas permanece visible como etapa terminal pendiente de entrega.</p>
        </div>
      </div>

      <div className="kpi-pipeline-card">
        <div className="kpi-pipeline-filters" aria-label="Filtros de cartera actual">
          <div className="kpi-pipeline-filter-group">
            <span className="kpi-pipeline-filter-label">Tipo de diseño</span>
            <FilterSelect icon={<Icons.Brush />} value={designType} onChange={value => updateFilter('designType', value)} options={DESIGN_OPTIONS} label="Filtrar por tipo de diseño" isActive={designType !== 'all'} />
          </div>
          <div className="kpi-pipeline-filter-group">
            <span className="kpi-pipeline-filter-label">Prioridad</span>
            <FilterSelect icon={<Icons.AlertCircle />} value={orderType} onChange={value => updateFilter('orderType', value)} options={PRIORITY_OPTIONS} label="Filtrar por prioridad" isActive={orderType !== 'all'} />
          </div>
        </div>

        <div className="kpi-pipeline-vertical">
          {PIPELINE_ORDER.map(status => {
            const config = STATUS_CONFIG[status]
            const count = Number(statusBreakdown[status]) || 0
            const percentage = visibleTotal > 0 ? (count / visibleTotal) * 100 : 0
            const StatusIcon = config.Icon
            return (
              <article key={status} className={`kpi-pipeline-row ${status === 'in_completed' ? 'is-completed' : ''}`} style={{ '--kpi-stage-color': config.color }}>
                <div className="kpi-pipeline-row-left">
                  <span className="kpi-pipeline-stage-icon"><StatusIcon /></span>
                  <span className="kpi-pipeline-name">{config.label}</span>
                </div>
                <div className="kpi-pipeline-row-right"><strong className="kpi-pipeline-count">{count}</strong><span className="kpi-pipeline-pct">{percentage.toFixed(1)}%</span></div>
                <div className="kpi-pipeline-row-center"><div className="kpi-pipeline-bar-bg" role="progressbar" aria-label={`${config.label}: ${count} órdenes`} aria-valuemin="0" aria-valuemax={maximum} aria-valuenow={count}><div className="kpi-pipeline-bar-fill" style={{ width: `${(count / maximum) * 100}%` }} /></div></div>
              </article>
            )
          })}
        </div>

        <div className="kpi-pipeline-summary"><div className="kpi-pipeline-summary-item"><span className="kpi-pipeline-summary-dot" style={{ background: '#10B981' }} /><span>Órdenes en curso: <strong>{activeTotal}</strong></span></div></div>
      </div>
    </div>
  )
}
