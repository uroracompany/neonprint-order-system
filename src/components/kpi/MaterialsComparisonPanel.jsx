import { useEffect, useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'
import { COMPARISON_COLORS, getComparisonColor, getComparisonDelta, getPreviousPeriodPeak } from '../../utils/materialsComparisonColors'
import { FilterSelect } from '../ui/FilterSelect'
import { useKPISingle } from '../../hooks/useKPI'

const ALL = '__all__'
const METRIC_KEYS = ['references', 'orders_with_material', 'materials_used', 'normal_orders', 'urgent_orders', 'internal_orders', 'external_orders']
const CHART_METRICS = {
  references: { label: 'Referencias registradas', key: 'references', icon: Icons.ChartArea, chart: 'area' },
  orders: { label: 'Órdenes con material', key: 'orders_with_material', icon: Icons.ChartLine, chart: 'area' },
  variety: { label: 'Variedad de materiales', key: 'materials_used', icon: Icons.BarChart, chart: 'bar' },
}

const isoDay = date => date.toISOString().slice(0, 10)
const startOfDay = value => new Date(`${value}T00:00:00`)
const endExclusive = value => new Date(startOfDay(value).getTime() + 86400000)
const toIso = date => date.toISOString()
const toInclusiveEnd = value => new Date(new Date(value).getTime() - 86400000)
const formatDate = value => new Date(value).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
const formatShortDate = value => new Date(value).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
const rangeDays = bounds => Math.max(1, Math.round((new Date(bounds.date_to) - new Date(bounds.date_from)) / 86400000))
const formatRange = bounds => `${formatDate(bounds.date_from)} – ${formatDate(toInclusiveEnd(bounds.date_to))}`

function getPresetBounds(preset, globalBounds) {
  if (preset === 'global') return globalBounds
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const startByPreset = {
    today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    '3months': new Date(now.getFullYear(), now.getMonth() - 2, 1),
  }
  const currentFrom = startByPreset[preset]
  const duration = end.getTime() - currentFrom.getTime()
  return { date_from: toIso(currentFrom), date_to: toIso(end), compare_from: toIso(new Date(currentFrom.getTime() - duration)), compare_to: toIso(currentFrom) }
}

function getEquivalentPreviousBounds(currentFrom, currentTo) {
  const currentEnd = endExclusive(currentTo)
  const start = startOfDay(currentFrom)
  const duration = currentEnd.getTime() - start.getTime()
  return { date_from: toIso(start), date_to: toIso(currentEnd), compare_from: toIso(new Date(start.getTime() - duration)), compare_to: toIso(start) }
}

function getGranularity(days) {
  if (days <= 31) return { key: 'day', label: 'Diaria', size: 1 }
  if (days <= 92) return { key: 'week', label: 'Semanal', size: 7 }
  return { key: 'month', label: 'Mensual', size: 30 }
}

function hasValidMetrics(metrics) {
  return Boolean(metrics) && METRIC_KEYS.every(key => Number.isFinite(Number(metrics[key])) && Number(metrics[key]) >= 0)
}

function isValidAnalytics(value) {
  return Boolean(value)
    && hasValidMetrics(value.period?.metrics)
    && hasValidMetrics(value.comparison?.metrics)
    && Array.isArray(value.period?.timeline)
    && Array.isArray(value.comparison?.timeline)
}

function timelineToBucketMap(timeline) {
  return new Map((timeline || []).map(item => [Number(item.bucket_index), item]))
}

function getComparisonTone(current, previous) {
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'flat'
}

function buildCurrentGradientStops(rows) {
  if (rows.length <= 1) {
    const color = rows[0]?.comparisonColor || COMPARISON_COLORS.flat
    return [{ offset: '0%', color }, { offset: '100%', color }]
  }
  return rows.map((row, index) => ({ offset: `${(index / (rows.length - 1)) * 100}%`, color: row.comparisonColor }))
}

function getComparisonShares(rows) {
  const current = rows.reduce((sum, row) => sum + row.periodA, 0)
  const previous = rows.reduce((sum, row) => sum + row.periodB, 0)
  const total = current + previous
  return {
    current: total ? Math.round((current / total) * 100) : 0,
    previous: total ? Math.round((previous / total) * 100) : 0,
    tone: getComparisonTone(current, previous),
  }
}

function buildChartRows(currentTimeline, previousTimeline, bounds, metricKey) {
  const totalDays = rangeDays(bounds)
  const granularity = getGranularity(totalDays)
  const buckets = Math.ceil(totalDays / granularity.size)
  const currentMap = timelineToBucketMap(currentTimeline)
  const previousMap = timelineToBucketMap(previousTimeline)
  const currentStart = new Date(bounds.date_from)
  const previousStart = new Date(bounds.compare_from)
  const previousPeak = getPreviousPeriodPeak(Array.from({ length: buckets }, (_, bucketIndex) => Number(previousMap.get(bucketIndex)?.[metricKey] || 0)))

  const rows = Array.from({ length: buckets }, (_, bucketIndex) => {
      const offset = bucketIndex * granularity.size
      const currentDate = new Date(currentStart.getTime() + offset * 86400000)
      const previousDate = new Date(previousStart.getTime() + offset * 86400000)
      const periodA = Number(currentMap.get(bucketIndex)?.[metricKey] || 0)
      const periodB = Number(previousMap.get(bucketIndex)?.[metricKey] || 0)
      return {
        label: granularity.key === 'day' ? formatShortDate(currentDate) : `${granularity.key === 'week' ? 'Sem' : 'Mes'} ${bucketIndex + 1}`,
        periodA,
        periodB,
        comparisonTone: getComparisonTone(periodA, periodB),
        comparisonReference: previousPeak,
        comparisonDelta: getComparisonDelta(periodA, previousPeak),
        comparisonColor: getComparisonColor(periodA, previousPeak),
        periodALabel: formatShortDate(currentDate),
        periodBLabel: formatShortDate(previousDate),
      }
    })

  return { granularity, rows, previousPeak, currentGradientStops: buildCurrentGradientStops(rows) }
}

function Metric({ label, current, previous, loading, emphasizeLabel = false }) {
  if (loading) return <article className="kpi-materials-compare-metric is-skeleton" aria-label={`Cargando ${label}`}><span>{label}</span><i /><i /><i /></article>
  const difference = current - previous
  const percentage = previous ? Math.round((difference / previous) * 100) : null
  const tone = difference > 0 ? 'is-up' : difference < 0 ? 'is-down' : 'is-flat'
  return <article className="kpi-materials-compare-metric"><span>{emphasizeLabel ? <strong className="kpi-materials-compare-metric-label--emphasized">{label}</strong> : label}</span><strong>{formatNumber(current)}</strong><small>vs. {formatNumber(previous)} en el período anterior</small><em className={tone}>{difference > 0 ? '↑' : difference < 0 ? '↓' : '—'} {percentage === null ? 'Sin base comparable' : `${Math.abs(percentage)}%`}</em></article>
}

function SplitMetric({ label, currentFirst, currentSecond, previousFirst, previousSecond, firstLabel, secondLabel, loading }) {
  if (loading) return <article className="kpi-materials-compare-split is-skeleton" aria-label={`Cargando ${label}`}><i /><i /><i /></article>
  const currentTotal = currentFirst + currentSecond
  const currentPercent = currentTotal ? Math.round((currentFirst / currentTotal) * 100) : 0
  const previousTotal = previousFirst + previousSecond
  const previousPercent = previousTotal ? Math.round((previousFirst / previousTotal) * 100) : 0
  return <article className="kpi-materials-compare-split"><div><span>{label}</span><small>{currentPercent}% {firstLabel.toLowerCase()} · antes {previousPercent}%</small></div><div className="kpi-materials-compare-split-bar" aria-label={`${label}: ${firstLabel} ${currentFirst}, ${secondLabel} ${currentSecond}`}><i style={{ width: `${currentPercent}%` }} /></div><div className="kpi-materials-compare-split-legend"><span>{firstLabel} <strong>{formatNumber(currentFirst)}</strong></span><span>{secondLabel} <strong>{formatNumber(currentSecond)}</strong></span></div></article>
}

function ComparisonChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  return <div className="kpi-materials-compare-tooltip"><strong>{label}</strong><span className="is-current" style={{ '--comparison-current-color': point?.comparisonColor || COMPARISON_COLORS.flat }}><i />Período actual ({point?.periodALabel}): <b>{formatNumber(point?.periodA || 0)}</b></span><span className="is-reference"><i />Máximo del período anterior: <b>{formatNumber(point?.comparisonReference || 0)}</b></span><span className="is-previous"><i />Período anterior ({point?.periodBLabel}): <b>{formatNumber(point?.periodB || 0)}</b></span></div>
}

