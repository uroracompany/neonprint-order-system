import { useState, useDeferredValue, useMemo, useRef } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, AreaChart, Area,
} from 'recharts'
import { formatNumber, getComparePeriodBounds, getMaterialGlobalBounds, getPeriodBounds, getTrendConfig, KPI_CHART_COLORS } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'
import KPISearchBox from './KPISearchBox'
import { matchesKpiSearch } from '../../utils/kpiSearch'
import { FilterSelect } from '../ui/FilterSelect'
import { Pagination as SystemPagination } from '../ui/Pagination'
import MaterialDetailModal from './MaterialDetailModal'
import MaterialsComparisonPanel from './MaterialsComparisonPanel'
import { useKPISingle } from '../../hooks/useKPI'

const PALETTE = {
  cyan: '#2454D9', green: '#10B981', rose: '#F43F5E', amber: '#F59E0B',
  violet: '#8B5CF6', orange: '#F97316', pink: '#EC4899', teal: '#14B8A6',
  indigo: '#6366F1', red: '#EF4444',
  pie: KPI_CHART_COLORS,
}

const PAGE_SIZE = 7
const EMPTY_ARRAY = Object.freeze([])
const EMPTY_OBJECT = Object.freeze({})
const ALL_KEY = '__all__'
const DISTINCT_KEY = '__distinct__'
const EVOLUTION_PERIOD_OPTIONS = [
  { value: 'month', label: 'Este mes vs. mes anterior', subtitle: 'mes actual vs. mes anterior equivalente' },
  { value: '2months', label: 'Últimos 2 meses vs. los 2 anteriores', subtitle: 'últimos 2 meses vs. los 2 anteriores equivalentes' },
  { value: '3months', label: 'Últimos 3 meses vs. los 3 anteriores', subtitle: 'últimos 3 meses vs. los 3 anteriores equivalentes' },
  { value: 'week', label: 'Esta semana vs. semana anterior', subtitle: 'esta semana vs. semana anterior' },
]
const RANKING_PERIOD_OPTIONS = [
  { value: 'general', label: 'General', subtitle: 'Materiales con mayor número de referencias en todo el historial registrado.' },
  { value: 'month', label: 'Mensual', subtitle: 'Materiales con mayor actividad durante el mes actual.' },
  { value: 'week', label: 'Semanal', subtitle: 'Materiales con mayor actividad durante la semana actual.' },
  { value: 'today', label: 'Hoy', subtitle: 'Materiales con mayor actividad registrada hoy.' },
]

const formatMaterialCount = (count) => `${formatNumber(count)} ${Number(count) === 1 ? 'material' : 'materiales'}`
const formatMetricValue = (value) => value === null || value === undefined ? 'N/D' : formatNumber(value)

const getMaterialKey = (item) => String(item?.material_id || item?.name || '').trim()

const MATERIAL_SEARCH_FIELDS = [
  'name',
  item => item?.top_clients?.map(client => client.client_name).join(' '),
  item => Object.keys(item?.daily || {}).join(' '),
  item => (item?.monthly_trend || []).map(point => point.month).join(' '),
]

const filterKpiMaterials = (items, query) => items.filter(item => matchesKpiSearch(item, query, MATERIAL_SEARCH_FIELDS))
const findKpiMaterialByKey = (items, key) => items.find(item => getMaterialKey(item) === key)
const getMaterialEmptyText = (query, isGlobal = false) => (
  query
    ? `No encontramos resultados para "${query}". Prueba con cliente, factura, material, orden o estado.`
    : isGlobal
      ? 'No hay materiales registrados en el historial disponible.'
      : 'No hay datos disponibles para este periodo.'
)

const DAY_MS = 24 * 60 * 60 * 1000

function getDateKey(value, timeZone) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type) => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function getPeriodDays(dateFrom, dateTo, timeZone) {
  const startKey = getDateKey(dateFrom, timeZone)
  const endKey = getDateKey(dateTo, timeZone)
  if (!startKey || !endKey) return EMPTY_ARRAY

  return getCalendarDays(startKey, endKey)
}

