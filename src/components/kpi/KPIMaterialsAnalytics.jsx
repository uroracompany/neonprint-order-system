import { useState, useDeferredValue, useMemo, useRef } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, AreaChart, Area,
} from 'recharts'
import { formatNumber, getTrendConfig, KPI_CHART_COLORS } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'
import KPISearchBox from './KPISearchBox'
import { matchesKpiSearch } from '../../utils/kpiSearch'
import { FilterSelect } from '../ui/FilterSelect'
import MaterialDetailModal from './MaterialDetailModal'
import MaterialsComparisonPanel from './MaterialsComparisonPanel'

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

const getPeriodFallbackStart = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

const formatRangeDay = (value, timeZone, inclusiveEnd = false) => {
  const date = new Date(value)
  if (inclusiveEnd) date.setUTCDate(date.getUTCDate() - 1)
  return new Intl.DateTimeFormat('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timeZone || 'America/Asuncion',
  }).format(date)
}

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
const getMaterialEmptyText = (query) => (
  query
    ? `No encontramos resultados para "${query}". Prueba con cliente, factura, material, orden o estado.`
    : 'No hay datos disponibles para este periodo.'
)

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

function Pagination({ page, total, pageSize, onPage }) {
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
  const [detailTab, setDetailTab] = useState('ranking')
  const [compPage, setCompPage] = useState(0)
  const [evoMatKey, setEvoMatKey] = useState(ALL_KEY)
  const evoMonths = 1
  const evoCustom = false
  const [evoChartType, setEvoChartType] = useState('area')
  const [topClientsPage, setTopClientsPage] = useState(0)
  const [detailMaterialKey, setDetailMaterialKey] = useState(null)
  const materialTriggerRefs = useRef(new Map())

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
  const comparisonBounds = useMemo(() => ({
    date_from: materialMeta.date_from || getPeriodFallbackStart(),
    date_to: materialMeta.date_to || new Date().toISOString(),
    compare_from: materialMeta.compare_from || materialMeta.date_from || getPeriodFallbackStart(),
    compare_to: materialMeta.compare_to || materialMeta.date_from || getPeriodFallbackStart(),
  }), [materialMeta.compare_from, materialMeta.compare_to, materialMeta.date_from, materialMeta.date_to])

  const filteredSummary = useMemo(() =>
    filterKpiMaterials(summary, deferredMaterialSearch),
    [summary, deferredMaterialSearch]
  )

  const totalCurrent = hasVerifiedContract
    ? Number(periodMetrics.material_references || 0)
    : summary.reduce((s, m) => s + m.total_orders, 0)
  const totalOrdersWithMaterial = hasVerifiedContract
    ? Number(periodMetrics.orders_with_material || 0)
    : totalCurrent
  const totalComparison = hasVerifiedContract
    ? Number(materialComparison?.material_references || 0)
    : (materialComparison?.period_total || 0)
  const topMaterial = summary[0] || null
  const cancelledAuditable = hasVerifiedContract ? Number(periodMetrics.cancelled_orders || 0) : null
  const cancelledAuditablePrevious = hasVerifiedContract ? Number(materialComparison?.cancelled_orders || 0) : null

  const trendCurrent = getTrendConfig(totalCurrent, totalComparison)
  const trendCancellations = cancelledAuditable === null ? null : getTrendConfig(cancelledAuditable, cancelledAuditablePrevious)

  const evoData = useMemo(() => {
    const nowDate = new Date()
    // La serie solo representa el rango realmente consultado por el KPI global.
    // No se permiten fechas locales que no hayan sido solicitadas al servidor.
    const rangeFrom = materialMeta.date_from || getPeriodFallbackStart()
    const rangeTo = materialMeta.date_to || new Date().toISOString()
    const dateFrom = new Date(rangeFrom)
    const dateTo = new Date(new Date(rangeTo).getTime() - 1)
    const totalDays = Math.max(1, Math.round((dateTo - dateFrom) / (1000 * 60 * 60 * 24)) + 1)
    const useCustom = true

    const isDaily = useCustom ? totalDays <= 31 : evoMonths === 1
    const isWeekly = useCustom ? totalDays > 31 && totalDays <= 120 : evoMonths === 3

    const selectedMat = evoMatKey !== ALL_KEY && evoMatKey !== DISTINCT_KEY ? findKpiMaterialByKey(summary, evoMatKey) : null
    const showDistinct = evoMatKey === DISTINCT_KEY
    const hasComp = !!(materialComparison?.summary?.length)
    const materialSource = summary

    const findCompMat = (name) => materialComparison?.summary?.find(m => m.name === name) || null
    const aggCompDaily = () => {
      const r = {}
      materialComparison?.summary?.forEach(m => {
        Object.entries(m.daily || {}).forEach(([day, count]) => { r[day] = (r[day] || 0) + count })
      })
      return r
    }

    const sumDaily = (matArr, dates) => {
      const acc = {}
      dates.forEach(d => { acc[d] = 0 })
      matArr.forEach(m => {
        dates.forEach(d => { acc[d] += m.daily?.[d] || 0 })
      })
      return acc
    }

    const distinctDaily = (matArr, dates) => {
      const acc = {}
      dates.forEach(d => { acc[d] = matArr.filter(m => (m.daily?.[d] || 0) > 0).length })
      return acc
    }

    if (isDaily) {
      const periodLen = useCustom ? totalDays : 30
      const currentDates = []
      if (useCustom) {
        for (let i = 0; i < totalDays; i++) {
          const d = new Date(dateFrom)
          d.setDate(d.getDate() + i)
          currentDates.push(d.toISOString().slice(0, 10))
        }
      } else {
        for (let i = 29; i >= 0; i--) {
          const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - i)
          currentDates.push(d.toISOString().slice(0, 10))
        }
      }
      const prevDates = currentDates.map(d => {
        const dt = new Date(d + 'T12:00:00')
        dt.setDate(dt.getDate() - periodLen)
        return dt.toISOString().slice(0, 10)
      })

      let currentDaily, prevDaily
      if (showDistinct) {
        currentDaily = distinctDaily(materialSource, currentDates)
        prevDaily = hasComp ? distinctDaily(materialComparison.summary, prevDates) : {}
      } else if (selectedMat) {
        currentDaily = selectedMat.daily || {}
        prevDaily = hasComp ? (findCompMat(selectedMat.name)?.daily || {}) : {}
      } else {
        currentDaily = sumDaily(materialSource, currentDates)
        prevDaily = hasComp ? aggCompDaily() : {}
      }

      return currentDates.map((d, i) => ({
        name: `Día ${i + 1}`,
        Materiales: currentDaily[d] || 0,
        ...(hasComp ? { 'Período anterior': prevDaily[prevDates[i]] || 0 } : {}),
      }))
    }

    if (isWeekly) {
      const periodLen = useCustom ? totalDays : 91
      const weekStarts = []
      if (useCustom) {
        let cursor = new Date(dateFrom)
        cursor.setDate(cursor.getDate() - cursor.getDay())
        while (cursor <= dateTo) {
          weekStarts.push(new Date(cursor))
          cursor.setDate(cursor.getDate() + 7)
        }
      } else {
        for (let i = 12; i >= 0; i--) {
          const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - (i * 7))
          const weekStart = new Date(d)
          weekStart.setDate(d.getDate() - d.getDay())
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

      const prevDayLabels = dayLabels.map(d => {
        const dt = new Date(d + 'T12:00:00')
        dt.setDate(dt.getDate() - periodLen)
        return dt.toISOString().slice(0, 10)
      })

      const sumWeekDaily = (matArr, wkStart, wkDayLabels) => {
        const we = new Date(wkStart)
        we.setDate(we.getDate() + 7)
        const weStr = we.toISOString().slice(0, 10)
        const wsStr = wkStart.toISOString().slice(0, 10)
        const weekDays = wkDayLabels.filter(day => day >= wsStr && day < weStr)
        return weekDays.reduce((s, d) => s + matArr.reduce((sm, m) => sm + (m.daily?.[d] || 0), 0), 0)
      }

      const weekDistinct = (matArr, wkStart, wkDayLabels) => {
        const we = new Date(wkStart)
        we.setDate(we.getDate() + 7)
        const weStr = we.toISOString().slice(0, 10)
        const wsStr = wkStart.toISOString().slice(0, 10)
        const weekDays = wkDayLabels.filter(day => day >= wsStr && day < weStr)
        return matArr.filter(m => weekDays.some(d => (m.daily?.[d] || 0) > 0)).length
      }

      const currentMats = selectedMat ? [selectedMat] : materialSource
      const prevMats = hasComp
        ? (selectedMat
            ? [findCompMat(selectedMat.name)].filter(Boolean)
            : materialComparison.summary)
        : []

      return weekStarts.map((ws, wi) => {
        const currCount = showDistinct
          ? weekDistinct(currentMats, ws, dayLabels)
          : sumWeekDaily(currentMats, ws, dayLabels)
        const prevCount = hasComp
          ? (showDistinct
              ? weekDistinct(prevMats, ws, prevDayLabels)
              : sumWeekDaily(prevMats, ws, prevDayLabels))
          : 0
        return {
          name: `Sem ${wi + 1}`,
          Materiales: currCount,
          ...(hasComp ? { 'Período anterior': prevCount } : {}),
        }
      })
    }

    // Monthly
    const monthLabels = []
    if (useCustom) {
      const cursor = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1)
      while (cursor <= dateTo) {
        monthLabels.push(cursor.toISOString().slice(0, 7))
        cursor.setMonth(cursor.getMonth() + 1)
      }
    } else {
      for (let i = evoMonths - 1; i >= 0; i--) {
        const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)
        monthLabels.push(d.toISOString().slice(0, 7))
      }
    }
    const prevMonthLabels = monthLabels.map(m => {
      const d = new Date(m + '-01')
      d.setMonth(d.getMonth() - (useCustom ? monthLabels.length : evoMonths))
      return d.toISOString().slice(0, 7)
    })

    const buildMonthMap = (matArr) => {
      const r = {}
      matArr.forEach(m => {
        (m.monthly_trend || []).forEach(t => { r[t.month] = (r[t.month] || 0) + t.count })
      })
      return r
    }

    const monthDistinct = (matArr, monthKey) => {
      return matArr.filter(m => (m.monthly_trend || []).some(t => t.month === monthKey)).length
    }

    if (showDistinct) {
      const currMats = materialSource
      const prevMats = hasComp ? materialComparison.summary : []
      return monthLabels.map((m, i) => ({
        name: `Mes ${i + 1}`,
        Materiales: monthDistinct(currMats, m),
        ...(hasComp ? { 'Período anterior': monthDistinct(prevMats, prevMonthLabels[i]) } : {}),
      }))
    }

    const currentMap = selectedMat ? buildMonthMap([selectedMat]) : buildMonthMap(materialSource)
    const prevMap = hasComp
      ? (selectedMat
          ? buildMonthMap([findCompMat(selectedMat.name)].filter(Boolean))
          : buildMonthMap(materialComparison.summary))
      : {}

    return monthLabels.map((m, i) => ({
      name: `Mes ${i + 1}`,
      Materiales: currentMap[m] || 0,
      ...(hasComp ? { 'Período anterior': prevMap[prevMonthLabels[i]] || 0 } : {}),
    }))
  }, [evoMatKey, evoMonths, summary, materialComparison, materialMeta.date_from, materialMeta.date_to])

  const evoSubtitle = useMemo(() => {
    const selectedMat = evoMatKey !== ALL_KEY && evoMatKey !== DISTINCT_KEY ? findKpiMaterialByKey(summary, evoMatKey) : null
    const showDistinct = evoMatKey === DISTINCT_KEY
    const rangeFrom = materialMeta.date_from || getPeriodFallbackStart()
    const rangeTo = materialMeta.date_to || new Date().toISOString()
    const displayDateFrom = formatRangeDay(rangeFrom, materialMeta.timezone)
    const displayDateTo = formatRangeDay(rangeTo, materialMeta.timezone, true)
    const useCustom = true
    const hasComp = !!(materialComparison?.summary?.length)
    const compSuffix = hasComp ? ' vs período anterior' : ''
    if (showDistinct) {
      return useCustom
        ? `Referencias de materiales diferentes del ${displayDateFrom} al ${displayDateTo}${compSuffix}.`
        : `Materiales diferentes utilizados en los últimos ${evoMonths} mes${evoMonths > 1 ? 'es' : ''}${compSuffix}.`
    }
    if (selectedMat) {
      return useCustom
        ? `Referencias de ${selectedMat.name} del ${displayDateFrom} al ${displayDateTo}${compSuffix}.`
        : `Uso de ${selectedMat.name} en los últimos ${evoMonths} mes${evoMonths > 1 ? 'es' : ''}${compSuffix}.`
    }
    return useCustom
      ? `Referencias de materiales del ${displayDateFrom} al ${displayDateTo}${compSuffix}.`
      : `Total de materiales utilizados en los últimos ${evoMonths} mes${evoMonths > 1 ? 'es' : ''}${compSuffix}.`
  }, [evoMatKey, summary, evoMonths, materialComparison, materialMeta.date_from, materialMeta.date_to, materialMeta.timezone])

  const starMaterials = useMemo(() =>
    summary.filter(m => m.total_orders >= 1)
      .sort((a, b) => b.total_orders - a.total_orders)
      .slice(0, 5),
    [summary]
  )

  const highCancelMaterials = useMemo(() =>
    (periodMetrics.cancellation_by_material || EMPTY_ARRAY)
      .filter(m => Number(m.cancelled_orders) > 0)
      .sort((a, b) => Number(b.cancelled_orders) - Number(a.cancelled_orders))
      .slice(0, 5),
    [periodMetrics.cancellation_by_material]
  )

  const heatmapData = useMemo(() => {
    const monthSet = new Set()
    const matMonthMap = {}
    summary.forEach(m => {
      matMonthMap[m.name] = {}
      ;(m.monthly_trend || []).forEach(t => {
        monthSet.add(t.month)
        matMonthMap[m.name][t.month] = t.count
      })
    })
    const months = [...monthSet].sort()
    const topMats = summary.slice(0, 6)
    return { months, materials: topMats, map: matMonthMap }
  }, [summary])

  if (!data) return null

  const selectedMat = selectedMaterialKey !== ALL_KEY ? findKpiMaterialByKey(filteredSummary, selectedMaterialKey) : null
  const detailMaterial = detailMaterialKey ? findKpiMaterialByKey(summary, detailMaterialKey) : null
  const detailPreviousMaterial = detailMaterial
    ? materialComparison?.summary?.find(item => item.name === detailMaterial.name) || null
    : null
  const detailPageData = selectedMat
    ? [selectedMat]
    : filteredSummary.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="kpi-section kpi-materials-analytics">
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
                options={[
                  { value: ALL_KEY, label: 'Todos' },
                  { value: DISTINCT_KEY, label: 'Materiales diferentes' },
                  ...summary.map((m, i) => ({ value: getMaterialKey(m), label: m.name, key: i })),
                ]}
                searchable
                isActive={evoMatKey !== ALL_KEY}
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
            const hasComp = !!(materialComparison?.summary?.length)
            const compColor = '#94A3B8'
            return (
              <>
                <div style={{ height: 280 }} key={`evo-mat-${evoMatKey}-${evoMonths}-${evoCustom}-${evoChartType}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    {evoChartType === 'bar' ? (
                      <BarChart data={evoData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Bar dataKey="Materiales" fill={PALETTE.cyan} radius={[4, 4, 0, 0]} />
                        {hasComp && <Bar dataKey="Período anterior" fill={compColor} radius={[4, 4, 0, 0]} fillOpacity={0.6} />}
                      </BarChart>
                    ) : evoChartType === 'line' ? (
                      <LineChart data={evoData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Line type="monotone" dataKey="Materiales" stroke={PALETTE.cyan} strokeWidth={2.5} dot={{ fill: PALETTE.cyan, r: 3 }} activeDot={{ r: 5 }} />
                        {hasComp && <Line type="monotone" dataKey="Período anterior" stroke={compColor} strokeWidth={1.5} strokeDasharray="5 5" dot={{ fill: compColor, r: 2 }} activeDot={{ r: 4 }} />}
                      </LineChart>
                    ) : (
                      <AreaChart data={evoData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Area type="monotone" dataKey="Materiales" stroke={PALETTE.cyan} fill="url(#gradMatEvo)" strokeWidth={2} />
                        {hasComp && <Area type="monotone" dataKey="Período anterior" stroke={compColor} fill="url(#gradMatEvoPrev)" strokeWidth={1.5} />}
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>
                <div className="kpi-materials-chart-legend" style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.cyan }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>
                      {evoMatKey !== ALL_KEY && evoMatKey !== DISTINCT_KEY ? findKpiMaterialByKey(summary, evoMatKey)?.name : evoMatKey === DISTINCT_KEY ? 'Materiales diferentes' : 'Todos los materiales'}
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

      <MaterialsComparisonPanel
        globalBounds={comparisonBounds}
        fallbackAnalytics={materialAnalytics}
        userId={userId}
      />

      {/* Legacy visual kept out of render while the new comparison workspace is active. */}
      {false && materialComparison && (() => {
        const currBounds = {
          dateFrom: materialMeta.date_from || getPeriodFallbackStart(),
          dateTo: materialMeta.date_to || new Date().toISOString(),
        }
        const prevBounds = {
          dateFrom: materialMeta.compare_from || currBounds.dateFrom,
          dateTo: materialMeta.compare_to || currBounds.dateFrom,
        }
        const fmtDate = (d) => new Date(d).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
        const fmtInclusiveEnd = (d) => fmtDate(new Date(new Date(d).getTime() - 1))
        const currDays = Math.round((new Date(currBounds.dateTo) - new Date(currBounds.dateFrom)) / 86400000)
        const prevDays = Math.round((new Date(prevBounds.dateTo) - new Date(prevBounds.dateFrom)) / 86400000)
        return (
        <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Comparación</span>
              <h2 className="kpi-section-title">Comparación con Período Anterior</h2>
              <p className="kpi-section-subtitle">Compara las referencias registradas durante el período seleccionado con el período anterior de igual duración.</p>
            </div>
          </div>
          <div className="kpi-card kpi-materials-comparison-card" style={{ padding: 24 }}>
            {/* ── Hero: dos períodos lado a lado ── */}
            {(() => {
              const prevMats = new Set((materialComparison.summary || []).map(m => m.name))
              const currMats = new Set(summary.map(m => m.name))
              const kept = [...prevMats].filter(m => currMats.has(m))
              const newMats = [...currMats].filter(m => !prevMats.has(m))
              const lost = [...prevMats].filter(m => !currMats.has(m))
              const referencesCurrent = Number(totalCurrent || 0)
              const referencesPrevious = Number(totalComparison || 0)
              const referencesDifference = referencesCurrent - referencesPrevious
              const hasPreviousBaseline = referencesPrevious > 0
              const variation = hasPreviousBaseline
                ? Math.round((referencesDifference / referencesPrevious) * 100)
                : (referencesCurrent === 0 ? 0 : null)
              const isUp = referencesDifference > 0
              const isDown = referencesDifference < 0
              const referenceLabel = count => `${formatNumber(count)} referencia${Number(count) === 1 ? '' : 's'}`
              const differenceLabel = referencesDifference === 0
                ? 'Sin diferencia'
                : `${isUp ? '+' : '−'}${referenceLabel(Math.abs(referencesDifference))}`
              const variationLabel = variation === null
                ? 'Sin base anterior'
                : `${variation > 0 ? '+' : ''}${variation}% de variación`
              return (
                <>
                  <div className="kpi-materials-period-comparison">
                    <article className="kpi-materials-period-card is-previous">
                      <div className="kpi-materials-period-card-heading"><span className="kpi-materials-period-icon"><Icons.Calendar size={16} /></span><span>Período anterior</span></div>
                      <strong>{formatNumber(referencesPrevious)}</strong>
                      <span className="kpi-materials-period-metric">Referencias registradas</span>
                      <span className="kpi-materials-period-duration">{prevDays} días</span>
                      <span className="kpi-materials-period-date">{fmtDate(prevBounds.dateFrom)} - {fmtInclusiveEnd(prevBounds.dateTo)}</span>
                    </article>
                    <div className={`kpi-materials-period-change ${isUp ? 'is-up' : isDown ? 'is-down' : 'is-flat'}`} aria-label={`${isUp ? 'Aumento' : isDown ? 'Disminución' : 'Sin variación'}: ${differenceLabel}; ${variationLabel}`}>
                      <span className="kpi-materials-period-change-icon">{isUp ? '↑' : isDown ? '↓' : '→'}</span>
                      <strong>{differenceLabel}</strong>
                      <span>{variationLabel}</span>
                    </div>
                    <article className="kpi-materials-period-card is-current">
                      <div className="kpi-materials-period-card-heading"><span className="kpi-materials-period-icon"><Icons.Package size={16} /></span><span>Período seleccionado</span></div>
                      <strong>{formatNumber(referencesCurrent)}</strong>
                      <span className="kpi-materials-period-metric">Referencias registradas</span>
                      <span className="kpi-materials-period-duration">{currDays} días</span>
                      <span className="kpi-materials-period-date">{fmtDate(currBounds.dateFrom)} - {fmtInclusiveEnd(currBounds.dateTo)}</span>
                    </article>
                  </div>

                  {/* ── Cards de movimiento ── */}
                  <div className="kpi-materials-movement-heading">
                    <span>Cambios en materiales</span>
                    <small>Desglose de materiales entre ambos períodos</small>
                  </div>
                  <div className="kpi-materials-movement-grid">
                    <article className="kpi-materials-movement-card is-kept">
                      <span className="kpi-materials-movement-icon"><Icons.CheckCircle size={16} /></span>
                      <div><strong>{kept.length}</strong><span>Mantenidos</span><p>Presentes en ambos períodos</p></div>
                    </article>
                    <article className="kpi-materials-movement-card is-new">
                      <span className="kpi-materials-movement-icon"><Icons.Plus size={16} /></span>
                      <div><strong>{newMats.length}</strong><span>Solo en período seleccionado</span><p>{newMats.length > 0 ? newMats.join(', ') : 'Sin materiales nuevos'}</p></div>
                    </article>
                    <article className="kpi-materials-movement-card is-lost">
                      <span className="kpi-materials-movement-icon"><Icons.ArrowLeft size={16} /></span>
                      <div><strong>{lost.length}</strong><span>Solo en período anterior</span><p>{lost.length > 0 ? lost.join(', ') : 'Sin materiales retirados'}</p></div>
                    </article>
                  </div>

                  {/* ── Tabla simplificada ── */}
                  {materialComparison.summary?.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Detalle por material</div>
                        <Pagination page={compPage} total={materialComparison.summary.length} pageSize={7} onPage={setCompPage} />
                      </div>
                      <div className="kpi-materials-comparison-table" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="kpi-materials-comparison-table-head" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 8, padding: '6px 12px', fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          <div>Material</div>
                          <div style={{ textAlign: 'center' }}>Anterior</div>
                          <div style={{ textAlign: 'center' }}>Actual</div>
                          <div style={{ textAlign: 'center' }}>Tendencia</div>
                        </div>
                        {materialComparison.summary.slice(compPage * 7, (compPage + 1) * 7).map((m, i) => {
                          const curr = summary.find(s => s.name === m.name)
                          const currTotal = curr?.total_orders || 0
                          const diff = currTotal - m.total_orders
                          const pct = m.total_orders > 0 ? Math.round(((currTotal - m.total_orders) / m.total_orders) * 100) : (currTotal > 0 ? 100 : 0)
                          const isGone = m.total_orders > 0 && currTotal === 0
                          const isNew = m.total_orders === 0 && currTotal > 0
                          return (
                            <div className="kpi-materials-comparison-row" key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', alignItems: 'center' }}>
                              <div style={{ fontWeight: 600, color: '#091127', fontSize: 13 }}>{m.name}</div>
                              <div style={{ textAlign: 'center', fontSize: 13, color: '#64748b' }}>{formatNumber(m.total_orders)}</div>
                              <div style={{ textAlign: 'center', fontSize: 13, color: '#091127', fontWeight: 600 }}>{formatNumber(currTotal)}</div>
                              <div style={{ textAlign: 'center' }}>
                                {isGone ? (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', padding: '3px 10px', borderRadius: 12 }}>Solo anterior</span>
                                ) : isNew ? (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#16A34A', background: '#DCFCE7', padding: '3px 10px', borderRadius: 12 }}>Solo actual</span>
                                ) : diff > 0 ? (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#16A34A', background: '#DCFCE7', padding: '3px 10px', borderRadius: 12 }}>↑ {pct}%</span>
                                ) : diff < 0 ? (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', padding: '3px 10px', borderRadius: 12 }}>↓ {pct}%</span>
                                ) : (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#64748b', background: '#F1F5F9', padding: '3px 10px', borderRadius: 12 }}>=</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                 </>
               )
             })()}
           </div>
         </div>
         )
       })()}

      {/* ─── RANKING SECTION ─── */}
      <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Ranking</span>
              <h2 className="kpi-section-title">Ranking de Materiales</h2>
            <p className="kpi-section-subtitle">Materiales con mayor número de referencias durante el período seleccionado.</p>
            </div>
            <span className="kpi-section-fact-badge">{formatMaterialCount(filteredSummary.length)}</span>
        </div>

        {/* ─── TABS: RANKING / HEATMAP / ALERTAS ─── */}
        <div className="kpi-pipeline-view-toggle kpi-materials-detail-tabs" style={{ marginBottom: 16 }}>
          {[['ranking', 'Ranking de Materiales'], ['heatmap', 'Heatmap'], ['alerts', 'Alertas']].map(([key, label]) => (
            <button key={key} onClick={() => setDetailTab(key)}
              className={`kpi-pipeline-view-btn ${detailTab === key ? 'active' : ''}`}>
              {label}
            </button>
          ))}
        </div>

      {/* ─── RANKING TAB ─── */}
      {detailTab === 'ranking' && (
        <div className="kpi-card kpi-materials-ranking-card kpi-materials-detail-card" style={{ padding: 24 }}>
          <div className="kpi-filter-row kpi-materials-ranking-filter-bar" style={{ marginBottom: 16 }}>
              <KPISearchBox
                value={materialSearch}
                onChange={value => {
                  setMaterialSearch(value)
                  if (selectedMaterialKey !== ALL_KEY && !filterKpiMaterials(summary, value).some(material => getMaterialKey(material) === selectedMaterialKey)) setSelectedMaterialKey(ALL_KEY)
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
                totalCount={summary.length}
              />
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
            <div className="kpi-materials-ranking-table-head" role="row">
              <span>#</span><span>Material</span><span>Referencias</span><span>Órdenes</span><span>Participación</span><span>Uso por orden</span><span>Tendencia</span><span>Clientes</span>
            </div>
          <div className="kpi-materials-ranking-list" role="rowgroup">
            {detailPageData.length === 0 ? (
              <div className="kpi-search-empty-hint">{getMaterialEmptyText(materialSearch)}</div>
            ) : detailPageData.map((m, i) => {
              const rank = selectedMat ? 1 : page * PAGE_SIZE + i + 1
              const references = Number(m.reference_count ?? m.total_orders ?? 0)
              const pct = totalCurrent > 0 ? Math.round((references / totalCurrent) * 100) : 0
              const topClient = m.top_clients?.[0]
              const prevReferences = Number(materialComparison?.summary?.find(c => c.name === m.name)?.reference_count ?? materialComparison?.summary?.find(c => c.name === m.name)?.total_orders ?? 0)
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
                    <span>911 {formatNumber(m.urgent_orders || 0)} · N {formatNumber(m.normal_orders || 0)}</span>
                    <small>Int {formatNumber(m.internal_design_orders || 0)} · Ext {formatNumber(m.external_design_orders || 0)}</small>
                  </div>
                  {materialComparison?.summary && (
                    <div className={`kpi-materials-ranking-trend ${trendUp ? 'is-up' : trendDown ? 'is-down' : 'is-flat'}`} role="cell">
                      <span>{trendUp ? '↑' : trendDown ? '↓' : '—'}</span>
                      <strong>{trendUp ? `+${trendPct}%` : trendDown ? `${trendPct}%` : 'Sin cambio'}</strong>
                    </div>
                  )}
                  {!materialComparison?.summary && <span className="kpi-materials-ranking-trend is-flat" role="cell">—</span>}
                  <div className="kpi-materials-ranking-clients" role="cell"><Icons.User size={13} /><strong>{m.top_clients?.length || 0}</strong></div>
                </article>
              )
            })}
          </div>
          </div>

          {!selectedMat && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Pagination page={page} total={filteredSummary.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </div>
          )}
        </div>
      )}

      {/* ─── HEATMAP TAB ─── */}
      {detailTab === 'heatmap' && (
        <div className="kpi-card kpi-materials-heatmap-card kpi-materials-detail-card" style={{ padding: 24 }}>
          <div className="kpi-materials-panel-heading">
            <div>
              <span className="kpi-materials-panel-kicker">Actividad mensual</span>
              <div className="kpi-card-title"><Icons.ChartArea size={17} /> Heatmap: referencias por material</div>
            </div>
            <span className="kpi-materials-panel-meta">Top {Math.min(6, heatmapData.materials.length)}</span>
          </div>
          {heatmapData.months.length > 0 ? (
            <div className="kpi-table-wrapper" style={{ marginTop: 12 }}>
              <table className="kpi-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', position: 'sticky', left: 0, zIndex: 1 }}>Material</th>
                    {heatmapData.months.map(m => (
                      <th key={m} style={{ textAlign: 'center', minWidth: 70 }}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.materials.map((mat, mi) => {
                    const maxVal = Math.max(...heatmapData.months.map(mo => heatmapData.map[mat.name]?.[mo] || 0), 1)
                    return (
                      <tr key={mi}>
                        <td style={{ fontWeight: 600, position: 'sticky', left: 0, zIndex: 1, whiteSpace: 'nowrap' }}>{mat.name}</td>
                        {heatmapData.months.map((mo, moi) => {
                          const val = heatmapData.map[mat.name]?.[mo] || 0
                          const intensity = val / maxVal
                          const bg = val === 0 ? '#F8FAFC' : `rgba(36, 84, 217, ${0.1 + intensity * 0.8})`
                          const textColor = intensity > 0.5 ? '#fff' : '#091127'
                          return (
                            <td key={moi} style={{ textAlign: 'center', background: bg, color: textColor, fontWeight: val > 0 ? 700 : 400, borderRadius: 4 }}>
                              {val > 0 ? val : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de tendencia mensual disponibles</div></div>
          )}
        </div>
      )}

      {/* ─── ALERTS TAB ─── */}
      {detailTab === 'alerts' && (
        <div className="kpi-materials-alerts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="kpi-card kpi-materials-alert-card kpi-materials-detail-card" style={{ padding: 24 }}>
            <div className="kpi-materials-panel-heading">
              <div>
                <span className="kpi-materials-panel-kicker">Uso destacado</span>
                <div className="kpi-card-title"><Icons.Package size={16} color={PALETTE.amber} /> Materiales más referenciados</div>
              </div>
              <span className="kpi-materials-panel-meta is-positive">{starMaterials.length}</span>
            </div>
            {starMaterials.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {starMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                    <Icons.CheckCircle size={16} color="#16A34A" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#047857' }}>{formatNumber(m.total_orders)} órdenes que lo registran · {formatNumber(m.reference_count || m.total_orders)} referencias</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PALETTE.green, background: '#D1FAE5', padding: '2px 8px', borderRadius: 20 }}>Mayor uso</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">No hay referencias de materiales en el período</div></div>
            )}
          </div>

          <div className="kpi-card kpi-materials-alert-card kpi-materials-detail-card" style={{ padding: 24 }}>
            <div className="kpi-materials-panel-heading">
              <div>
                <span className="kpi-materials-panel-kicker">Seguimiento</span>
                <div className="kpi-card-title"><Icons.AlertCircle size={16} color={PALETTE.rose} /> Cancelaciones auditables por material</div>
              </div>
              <span className="kpi-materials-panel-meta is-negative">{highCancelMaterials.length}</span>
            </div>
            {highCancelMaterials.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {highCancelMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <Icons.AlertCircle size={16} color="#DC2626" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#B91C1C' }}><strong>{formatNumber(m.cancelled_orders)}</strong> transición{Number(m.cancelled_orders) === 1 ? '' : 'es'} a cancelada en el período</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PALETTE.rose, background: '#FEE2E2', padding: '2px 8px', borderRadius: 20 }}>Revisar</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">No hay cancelaciones auditables por material</div></div>
            )}
          </div>
        </div>
      )}

      {/* ─── TOP CLIENTS BY MATERIAL (below tabs) ─── */}
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
                <Pagination page={topClientsPage} total={topClientsTotal} pageSize={TOP_PAGE_SIZE} onPage={setTopClientsPage} />
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
        totalReferences={totalCurrent}
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
