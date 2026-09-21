import { useEffect, useMemo, useRef, useState } from 'react'
import { formatNumber, getMaterialGlobalBounds, getMaterialPeriodBounds, KPI_CHART_COLORS } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'
import { FilterSelect } from '../ui/FilterSelect'
import { useKPISingle } from '../../hooks/useKPI'
import MaterialAnalyticsDialog from './MaterialAnalyticsDialog'
import DonutChart from '../charts/DonutChart'
import TrendChart from '../charts/TrendChart'
import RankingRow from './RankingRow'
import '../../css-components/material-analytics-modal.css'

const EMPTY_ARRAY = Object.freeze([])
const PERIOD_MODES = [
  { value: 'history', label: 'Histórico' },
  { value: 'current', label: 'Este mes' },
  { value: '2months', label: 'Últimos 2 meses' },
  { value: '3months', label: 'Últimos 3 meses' },
]
const normalizeName = value => String(value || '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ')
const normalizeId = value => value === null || value === undefined || value === '' ? null : String(value)

function findMaterial(rows, target) {
  const targetId = normalizeId(target?.material_id)
  if (targetId) return rows.find(row => normalizeId(row?.material_id) === targetId) || null
  const targetName = normalizeName(target?.name)
  const matches = rows.filter(row => normalizeName(row?.name) === targetName)
  return matches.length === 1 ? matches[0] : null
}

function formatTrendPeriod(value, granularity = 'day') {
  const parts = String(value || '').split('-').map(Number)
  if (parts.length < 2 || !parts[0] || !parts[1]) return value
  if (granularity === 'month') return new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' }).format(new Date(parts[0], parts[1] - 1, 1))
  if (!parts[2]) return value
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(parts[0], parts[1] - 1, parts[2]))
}

function Metric({ label, value, tone = 'default', icon, detail }) {
  return <div className={`kpi-material-detail-metric is-${tone}`}><span className="kpi-material-detail-metric-label">{icon}{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}

function TrendSection({ activeMaterial, previousMaterial, chartType, setChartType }) {
  const granularity = activeMaterial?.trend_granularity || 'day'
  const toRows = row => Array.isArray(row?.trend)
    ? row.trend.map(point => ({ day: point.period, count: Number(point.count || 0) }))
    : Object.entries(row?.daily || {}).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count: Number(count || 0) }))
  const trendData = toRows(activeMaterial)
  const comparisonData = toRows(previousMaterial)

  return <section className="kpi-material-detail-trend">
    <div className="kpi-material-detail-trend-heading"><div><span className="kpi-material-detail-eyebrow">Actividad</span><h3>Tendencia de referencias</h3></div><div className="kpi-material-detail-trend-toggle" role="group" aria-label="Tipo de gráfica de tendencia"><button type="button" className={chartType === 'bar' ? 'active' : ''} onClick={() => setChartType('bar')} aria-pressed={chartType === 'bar'} aria-label="Mostrar gráfica de barras"><Icons.BarChart size={14} />Barras</button><button type="button" className={chartType === 'line' ? 'active' : ''} onClick={() => setChartType('line')} aria-pressed={chartType === 'line'} aria-label="Mostrar gráfica de línea"><Icons.ChartLine size={14} />Línea</button><button type="button" className={chartType === 'area' ? 'active' : ''} onClick={() => setChartType('area')} aria-pressed={chartType === 'area'} aria-label="Mostrar gráfica de área"><Icons.ChartArea size={14} />Área</button></div></div>
    {trendData.length > 1 ? <TrendChart data={trendData} comparisonData={comparisonData} mode={chartType} height={200} color="#1E40AF" comparisonColor="#94A3B8" dataKey="count" nameKey="day" showComparison={Boolean(previousMaterial)} tooltipFormatter={value => [formatNumber(value), 'Referencias']} labelFormatter={value => formatTrendPeriod(value, granularity)} /> : trendData.length === 1 ? <div className="kpi-material-detail-trend-single" aria-label={`${formatNumber(trendData[0].count)} referencias en ${formatTrendPeriod(trendData[0].day, granularity)}`}><span className="kpi-material-detail-trend-single-dot" aria-hidden="true" /><div><strong>{formatNumber(trendData[0].count)} referencia{Number(trendData[0].count) === 1 ? '' : 's'}</strong><span>{formatTrendPeriod(trendData[0].day, granularity)}</span></div><p>Actividad registrada en un único punto del período.</p></div> : <p className="kpi-material-detail-empty">No hay tendencia disponible para este período.</p>}
  </section>
}