function getCalendarDays(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00Z`)
  const end = new Date(`${endKey}T00:00:00Z`)
  const days = []
  for (let cursor = start; cursor < end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    days.push(cursor.toISOString().slice(0, 10))
  }
  return days
}

function getObservedDayCount(days, timeZone) {
  if (!days.length) return 0
  const today = getDateKey(new Date().toISOString(), timeZone)
  if (!today) return days.length
  const todayIndex = days.indexOf(today)
  return todayIndex === -1
    ? (today > days[days.length - 1] ? days.length : 0)
    : todayIndex + 1
}

function getPeriodRows(rows, selectedKey) {
  if (selectedKey === ALL_KEY || selectedKey === DISTINCT_KEY) return rows
  return rows.filter(item => getMaterialKey(item) === selectedKey)
}

function getDailyIncrement(rows, day, isDistinct, seenMaterials) {
  if (isDistinct) {
    rows.forEach(item => {
      if (Number(item?.daily?.[day]) > 0) seenMaterials.add(getMaterialKey(item))
    })
    return seenMaterials.size
  }
  return rows.reduce((sum, item) => sum + Number(item?.daily?.[day] || 0), 0)
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

const SEMANTIC = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
  warning:  { iconBg: '#FEF3C7', iconColor: '#D97706', trendBg: '#FEF3C7', trendColor: '#D97706' },
}

function MiniCard({ label, value, sub, icon, sem, trend, emphasis = 'period', iconColor }) {
  return (
    <article className={`kpi-hero-card kpi-materials-metric-card is-${emphasis}`}>
      <div className="kpi-hero-icon" style={{ background: sem?.iconBg, color: iconColor || sem?.iconColor }}>{icon}</div>
      <div className="kpi-hero-content">
        <div className="kpi-hero-label">{label}</div>
        <div className="kpi-hero-value">{value}</div>
        <div className="kpi-hero-footer">
          <div className="kpi-hero-subtitle">{sub}</div>
          {trend && (
            <div className="kpi-hero-trend" style={{ background: trend.bg, color: trend.color }}>
              <span>{trend.arrow}</span>
              {trend.change !== '0.0' && <span>{Math.abs(Number(trend.change))}%</span>}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function CompactPagination({ page, total, pageSize, onPage }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => onPage(page - 1)} disabled={page === 0}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: page === 0 ? '#F8FAFC' : '#fff', color: page === 0 ? '#CBD5E1' : '#475569', cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.ChevronLeft size={14} />
      </button>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>{page + 1} / {totalPages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: page >= totalPages - 1 ? '#F8FAFC' : '#fff', color: page >= totalPages - 1 ? '#CBD5E1' : '#475569', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(180deg)' }}>
        <Icons.ChevronLeft size={14} />
      </button>
    </div>
  )
}

export default function KPIMaterialsAnalytics({ data, userId }) {
  const [selectedMaterialKey, setSelectedMaterialKey] = useState(ALL_KEY)
  const [materialSearch, setMaterialSearch] = useState('')
  const deferredMaterialSearch = useDeferredValue(materialSearch)
  const [page, setPage] = useState(0)
  const [evoMatKey, setEvoMatKey] = useState(ALL_KEY)
  const [evoPeriod, setEvoPeriod] = useState('month')
  const [evoChartType, setEvoChartType] = useState('area')
  const [topClientsPage, setTopClientsPage] = useState(0)
  const [detailMaterialKey, setDetailMaterialKey] = useState(null)
  const [rankingPeriod, setRankingPeriod] = useState('general')
  const materialTriggerRefs = useRef(new Map())

  const changeRankingPeriod = (period) => {
    if (period === rankingPeriod) return
    setRankingPeriod(period)
    setPage(0)
    setTopClientsPage(0)
    setSelectedMaterialKey(ALL_KEY)
  }

  const legacyKpis = data?.client_kpis || EMPTY_OBJECT
  const verifiedAnalytics = data?.materials_analytics || null
  const hasVerifiedContract = Boolean(verifiedAnalytics?.period)
  const materialAnalytics = hasVerifiedContract ? verifiedAnalytics : (legacyKpis.material_analytics || EMPTY_OBJECT)
  const periodMetrics = hasVerifiedContract ? (materialAnalytics.period || EMPTY_OBJECT) : materialAnalytics
  const materialComparison = hasVerifiedContract ? (materialAnalytics.comparison || null) : (legacyKpis.material_comparison || null)
  const materialSnapshot = hasVerifiedContract ? (materialAnalytics.snapshot || EMPTY_OBJECT) : EMPTY_OBJECT
  const materialCoverage = hasVerifiedContract ? (materialAnalytics.coverage || EMPTY_OBJECT) : EMPTY_OBJECT
  const materialMeta = hasVerifiedContract ? (materialAnalytics.meta || EMPTY_OBJECT) : EMPTY_OBJECT
  const summary = periodMetrics.summary || EMPTY_ARRAY
  const evolutionBounds = useMemo(() => {
    const current = getPeriodBounds(evoPeriod)
    const comparison = getComparePeriodBounds(evoPeriod, current)
    return {
      date_from: current.dateFrom,
      date_to: current.dateTo,
      compare_from: comparison.dateFrom,
      compare_to: comparison.dateTo,
    }
  }, [evoPeriod])
  const evolutionQuery = useKPISingle('materials_analytics', evolutionBounds, userId)
  const isEvolutionLoading = evolutionQuery.loading || evolutionQuery.fetching || evolutionQuery.isPlaceholderData
  const evolutionAnalytics = !isEvolutionLoading && !evolutionQuery.error ? evolutionQuery.data : null
  const evolutionPeriodMetrics = evolutionAnalytics?.period || EMPTY_OBJECT
  const evolutionComparisonMetrics = evolutionAnalytics?.comparison || EMPTY_OBJECT
  const evolutionSummary = evolutionPeriodMetrics.summary || EMPTY_ARRAY
  const evolutionComparisonSummary = evolutionComparisonMetrics.summary || EMPTY_ARRAY
  const evolutionMeta = evolutionAnalytics?.meta || EMPTY_OBJECT

  const totalCurrent = hasVerifiedContract
    ? Number(periodMetrics.material_references || 0)
    : summary.reduce((s, m) => s + m.total_orders, 0)
  const totalOrdersWithMaterial = hasVerifiedContract
    ? Number(periodMetrics.orders_with_material || 0)
    : totalCurrent
  const totalComparison = hasVerifiedContract
    ? Number(materialComparison?.material_references || 0)
    : (materialComparison?.period_total || 0)

  const rankingBounds = useMemo(() => {
    if (rankingPeriod === 'general') return getMaterialGlobalBounds()
    const current = getPeriodBounds(rankingPeriod)
    const comparison = getComparePeriodBounds(rankingPeriod, current)
    return {
      date_from: current.dateFrom,
      date_to: current.dateTo,
      compare_from: comparison.dateFrom,
      compare_to: comparison.dateTo,
    }
  }, [rankingPeriod])
  const rankingQuery = useKPISingle('materials_analytics', rankingBounds, userId)
  const isRankingLoading = rankingQuery.loading || rankingQuery.fetching || rankingQuery.isPlaceholderData
  const rankingAnalytics = !isRankingLoading && !rankingQuery.error ? rankingQuery.data : null
  const rankingSummary = rankingAnalytics?.period?.summary || EMPTY_ARRAY
  const rankingTotal = Number(rankingAnalytics?.period?.material_references || 0)
  const rankingPrevSummary = rankingAnalytics?.comparison?.summary || null
  const hasRankingComparison = Boolean(rankingPrevSummary?.length)
  const rankingPeriodSubtitle = RANKING_PERIOD_OPTIONS.find(option => option.value === rankingPeriod)?.subtitle || RANKING_PERIOD_OPTIONS[0].subtitle

  const filteredSummary = useMemo(() =>
    filterKpiMaterials(rankingSummary, deferredMaterialSearch),
    [rankingSummary, deferredMaterialSearch]
  )

  const topMaterial = summary[0] || null
  const cancelledAuditable = hasVerifiedContract ? Number(periodMetrics.cancelled_orders || 0) : null
  const cancelledAuditablePrevious = hasVerifiedContract ? Number(materialComparison?.cancelled_orders || 0) : null

  const trendCurrent = getTrendConfig(totalCurrent, totalComparison)
  const trendCancellations = cancelledAuditable === null ? null : getTrendConfig(cancelledAuditable, cancelledAuditablePrevious)

  const evolution = useMemo(() => {
    const timeZone = evolutionMeta.timezone || materialMeta.timezone || 'America/Asuncion'
    const currentDays = getPeriodDays(evolutionBounds.date_from, evolutionBounds.date_to, timeZone)
    const comparisonDays = getPeriodDays(evolutionBounds.compare_from, evolutionBounds.compare_to, timeZone)
    const hasComparison = Boolean(evolutionAnalytics?.comparison)
    const currentRows = getPeriodRows(evolutionSummary, evoMatKey)
    const comparisonRows = getPeriodRows(evolutionComparisonSummary, evoMatKey)
    const isDistinct = evoMatKey === DISTINCT_KEY
    const currentObservedDays = getObservedDayCount(currentDays, timeZone)
    const totalDays = Math.max(currentDays.length, comparisonDays.length)
    const currentSeen = new Set()
    const comparisonSeen = new Set()
    let currentTotal = 0
    let comparisonTotal = 0

    const trendData = [{ name: 'Inicio', Materiales: 0, ...(hasComparison ? { 'Período anterior': 0 } : {}) }]

    for (let index = 0; index < totalDays; index += 1) {
      let currentValue = null
      if (index < currentObservedDays) {
        const increment = getDailyIncrement(currentRows, currentDays[index], isDistinct, currentSeen)
        currentTotal = isDistinct ? increment : currentTotal + increment
        currentValue = currentTotal
      }

      let comparisonValue = null
      if (hasComparison && index < comparisonDays.length) {
        const increment = getDailyIncrement(comparisonRows, comparisonDays[index], isDistinct, comparisonSeen)
        comparisonTotal = isDistinct ? increment : comparisonTotal + increment
        comparisonValue = comparisonTotal
      }

      trendData.push({
        name: `Día ${index + 1}`,
        Materiales: currentValue,
        ...(hasComparison ? { 'Período anterior': comparisonValue } : {}),
      })
    }

    const barData = [
      ...(hasComparison ? [{ name: 'Período anterior', value: comparisonTotal, color: '#94A3B8' }] : []),
      { name: 'Período actual', value: currentTotal, color: PALETTE.cyan },
    ]
    const tickValues = trendData
      .filter((_, index) => index === 0 || index === trendData.length - 1 || index % 7 === 0)
      .map(point => point.name)

    return { trendData, barData, hasComparison, tickValues }
  }, [evoMatKey, evolutionAnalytics?.comparison, evolutionBounds, evolutionComparisonSummary, evolutionMeta.timezone, evolutionSummary, materialMeta.timezone])

  const evolutionMaterialOptions = useMemo(() => {
    const materials = new Map()
    ;[...evolutionSummary, ...evolutionComparisonSummary].forEach(item => {
      const key = getMaterialKey(item)
      if (key) materials.set(key, item.name)
    })
    return [
      { value: ALL_KEY, label: 'Todos' },
      { value: DISTINCT_KEY, label: 'Materiales diferentes' },
      ...Array.from(materials, ([value, label]) => ({ value, label })).sort((first, second) => first.label.localeCompare(second.label, 'es')),
    ]
  }, [evolutionComparisonSummary, evolutionSummary])

  const evoSubtitle = useMemo(() => {
    const selectedMat = evoMatKey !== ALL_KEY && evoMatKey !== DISTINCT_KEY
      ? evolutionMaterialOptions.find(option => option.value === evoMatKey)
      : null
    const periodLabel = EVOLUTION_PERIOD_OPTIONS.find(option => option.value === evoPeriod)?.subtitle || 'período actual vs. período anterior equivalente'
    if (selectedMat) {
      return `Acumulado de referencias de ${selectedMat.label}: ${periodLabel}.`
    }
    return `Acumulado de referencias de materiales: ${periodLabel}.`
  }, [evoMatKey, evoPeriod, evolutionMaterialOptions])

  if (!data) return null

  const selectedMat = selectedMaterialKey !== ALL_KEY ? findKpiMaterialByKey(filteredSummary, selectedMaterialKey) : null
  // El detalle se abre desde el ranking, cuyo rango puede diferir del resumen
  // superior del KPI. Resolverlo desde la misma consulta evita que un material
  // histórico quede en null al no haber actividad en el período del banner.
  const detailMaterial = detailMaterialKey ? findKpiMaterialByKey(rankingSummary, detailMaterialKey) : null
  const detailPreviousMaterial = detailMaterial
    ? findKpiMaterialByKey(rankingPrevSummary || EMPTY_ARRAY, detailMaterialKey)
      || rankingPrevSummary?.find(item => item.name === detailMaterial.name) || null
    : null
  const rankingTotalPages = Math.max(1, Math.ceil(filteredSummary.length / PAGE_SIZE))
  const safeRankingPage = Math.min(page, rankingTotalPages - 1)
  const detailPageData = selectedMat
    ? [selectedMat]
    : filteredSummary.slice(safeRankingPage * PAGE_SIZE, (safeRankingPage + 1) * PAGE_SIZE)

  return (
    <div className="kpi-section kpi-materials-analytics">
      {!hasVerifiedContract && (
        <section className="kpi-materials-legacy-notice" role="status" aria-label="Fuente de datos transitoria">
          <span className="kpi-materials-legacy-notice-icon"><Icons.AlertCircle size={16} /></span>
          <div>
            <strong>Fuente de datos transitoria activa</strong>
            <p>El contrato verificado de materiales no está disponible para esta sesión. Los totales y desgloses provienen del resumen de respaldo; son datos reales de las órdenes, pero serán reemplazados por el contrato verificado cuando la fuente esté disponible.</p>
          </div>
        </section>
      )}
      {hasVerifiedContract && (
        <section className="kpi-materials-snapshot" aria-label="Resumen actual de materiales" aria-describedby="materials-data-scope">
          <span id="materials-data-scope" className="kpi-materials-assistive-copy">Referencias registradas en órdenes; no representa stock, consumo físico ni disponibilidad de inventario.</span>
          <div className="kpi-hero-grid kpi-hero-grid--3">
            <MiniCard label="Materiales registrados" value={formatMetricValue(materialSnapshot.catalog_materials)} sub="En el catálogo actual" icon={<Icons.Package size={18} />} sem={SEMANTIC.neutral} iconColor={PALETTE.cyan} emphasis="snapshot" />
            <MiniCard label="Órdenes abiertas sin material" value={formatMetricValue(materialSnapshot.open_orders_without_material)} sub="Requieren asignación" icon={<Icons.Orders size={18} />} sem={Number(materialSnapshot.open_orders_without_material) > 0 ? SEMANTIC.warning : SEMANTIC.positive} emphasis="snapshot" />
            <MiniCard label="Referencias no reconocidas" value={formatMetricValue(materialCoverage.unrecognized_period_references)} sub="En el período seleccionado" icon={<Icons.AlertCircle size={18} />} sem={Number(materialCoverage.unrecognized_period_references) > 0 ? SEMANTIC.warning : SEMANTIC.positive} emphasis="snapshot" />
          </div>
        </section>
      )}

      <section className="kpi-materials-period-metrics" aria-label="Actividad del período seleccionado">
        <div className="kpi-hero-grid kpi-hero-grid--4">
          <MiniCard label="Órdenes con material" value={formatNumber(totalOrdersWithMaterial)} sub="Creadas en el período seleccionado" icon={<Icons.Orders size={18} />} sem={SEMANTIC.neutral} iconColor={PALETTE.cyan} trend={trendCurrent} />
          <MiniCard label="Referencias de material" value={formatNumber(totalCurrent)} sub="Una orden puede tener más de una" icon={<Icons.Package size={18} />} sem={SEMANTIC.neutral} iconColor={PALETTE.cyan} trend={trendCurrent} />
          <MiniCard label="Material más referenciado" value={topMaterial?.name || 'N/D'} sub={topMaterial ? `${formatNumber(topMaterial.total_orders)} órdenes que lo registran` : 'Sin referencias en el período'} icon={<Icons.Package size={18} />} sem={SEMANTIC.positive} trend={getTrendConfig(topMaterial?.total_orders || 0, materialComparison?.summary?.[0]?.total_orders || 0)} />
          <MiniCard label="Cancelaciones auditables" value={cancelledAuditable === null ? 'N/D' : formatNumber(cancelledAuditable)} sub={cancelledAuditable === null ? 'Requiere eventos de estado' : 'Transiciones a cancelada en el período'} icon={<Icons.AlertCircle size={18} />} sem={cancelledAuditable === null ? SEMANTIC.neutral : (cancelledAuditable > 0 ? SEMANTIC.negative : SEMANTIC.positive)} trend={trendCancellations} />
        </div>
      </section>

      {/* ─── EVOLUTION CHART ─── */}
      <div className="kpi-section">
        <div className="kpi-section-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
          <div>
            <span className="kpi-section-kicker">Tendencias</span>
            <h2 className="kpi-section-title">Evolución de Materiales</h2>
            <p className="kpi-section-subtitle">{evoSubtitle}</p>
          </div>
        </div>
        <div className="kpi-card kpi-materials-chart-card" style={{ padding: 24 }}>
          <div className="kpi-materials-chart-toolbar">
            <div className="kpi-materials-chart-controls">
            <div className="kpi-materials-evolution-filter">
              <FilterSelect
                icon={<Icons.Package />}
                value={evoMatKey}
                onChange={setEvoMatKey}
                label="Filtrar evolución por material"
                options={evolutionMaterialOptions}
                searchable
                isActive={evoMatKey !== ALL_KEY}
              />
            </div>
            <div className="kpi-materials-evolution-filter">
              <FilterSelect
                icon={<Icons.Calendar />}
                value={evoPeriod}
                onChange={setEvoPeriod}
                label="Comparar período de evolución"
                options={EVOLUTION_PERIOD_OPTIONS}
                isActive={evoPeriod !== 'month'}
              />
            </div>
            <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
              <button type="button" className={`kpi-pipeline-view-btn ${evoChartType === 'area' ? 'active' : ''}`} onClick={() => setEvoChartType('area')} aria-pressed={evoChartType === 'area'}><Icons.ChartArea size={14} />Área</button>
              <button type="button" className={`kpi-pipeline-view-btn ${evoChartType === 'line' ? 'active' : ''}`} onClick={() => setEvoChartType('line')} aria-pressed={evoChartType === 'line'}><Icons.ChartLine size={14} />Línea</button>
              <button type="button" className={`kpi-pipeline-view-btn ${evoChartType === 'bar' ? 'active' : ''}`} onClick={() => setEvoChartType('bar')} aria-pressed={evoChartType === 'bar'}><Icons.BarChart size={14} />Barras</button>
            </div>
            </div>
          </div>
          {(() => {
            const hasComp = evolution.hasComparison
            const compColor = '#94A3B8'

            if (isEvolutionLoading) {
              return <div style={{ height: 280, display: 'grid', placeItems: 'center', color: '#71809a', fontSize: 13 }} role="status">Actualizando tendencias…</div>
            }

            if (evolutionQuery.error) {
              return <div style={{ height: 280, display: 'grid', placeItems: 'center', color: '#71809a', fontSize: 13, textAlign: 'center' }} role="alert"><span>No fue posible actualizar las tendencias.</span><button type="button" className="kpi-ranking-retry" onClick={evolutionQuery.refresh}>Reintentar</button></div>
            }

            return (
              <>
                <div style={{ height: 280 }} key={`evo-mat-${evoMatKey}-${evoPeriod}-${evoChartType}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    {evoChartType === 'bar' ? (
                      <BarChart data={evolution.barData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#71809a' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Bar dataKey="value" name="Referencias" radius={[4, 4, 0, 0]}>
                          {evolution.barData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                        </Bar>
                      </BarChart>
                    ) : evoChartType === 'line' ? (
                      <LineChart data={evolution.trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" ticks={evolution.tickValues} tick={{ fontSize: 11, fill: '#71809a' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Line type="monotone" dataKey="Materiales" stroke={PALETTE.cyan} strokeWidth={2.5} dot={{ fill: PALETTE.cyan, r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                        {hasComp && <Line type="monotone" dataKey="Período anterior" stroke={compColor} strokeWidth={1.5} strokeDasharray="5 5" dot={{ fill: compColor, r: 2 }} activeDot={{ r: 4 }} connectNulls={false} />}
                      </LineChart>
                    ) : (
                      <AreaChart data={evolution.trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <defs>
                          <linearGradient id="gradMatEvo" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={PALETTE.cyan} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={PALETTE.cyan} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradMatEvoPrev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={compColor} stopOpacity={0.15} />
                            <stop offset="100%" stopColor={compColor} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" ticks={evolution.tickValues} tick={{ fontSize: 11, fill: '#71809a' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Area type="monotone" dataKey="Materiales" stroke={PALETTE.cyan} fill="url(#gradMatEvo)" strokeWidth={2} connectNulls={false} />
                        {hasComp && <Area type="monotone" dataKey="Período anterior" stroke={compColor} fill="url(#gradMatEvoPrev)" strokeWidth={1.5} connectNulls={false} />}
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>
                <div className="kpi-materials-chart-legend" style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.cyan }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>
                      {evoMatKey !== ALL_KEY && evoMatKey !== DISTINCT_KEY ? evolutionMaterialOptions.find(option => option.value === evoMatKey)?.label : evoMatKey === DISTINCT_KEY ? 'Materiales diferentes' : 'Todos los materiales'}
                    </span>
                  </div>
                  {hasComp && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 12, height: 3, borderRadius: 2, background: compColor }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>Período anterior</span>
                    </div>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      </div>

      <MaterialsComparisonPanel userId={userId} />

      {/* ─── RANKING SECTION ─── */}
      <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Ranking</span>
              <h2 className="kpi-section-title">Ranking de Materiales</h2>
            <p className="kpi-section-subtitle">{rankingPeriodSubtitle}</p>
            </div>
            <span className="kpi-section-fact-badge">{formatMaterialCount(filteredSummary.length)}</span>
        </div>

      {/* ─── RANKING ─── */}
        <div className="kpi-card kpi-materials-ranking-card kpi-materials-detail-card" style={{ padding: 24 }}>
          <div className="kpi-filter-row kpi-materials-ranking-filter-bar" style={{ marginBottom: 16 }}>
              <KPISearchBox
                value={materialSearch}
                onChange={value => {
                  setMaterialSearch(value)
                  if (selectedMaterialKey !== ALL_KEY && !filterKpiMaterials(rankingSummary, value).some(material => getMaterialKey(material) === selectedMaterialKey)) setSelectedMaterialKey(ALL_KEY)
                  setPage(0)
                  setTopClientsPage(0)
                }}
                onClear={() => {
                  setMaterialSearch('')
                  setPage(0)
                  setTopClientsPage(0)
                }}
                placeholder="Buscar material, cliente o uso..."
                resultCount={filteredSummary.length}
                totalCount={rankingSummary.length}
              />
              <div className="kpi-materials-filter-control">
                <span>Período</span>
                <FilterSelect
                  icon={<Icons.Calendar />}
                  value={rankingPeriod}
                  onChange={changeRankingPeriod}
                  label="Período del ranking"
                  options={RANKING_PERIOD_OPTIONS}
                />
              </div>
              <div className="kpi-materials-filter-control">
                <span>Material</span>
                <FilterSelect
                  icon={<Icons.Package />}
                  value={selectedMaterialKey}
                  onChange={value => { setSelectedMaterialKey(value); setPage(0); setTopClientsPage(0) }}
                  label="Filtrar ranking por material"
                  options={[
                    { value: ALL_KEY, label: 'Todos' },
                    ...filteredSummary.map(m => ({ value: getMaterialKey(m), label: m.name })),
                  ]}
                  searchable
                  isActive={selectedMaterialKey !== ALL_KEY}
                />
              </div>
            </div>

          <div className="kpi-materials-ranking-table" role="table" aria-label="Ranking de materiales">
            <div role="rowgroup">
              <div className="kpi-materials-ranking-table-head" role="row">
                <span role="columnheader">#</span><span role="columnheader">Material</span><span role="columnheader">Referencias</span><span role="columnheader">Órdenes</span><span role="columnheader">Participación</span><span role="columnheader">Uso por orden</span><span role="columnheader">Tendencia</span><span role="columnheader">Clientes</span>
              </div>
            </div>
          <div className="kpi-materials-ranking-list" role="rowgroup">
            {isRankingLoading ? (
              <div className="kpi-search-empty-hint">{rankingQuery.data === null ? 'Cargando ranking de materiales…' : 'Actualizando ranking de materiales…'}</div>
            ) : rankingQuery.error ? (
              <div className="kpi-search-empty-hint" role="alert">
                No fue posible actualizar el ranking de materiales.{' '}
                <button type="button" className="kpi-ranking-retry" onClick={rankingQuery.refresh}>Reintentar</button>
              </div>
            ) : detailPageData.length === 0 ? (
              <div className="kpi-search-empty-hint">{getMaterialEmptyText(materialSearch, rankingPeriod === 'general')}</div>
            ) : detailPageData.map((m, i) => {
              const rank = selectedMat ? 1 : safeRankingPage * PAGE_SIZE + i + 1
              const references = Number(m.reference_count ?? m.total_orders ?? 0)
              const pct = rankingTotal > 0 ? Math.round((references / rankingTotal) * 100) : 0
              const topClient = m.top_clients?.[0]
              const prevReferences = Number(rankingPrevSummary?.find(c => c.name === m.name)?.reference_count ?? rankingPrevSummary?.find(c => c.name === m.name)?.total_orders ?? 0)
              const trendPct = prevReferences > 0 ? Math.round(((references - prevReferences) / prevReferences) * 100) : (references > 0 ? 100 : 0)
              const trendUp = references > prevReferences
              const trendDown = references < prevReferences
              const materialKey = getMaterialKey(m)
              return (
                <article
                  className="kpi-materials-ranking-row is-interactive"
                  key={i}
                  role="row"
                  tabIndex={0}
                  aria-label={`Ver detalle de ${m.name}`}
                  onClick={() => setDetailMaterialKey(materialKey)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setDetailMaterialKey(materialKey)
                    }
                  }}
                >
                  <div className="kpi-materials-ranking-position" role="cell" aria-label={`Posición ${rank}`}>{rank}</div>
                  <div className="kpi-materials-ranking-copy" role="cell">
                    <button
                      type="button"
                      className="kpi-materials-ranking-material-button"
                      ref={node => { if (node) materialTriggerRefs.current.set(materialKey, node); else materialTriggerRefs.current.delete(materialKey) }}
                      onClick={() => setDetailMaterialKey(materialKey)}
                      aria-label={`Ver detalle de ${m.name}`}
                    >
                      <span className="kpi-materials-ranking-material-icon"><Icons.Package size={15} /></span>
                      <span><span className="kpi-materials-ranking-name">{m.name}</span>{topClient && <span className="kpi-materials-ranking-client">{topClient.client_name}</span>}</span>
                    </button>
                  </div>
                  <div className="kpi-materials-ranking-references" role="cell">{formatNumber(references)}</div>
                  <div className="kpi-materials-ranking-references" role="cell">{formatNumber(m.total_orders)}</div>
                  <div className="kpi-materials-ranking-participation" role="cell">
                    <strong>{pct}%</strong>
                    <div className="kpi-materials-ranking-progress" aria-label={`${pct}% de referencias`}><span style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className="kpi-materials-ranking-usage" role="cell" aria-label={`911 ${m.urgent_orders || 0}, normal ${m.normal_orders || 0}, diseño interno ${m.internal_design_orders || 0}, externo ${m.external_design_orders || 0}`}>
                    <span><span className="kpi-materials-ranking-usage-urgent">911 {formatNumber(m.urgent_orders || 0)}</span><span aria-hidden="true"> · </span><span className="kpi-materials-ranking-usage-normal">N {formatNumber(m.normal_orders || 0)}</span></span>
                    <small>Int {formatNumber(m.internal_design_orders || 0)} · Ext {formatNumber(m.external_design_orders || 0)}</small>
                  </div>
                  {hasRankingComparison && (
                    <div className={`kpi-materials-ranking-trend ${trendUp ? 'is-up' : trendDown ? 'is-down' : 'is-flat'}`} role="cell">
                      <span>{trendUp ? '↑' : trendDown ? '↓' : '—'}</span>
                      <strong>{trendUp ? `+${trendPct}%` : trendDown ? `${trendPct}%` : 'Sin cambio'}</strong>
                    </div>
                  )}
                  {!hasRankingComparison && <span className="kpi-materials-ranking-trend is-flat" role="cell">—</span>}
                  <div className="kpi-materials-ranking-clients" role="cell"><Icons.User size={13} /><strong>{m.top_clients?.length || 0}</strong></div>
                </article>
              )
            })}
          </div>
          </div>

          {!selectedMat && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <SystemPagination currentPage={safeRankingPage + 1} totalPages={rankingTotalPages} onPageChange={nextPage => setPage(nextPage - 1)} />
            </div>
          )}
        </div>

      {/* ─── TOP CLIENTS BY MATERIAL ─── */}
      {selectedMat && selectedMat.top_clients?.length > 0 && (() => {
        const TOP_PAGE_SIZE = 7
        const topClientsTotal = selectedMat.top_clients.length
        const topClientsPaged = selectedMat.top_clients.slice(topClientsPage * TOP_PAGE_SIZE, (topClientsPage + 1) * TOP_PAGE_SIZE)
        return (
          <div className="kpi-card kpi-materials-clients-card" style={{ padding: 24, marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="kpi-card-title" style={{ marginBottom: 0 }}>
                Clientes con más órdenes que registran <strong style={{ color: '#091127' }}>{selectedMat.name}</strong> · {topClientsTotal} clientes
              </div>
              {topClientsTotal > TOP_PAGE_SIZE && (
                <CompactPagination page={topClientsPage} total={topClientsTotal} pageSize={TOP_PAGE_SIZE} onPage={setTopClientsPage} />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topClientsPaged.map((c, i) => {
                const globalRank = topClientsPage * TOP_PAGE_SIZE + i + 1
                const maxCount = selectedMat.top_clients[0]?.count || 1
                const pct = Math.round((c.count / maxCount) * 100)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', width: 20, textAlign: 'center', flexShrink: 0 }}>{globalRank}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{c.client_name}</div>
                      <div style={{ marginTop: 4, height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[(globalRank - 1) % PALETTE.pie.length], borderRadius: 2 }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#091127', flexShrink: 0 }}>{c.count}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
      <MaterialDetailModal
        material={detailMaterial}
        previousMaterial={detailPreviousMaterial}
        totalReferences={rankingTotal}
        userId={userId}
        periodMeta={rankingAnalytics?.meta || materialMeta}
        onClose={() => {
          const materialKey = detailMaterialKey
          setDetailMaterialKey(null)
          const scheduleFocus = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0))
          scheduleFocus(() => materialTriggerRefs.current.get(materialKey)?.focus())
        }}
      />
      </div>
    </div>
  )
}