function ComparisonDot({ cx, cy, payload }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null
  return <circle cx={cx} cy={cy} r={4} fill={payload?.comparisonColor || COMPARISON_COLORS.flat} stroke="#fff" strokeWidth={2} />
}

function getFailureMessage(errorInfo) {
  if (errorInfo?.code === 'MATERIALS_COMPARISON_SOURCE_UNAVAILABLE' || errorInfo?.status === 503) return 'La fuente de comparación no está disponible todavía. La migración de datos debe aplicarse antes de mostrar métricas confiables.'
  if (errorInfo?.code === 'MATERIALS_COMPARISON_FORBIDDEN') return 'Tu perfil no tiene permiso para consultar esta comparación.'
  return 'No fue posible obtener una comparación confiable. Ningún valor en cero se mostrará hasta recuperar los datos.'
}

function UnavailableState({ errorInfo, onRetry }) {
  return <div className="kpi-materials-compare-unavailable" role="alert"><div><strong>Datos de comparación no disponibles</strong><p>{getFailureMessage(errorInfo)}</p></div><button type="button" onClick={onRetry}>Reintentar</button></div>
}

export default function MaterialsComparisonPanel({ globalBounds, fallbackAnalytics, userId }) {
  const [preset, setPreset] = useState('global')
  const [currentFrom, setCurrentFrom] = useState('')
  const [currentTo, setCurrentTo] = useState('')
  const [materialKey, setMaterialKey] = useState(ALL)
  const [orderType, setOrderType] = useState(ALL)
  const [designType, setDesignType] = useState(ALL)
  const [chartMetric, setChartMetric] = useState('references')

  const requestBounds = useMemo(() => {
    if (preset !== 'custom') return getPresetBounds(preset, globalBounds)
    if (![currentFrom, currentTo].every(Boolean) || startOfDay(currentFrom) >= endExclusive(currentTo)) return globalBounds
    return getEquivalentPreviousBounds(currentFrom, currentTo)
  }, [currentFrom, currentTo, globalBounds, preset])
  const granularity = useMemo(() => getGranularity(rangeDays(requestBounds)), [requestBounds])
  const requestParams = useMemo(() => ({ ...requestBounds, material_key: materialKey === ALL ? null : materialKey, order_type: orderType === ALL ? null : orderType, design_type: designType === ALL ? null : designType, granularity: granularity.key }), [designType, granularity.key, materialKey, orderType, requestBounds])
  const comparisonQuery = useKPISingle('materials_comparison_series', requestParams, userId)
  const isFreshResult = !comparisonQuery.error && !comparisonQuery.isPlaceholderData && isValidAnalytics(comparisonQuery.data)
  const analytics = isFreshResult ? comparisonQuery.data : null
  const isLoading = comparisonQuery.loading || comparisonQuery.fetching || comparisonQuery.isPlaceholderData
  const hasFailure = Boolean(comparisonQuery.error) || (!isLoading && comparisonQuery.data && !isValidAnalytics(comparisonQuery.data))
  const currentMetrics = analytics?.period.metrics
  const previousMetrics = analytics?.comparison.metrics
  const materialOptions = useMemo(() => {
    const fallbackRows = fallbackAnalytics?.period?.summary || fallbackAnalytics?.summary || []
    const source = analytics?.materials?.length ? analytics.materials : fallbackRows.map(item => ({ value: String(item.material_id || item.name), label: item.name }))
    const materials = new Map(source.map(item => [String(item.value), item.label]))
    return [{ value: ALL, label: 'Todos los materiales' }, ...Array.from(materials, ([value, label]) => ({ value, label })).sort((first, second) => first.label.localeCompare(second.label, 'es'))]
  }, [analytics, fallbackAnalytics])
  const selectedMetric = CHART_METRICS[chartMetric]
  const chartData = useMemo(() => analytics ? buildChartRows(analytics.period.timeline, analytics.comparison.timeline, requestBounds, selectedMetric.key) : null, [analytics, requestBounds, selectedMetric.key])
  const hasChartData = chartData?.rows.some(row => row.periodA > 0 || row.periodB > 0)
  const comparisonShares = useMemo(() => chartData ? getComparisonShares(chartData.rows) : null, [chartData])
  const hasOrderFilter = orderType !== ALL || designType !== ALL

  useEffect(() => {
    if (!hasFailure) return
    console.error('[KPI Materials comparison] Data request failed', {
      code: comparisonQuery.errorInfo?.code === 'INTERNAL' && comparisonQuery.errorInfo?.status === 503
        ? 'MATERIALS_COMPARISON_SOURCE_UNAVAILABLE'
        : comparisonQuery.errorInfo?.code || 'MATERIALS_COMPARISON_INVALID_RESPONSE',
      status: comparisonQuery.errorInfo?.status || null,
      message: comparisonQuery.error || 'The comparison response did not match the expected contract.',
      granularity: granularity.key,
      filters: {
        material: materialKey === ALL ? 'all' : 'selected',
        orderType: orderType === ALL ? 'all' : orderType,
        designType: designType === ALL ? 'all' : designType,
      },
    })
  }, [comparisonQuery.error, comparisonQuery.errorInfo?.code, comparisonQuery.errorInfo?.status, designType, granularity.key, hasFailure, materialKey, orderType])

  const updatePreset = value => {
    setPreset(value)
    if (value !== 'custom') return
    setCurrentFrom(isoDay(new Date(globalBounds.date_from)))
    setCurrentTo(isoDay(toInclusiveEnd(globalBounds.date_to)))
  }

  return (
    <section className="kpi-section" aria-label="Comparación de rendimiento de materiales">
      <div className="kpi-section-header"><div><span className="kpi-section-kicker">Comparación</span><h2 className="kpi-section-title">Rendimiento de materiales por período</h2><p className="kpi-section-subtitle">Compara referencias registradas, órdenes con material y variedad entre el período seleccionado y el período anterior de igual duración.</p></div></div>
      <div className="kpi-card kpi-materials-comparison-workspace" data-comparison-state={hasFailure ? 'error' : isLoading ? 'loading' : analytics ? 'ready' : 'idle'}>
        <div className="kpi-materials-compare-controls">
          <FilterSelect label="Base temporal" icon={<Icons.Calendar />} value={preset} onChange={updatePreset} options={[{ value: 'global', label: 'Rango del KPI vs. anterior' }, { value: 'today', label: 'Hoy vs. ayer' }, { value: 'week', label: 'Últimos 7 días vs. anteriores' }, { value: 'month', label: 'Mes actual vs. anterior equivalente' }, { value: '3months', label: 'Últimos 3 meses vs. anteriores' }, { value: 'custom', label: 'Comparación personalizada' }]} />
          <FilterSelect label="Material" icon={<Icons.Package />} value={materialKey} onChange={setMaterialKey} options={materialOptions} searchable isActive={materialKey !== ALL} />
          <FilterSelect label="Prioridad" icon={<Icons.Orders />} value={orderType} onChange={setOrderType} options={[{ value: ALL, label: 'Todos los tipos' }, { value: 'normal', label: 'Orden normal' }, { value: 'urgent', label: 'Orden 911' }]} isActive={orderType !== ALL} />
          <FilterSelect label="Diseño" icon={<Icons.ChartArea />} value={designType} onChange={setDesignType} options={[{ value: ALL, label: 'Todos los diseños' }, { value: 'internal', label: 'Diseño interno' }, { value: 'external', label: 'Diseño externo' }]} isActive={designType !== ALL} />
        </div>

        {preset === 'custom' && <div className="kpi-materials-compare-date-grid is-equivalent"><label><span>Período A · desde</span><input type="date" value={currentFrom} onChange={event => setCurrentFrom(event.target.value)} /></label><label><span>Período A · hasta</span><input type="date" value={currentTo} onChange={event => setCurrentTo(event.target.value)} /></label><p>El Período B se calcula automáticamente con la misma duración.</p></div>}

        <div className="kpi-materials-compare-periods"><div><span>Período A · {rangeDays(requestBounds)} días</span><strong>{formatRange(requestBounds)}</strong></div><Icons.ArrowRight size={18} /><div><span>Período B · {rangeDays({ date_from: requestBounds.compare_from, date_to: requestBounds.compare_to })} días</span><strong>{formatRange({ date_from: requestBounds.compare_from, date_to: requestBounds.compare_to })}</strong></div></div>

        {hasFailure ? <UnavailableState errorInfo={comparisonQuery.errorInfo} onRetry={comparisonQuery.refresh} /> : <>
          {isLoading && <p className="kpi-materials-compare-feedback">Actualizando comparación…</p>}
          <div className="kpi-materials-compare-metrics" aria-busy={isLoading}><Metric label="Referencias registradas" current={Number(currentMetrics?.references)} previous={Number(previousMetrics?.references)} loading={isLoading} emphasizeLabel /><Metric label={hasOrderFilter ? 'Órdenes filtradas' : 'Órdenes con material'} current={Number(currentMetrics?.orders_with_material)} previous={Number(previousMetrics?.orders_with_material)} loading={isLoading} /><Metric label="Variedad de materiales" current={Number(currentMetrics?.materials_used)} previous={Number(previousMetrics?.materials_used)} loading={isLoading} /></div>
          <section className="kpi-materials-comparison-chart" aria-label="Gráfica comparativa de materiales" aria-busy={isLoading}>
            <div className="kpi-materials-comparison-chart-header"><div><span>EVOLUCIÓN COMPARATIVA</span><h3 className={selectedMetric.key === 'references' ? 'is-emphasized' : undefined}>{selectedMetric.label}</h3></div><div className="kpi-materials-comparison-chart-summary"><small>Agrupación {granularity.label.toLowerCase()}</small>{comparisonShares && <div className="kpi-materials-comparison-shares" aria-label={`Distribución de ${selectedMetric.label.toLowerCase()} con los filtros actuales: período anterior ${comparisonShares.previous}% y período actual ${comparisonShares.current}%`}><span className="is-previous">Anterior <b>{comparisonShares.previous}%</b></span><i>·</i><span className={`is-${comparisonShares.tone}`}>Actual <b>{comparisonShares.current}%</b></span></div>}</div></div>
            <div className="kpi-materials-comparison-chart-tabs" role="tablist" aria-label="Métrica de la gráfica">{Object.entries(CHART_METRICS).map(([key, metric]) => { const Icon = metric.icon; return <button key={key} type="button" role="tab" aria-selected={chartMetric === key} className={chartMetric === key ? 'is-active' : ''} onClick={() => setChartMetric(key)}><Icon size={14} />{metric.label}</button> })}</div>
            {isLoading ? <div className="kpi-materials-comparison-chart-empty is-skeleton" aria-label="Cargando gráfica"><i /><i /><i /></div> : hasChartData ? <><div className="kpi-materials-comparison-chart-canvas"><ResponsiveContainer width="100%" height="100%">{selectedMetric.chart === 'bar' ? <BarChart data={chartData.rows} margin={{ top: 10, right: 8, bottom: 0, left: -18 }} barGap={4}><CartesianGrid vertical={false} stroke="#e2e8f5" strokeDasharray="4 4" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#71809a', fontSize: 10 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#71809a', fontSize: 10 }} /><Tooltip content={<ComparisonChartTooltip />} cursor={{ fill: 'rgba(36, 84, 217, .05)' }} /><Bar dataKey="periodB" name="Período anterior" fill={COMPARISON_COLORS.previous} radius={[4, 4, 0, 0]} maxBarSize={34} /><Bar dataKey="periodA" name="Período actual" radius={[4, 4, 0, 0]} maxBarSize={34}>{chartData.rows.map(row => <Cell key={row.label} fill={row.comparisonColor} />)}</Bar></BarChart> : <ComposedChart data={chartData.rows} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}><defs><linearGradient id="materials-period-previous" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#94a3b8" stopOpacity=".14" /><stop offset="100%" stopColor="#94a3b8" stopOpacity="0" /></linearGradient><linearGradient id="materials-period-current-stroke" x1="0" x2="1" y1="0" y2="0">{chartData.currentGradientStops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />)}</linearGradient><linearGradient id="materials-period-current-fill" x1="0" x2="1" y1="0" y2="0">{chartData.currentGradientStops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity=".13" />)}</linearGradient></defs><CartesianGrid vertical={false} stroke="#e2e8f5" strokeDasharray="4 4" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#71809a', fontSize: 10 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#71809a', fontSize: 10 }} /><Tooltip content={<ComparisonChartTooltip />} /><Area type="monotone" dataKey="periodB" name="Período anterior" stroke={COMPARISON_COLORS.previous} strokeWidth={2} fill="url(#materials-period-previous)" /><Area type="monotone" dataKey="periodA" name="Período actual" stroke="url(#materials-period-current-stroke)" strokeWidth={3} fill="url(#materials-period-current-fill)" strokeLinecap="round" strokeLinejoin="round" dot={<ComparisonDot />} activeDot={<ComparisonDot />} /></ComposedChart>}</ResponsiveContainer></div><div className="kpi-materials-comparison-chart-legend"><span><i className="is-previous" />Período anterior</span><span><i className="is-down" />≤ −40%</span><span><i className="is-gradient" />Acercándose a la referencia</span><span><i className="is-flat" />Igual (0%)</span><span><i className="is-up" />≥ +10%</span></div></> : <div className="kpi-materials-comparison-chart-empty">No hay datos de {selectedMetric.label.toLowerCase()} para los filtros seleccionados.</div>}
          </section>
          <div className="kpi-materials-compare-splits"><SplitMetric label="Tipo de orden" firstLabel="911" secondLabel="Normal" currentFirst={Number(currentMetrics?.urgent_orders)} currentSecond={Number(currentMetrics?.normal_orders)} previousFirst={Number(previousMetrics?.urgent_orders)} previousSecond={Number(previousMetrics?.normal_orders)} loading={isLoading} /><SplitMetric label="Origen del diseño" firstLabel="Interno" secondLabel="Externo" currentFirst={Number(currentMetrics?.internal_orders)} currentSecond={Number(currentMetrics?.external_orders)} previousFirst={Number(previousMetrics?.internal_orders)} previousSecond={Number(previousMetrics?.external_orders)} loading={isLoading} /></div>
        </>}
      </div>
    </section>
  )
}