export default function MaterialDetailModal({ material, previousMaterial, totalReferences, userId, source = 'kpi', onClose, returnFocusRef }) {
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const [periodMode, setPeriodMode] = useState(source === 'catalog' ? 'history' : 'current')
  const [chartType, setChartType] = useState('line')
  const materialKey = `${source}:${material?.material_id || material?.name || ''}`

  useEffect(() => {
    setPeriodMode(source === 'catalog' ? 'history' : 'current')
    setChartType('line')
  }, [materialKey, source])

  const requestBounds = useMemo(() => {
    if (periodMode === 'history') return getMaterialGlobalBounds()
    if (periodMode === 'current' && source === 'kpi') return null
    return getMaterialPeriodBounds(periodMode)
  }, [periodMode, source])
  const shouldQuery = Boolean(userId) && Boolean(requestBounds)
  const detailQuery = useKPISingle('materials_analytics', requestBounds, userId, shouldQuery)
  const queryLoading = shouldQuery && (detailQuery.loading || detailQuery.fetching || detailQuery.isPlaceholderData)

  const resolved = useMemo(() => {
    if (!userId) return { material: null, previousMaterial: null, totalReferences: 0, loading: false, error: null, empty: false, sessionMissing: true, retry: () => {} }
    if (!shouldQuery) return { material, previousMaterial, totalReferences: Number(totalReferences || 0), loading: false, error: null, empty: false, sessionMissing: false, retry: () => {} }
    const active = findMaterial(detailQuery.data?.period?.summary || EMPTY_ARRAY, material)
    return {
      material: active,
      previousMaterial: findMaterial(detailQuery.data?.comparison?.summary || EMPTY_ARRAY, active || material),
      totalReferences: Number(detailQuery.data?.period?.material_references || 0),
      loading: queryLoading,
      error: detailQuery.error || null,
      empty: !queryLoading && !detailQuery.error && !active,
      sessionMissing: false,
      retry: detailQuery.refresh,
    }
  }, [detailQuery.data, detailQuery.error, detailQuery.refresh, material, previousMaterial, queryLoading, shouldQuery, totalReferences, userId])

  const periodLabel = periodMode === 'history' ? 'Uso registrado en todas las órdenes del historial.' : periodMode === 'current' ? 'Uso registrado en las órdenes del mes actual.' : periodMode === '2months' ? 'Uso registrado en las órdenes de los últimos 2 meses.' : 'Uso registrado en las órdenes de los últimos 3 meses.'
  if (!material) return null

  const activeMaterial = resolved.material
  const references = Number(activeMaterial?.reference_count ?? activeMaterial?.total_orders ?? 0)
  const orders = Number(activeMaterial?.total_orders || 0)
  const cancelledOrders = Math.max(0, Number(activeMaterial?.cancelled_orders || 0))
  const cancellationPercentage = orders > 0 ? Math.round((cancelledOrders / orders) * 100) : 0
  const participation = resolved.totalReferences ? Math.round((references / resolved.totalReferences) * 100) : 0
  const clients = activeMaterial?.top_clients || EMPTY_ARRAY
  const sellers = activeMaterial?.top_sellers || EMPTY_ARRAY

  return <MaterialAnalyticsDialog open={Boolean(material)} onClose={onClose} labelledBy="material-detail-title" describedBy="material-detail-description" dialogRef={dialogRef} initialFocusRef={closeButtonRef} returnFocusRef={returnFocusRef}>
    <header className="kpi-material-detail-header"><span className="kpi-material-detail-icon"><Icons.Package /></span><div><span className="kpi-material-detail-eyebrow">Detalle de material</span><h2 id="material-detail-title">{material.name}</h2><p id="material-detail-description">{periodLabel}</p></div><button type="button" className="kpi-material-detail-close" onClick={onClose} aria-label={`Cerrar detalle de ${material.name}`} ref={closeButtonRef}><Icons.Close /></button></header>
    <div className="kpi-material-detail-period"><FilterSelect icon={<Icons.Calendar size={14} />} value={periodMode} onChange={setPeriodMode} options={PERIOD_MODES} label="Período del detalle de material" isActive={periodMode !== 'current'} disabled={resolved.loading} /></div>
    <div className="kpi-material-detail-modal-scroll">
      {resolved.loading && <p className="kpi-material-detail-feedback" role="status">{source === 'catalog' ? 'Cargando histórico del material…' : 'Actualizando el período…'}</p>}
      {resolved.error && !resolved.loading && <p className="kpi-material-detail-feedback is-error" role="alert">No fue posible obtener los datos de este período. <button type="button" onClick={resolved.retry}>Reintentar</button></p>}
      {resolved.sessionMissing && <div className="kpi-material-detail-loading" role="alert">No hay una sesión administrativa disponible para consultar el histórico del material.</div>}
      {resolved.empty && <div className="kpi-material-detail-loading" role="status">No hay referencias en órdenes para este material.</div>}
      {activeMaterial && !resolved.loading && !resolved.error && !resolved.sessionMissing && <>
        <div className="kpi-material-detail-metrics"><Metric label="Referencias" value={formatNumber(references)} icon={<Icons.Package size={15} />} /><Metric label="Órdenes" value={formatNumber(orders)} icon={<Icons.FileText size={15} />} /><Metric label="Participación" value={`${participation}%`} icon={<Icons.ChartArea size={15} />} /><Metric label="Cancelación" value={`${cancellationPercentage}%`} tone={cancelledOrders > 0 ? 'negative' : 'default'} icon={<Icons.AlertCircle size={15} />} detail={orders > 0 ? `${formatNumber(cancelledOrders)} de ${formatNumber(orders)} órdenes canceladas` : 'Sin órdenes registradas'} /></div>
        <div className="kpi-material-detail-distributions"><DonutChart data={[{ name: '911', value: activeMaterial.urgent_orders || 0, color: KPI_CHART_COLORS[0] }, { name: 'Normal', value: activeMaterial.normal_orders || 0, color: KPI_CHART_COLORS[1] }]} label="Tipo de orden" totalLabel="Total órdenes" height={160} /><DonutChart data={[{ name: 'Interno', value: activeMaterial.internal_design_orders || 0, color: KPI_CHART_COLORS[0] }, { name: 'Externo', value: activeMaterial.external_design_orders || 0, color: KPI_CHART_COLORS[1] }]} label="Origen del diseño" totalLabel="Total órdenes" height={160} /></div>
        <div className="kpi-material-detail-lists">
          <section className="kpi-material-detail-ranking"><h3><Icons.User size={16} />Clientes principales</h3>{clients.length ? <div className="kpi-ranking-container" role="list" aria-label="Clientes principales">{[...clients].sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.client_name || '').localeCompare(String(b.client_name || ''), 'es')).slice(0, 5).map((client, index) => <RankingRow key={client.client_id || client.client_name || index} rank={index + 1} name={client.client_name} value={client.count} percentage={resolved.totalReferences ? Math.round((Number(client.count || 0) / resolved.totalReferences) * 100) : 0} />)}</div> : <p className="kpi-material-detail-empty">No hay clientes asociados en este período.</p>}</section>
          <section className="kpi-material-detail-ranking"><h3><Icons.Users size={16} />Vendedores principales</h3>{sellers.length ? <div className="kpi-ranking-container" role="list" aria-label="Vendedores principales">{[...sellers].sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.seller_name || '').localeCompare(String(b.seller_name || ''), 'es')).slice(0, 5).map((seller, index) => <RankingRow key={seller.seller_id || seller.seller_name || index} rank={index + 1} name={seller.seller_name} value={seller.count} subtitle={seller.seller_email} percentage={resolved.totalReferences ? Math.round((Number(seller.count || 0) / resolved.totalReferences) * 100) : 0} />)}</div> : <p className="kpi-material-detail-empty">No hay vendedores asociados en este período.</p>}</section>
        </div>
        <TrendSection activeMaterial={activeMaterial} previousMaterial={resolved.previousMaterial} chartType={chartType} setChartType={setChartType} />
      </>}
    </div>
  </MaterialAnalyticsDialog>
}
