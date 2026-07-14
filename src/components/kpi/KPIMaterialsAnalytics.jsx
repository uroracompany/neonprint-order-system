import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area,
} from 'recharts'
import { formatNumber, getTrendConfig, KPI_CHART_COLORS, getPeriodBounds, getComparePeriodBounds } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'

const PALETTE = {
  cyan: '#06B6D4', green: '#10B981', rose: '#F43F5E', amber: '#F59E0B',
  violet: '#8B5CF6', orange: '#F97316', pink: '#EC4899', teal: '#14B8A6',
  indigo: '#6366F1', red: '#EF4444',
  pie: KPI_CHART_COLORS,
}

const PAGE_SIZE = 7

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
}

function MiniCard({ label, value, sub, icon, sem, trend }) {
  return (
    <div className="kpi-hero-card">
      <div className="kpi-hero-header">
        <div className="kpi-hero-label">{label}</div>
        <div className="kpi-hero-icon" style={{ background: sem?.iconBg, color: sem?.iconColor }}>{icon}</div>
      </div>
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

export default function KPIMaterialsAnalytics({ data }) {
  const [selectedMaterial, setSelectedMaterial] = useState(-1)
  const [materialSearch, setMaterialSearch] = useState('')
  const [page, setPage] = useState(0)
  const [detailTab, setDetailTab] = useState('ranking')
  const [compPage, setCompPage] = useState(0)
  const [evoMatSearch, setEvoMatSearch] = useState('')
  const [evoMatIdx, setEvoMatIdx] = useState(-1)
  const [evoMonths, setEvoMonths] = useState(1)
  const [evoCustom, setEvoCustom] = useState(false)
  const [evoDateFrom, setEvoDateFrom] = useState('')
  const [evoDateTo, setEvoDateTo] = useState('')
  const [evoChartType, setEvoChartType] = useState('area')
  const [orderTypeMatIdx, setOrderTypeMatIdx] = useState(-1)
  const [topClientsPage, setTopClientsPage] = useState(0)

  const kpis = data?.client_kpis || {}
  const materialAnalytics = kpis.material_analytics || {}
  const materialComparison = kpis.material_comparison || null
  const summary = materialAnalytics.summary || []
  const orderTypeByMaterial = materialAnalytics.order_type_by_material || []

  const filteredSummary = useMemo(() =>
    summary.filter(m => m.name?.toLowerCase().includes(materialSearch.toLowerCase())),
    [summary, materialSearch]
  )

  const totalCurrent = useMemo(() => summary.reduce((s, m) => s + m.total_orders, 0), [summary])
  const totalComparison = materialComparison?.period_total || 0
  const topMaterial = summary[0] || null
  const avgCancelRate = summary.length > 0 ? Math.round(summary.reduce((s, m) => s + (m.cancel_rate || 0), 0) / summary.length * 10) / 10 : 0

  const avgCancelRatePrev = useMemo(() => {
    const prev = materialComparison?.summary || []
    return prev.length > 0 ? Math.round(prev.reduce((s, m) => s + (m.cancel_rate || 0), 0) / prev.length * 10) / 10 : 0
  }, [materialComparison])

  const materialsCountPrev = materialComparison?.summary?.length || 0

  const trendCurrent = getTrendConfig(totalCurrent, totalComparison)
  const trendCancelRate = getTrendConfig(avgCancelRate, avgCancelRatePrev)
  const trendMaterials = getTrendConfig(summary.length, materialsCountPrev)

  const filteredEvoMats = useMemo(() =>
    summary.filter(m => m.name?.toLowerCase().includes(evoMatSearch.toLowerCase())),
    [summary, evoMatSearch]
  )

  const evoData = useMemo(() => {
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

    const selectedMat = evoMatIdx >= 0 ? filteredEvoMats[evoMatIdx] : null
    const showDistinct = evoMatIdx === -2
    const hasComp = !!(materialComparison?.summary?.length)

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
        currentDaily = distinctDaily(summary, currentDates)
        prevDaily = hasComp ? distinctDaily(materialComparison.summary, prevDates) : {}
      } else if (selectedMat) {
        currentDaily = selectedMat.daily || {}
        prevDaily = hasComp ? (findCompMat(selectedMat.name)?.daily || {}) : {}
      } else {
        currentDaily = sumDaily(summary, currentDates)
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

      const currentMats = selectedMat ? [selectedMat] : summary
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
      const currMats = summary
      const prevMats = hasComp ? materialComparison.summary : []
      return monthLabels.map((m, i) => ({
        name: `Mes ${i + 1}`,
        Materiales: monthDistinct(currMats, m),
        ...(hasComp ? { 'Período anterior': monthDistinct(prevMats, prevMonthLabels[i]) } : {}),
      }))
    }

    const currentMap = selectedMat ? buildMonthMap([selectedMat]) : buildMonthMap(summary)
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
  }, [evoMatIdx, filteredEvoMats, evoMonths, evoCustom, evoDateFrom, evoDateTo, summary, materialComparison])

  const evoSubtitle = useMemo(() => {
    const selectedMat = evoMatIdx >= 0 ? filteredEvoMats[evoMatIdx] : null
    const showDistinct = evoMatIdx === -2
    const useCustom = evoCustom && evoDateFrom && evoDateTo
    const hasComp = !!(materialComparison?.summary?.length)
    const compSuffix = hasComp ? ' vs período anterior' : ''
    if (showDistinct) {
      return useCustom
        ? `Materiales diferentes utilizados del ${evoDateFrom} al ${evoDateTo}${compSuffix}.`
        : `Materiales diferentes utilizados en los últimos ${evoMonths} mes${evoMonths > 1 ? 'es' : ''}${compSuffix}.`
    }
    if (selectedMat) {
      return useCustom
        ? `Uso de ${selectedMat.name} del ${evoDateFrom} al ${evoDateTo}${compSuffix}.`
        : `Uso de ${selectedMat.name} en los últimos ${evoMonths} mes${evoMonths > 1 ? 'es' : ''}${compSuffix}.`
    }
    return useCustom
      ? `Total de materiales utilizados del ${evoDateFrom} al ${evoDateTo}${compSuffix}.`
      : `Total de materiales utilizados en los últimos ${evoMonths} mes${evoMonths > 1 ? 'es' : ''}${compSuffix}.`
  }, [evoMatIdx, filteredEvoMats, evoMonths, evoCustom, evoDateFrom, evoDateTo, materialComparison])

  const starMaterials = useMemo(() =>
    summary.filter(m => m.total_orders >= 5 && (m.cancel_rate || 0) < 10)
      .sort((a, b) => b.total_orders - a.total_orders)
      .slice(0, 5),
    [summary]
  )

  const highCancelMaterials = useMemo(() =>
    summary.filter(m => m.cancel_rate > 20 && m.total_orders >= 3)
      .sort((a, b) => b.cancel_rate - a.cancel_rate)
      .slice(0, 5),
    [summary]
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

  const orderTypePieData = useMemo(() => {
    if (orderTypeMatIdx >= 0 && summary[orderTypeMatIdx]) {
      const m = summary[orderTypeMatIdx]
      return [
        { name: 'Normal', value: m.normal_orders || 0, color: PALETTE.cyan },
        { name: '911 (Urgente)', value: m.urgent_orders || 0, color: PALETTE.rose },
      ].filter(d => d.value > 0)
    }
    const totalNormal = orderTypeByMaterial.reduce((s, m) => s + m.normal, 0)
    const totalUrgent = orderTypeByMaterial.reduce((s, m) => s + m.urgent, 0)
    return [
      { name: 'Normal', value: totalNormal, color: PALETTE.cyan },
      { name: '911 (Urgente)', value: totalUrgent, color: PALETTE.rose },
    ].filter(d => d.value > 0)
  }, [orderTypeByMaterial, orderTypeMatIdx, summary])

  if (!data) return null

  const selectedMat = selectedMaterial >= 0 ? filteredSummary[selectedMaterial] : null
  const detailPageData = selectedMat
    ? [selectedMat]
    : filteredSummary.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Materiales</span>
          <h2 className="kpi-section-title">Análisis de Materiales</h2>
          <p className="kpi-section-subtitle">Ranking, uso, tendencias y cancelaciones por material.</p>
        </div>
      </div>

      {/* ─── SUMMARY CARDS ─── */}
      <div className="kpi-hero-grid kpi-hero-grid--4">
        <MiniCard label="Órdenes Totales" value={formatNumber(totalCurrent)} sub="en el Sistema" icon={<Icons.Orders size={16} />} sem={SEMANTIC.neutral} trend={trendCurrent} />
        <MiniCard label="Material Más Usado" value={topMaterial?.name || 'N/A'} sub={topMaterial ? `${formatNumber(topMaterial.total_orders)} órdenes` : ''} icon={<Icons.Package size={16} />} sem={SEMANTIC.positive} trend={getTrendConfig(topMaterial?.total_orders || 0, materialComparison?.summary?.[0]?.total_orders || 0)} />
        <MiniCard label="Tasa de Cancelación" value={`${avgCancelRate}%`} sub="órdenes con material canceladas" icon={<Icons.AlertCircle size={16} />} sem={avgCancelRate > 15 ? SEMANTIC.negative : SEMANTIC.positive} trend={trendCancelRate} />
        <MiniCard label="Materiales Activos" value={summary.length} sub="usados en el mes" icon={<Icons.Clipboard size={16} />} sem={SEMANTIC.neutral} trend={trendMaterials} />
      </div>

      {/* ─── EVOLUTION CHART ─── */}
      <div className="kpi-section">
        <div className="kpi-section-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
          <div>
            <span className="kpi-section-kicker">Tendencias</span>
            <h2 className="kpi-section-title">Evolución de Materiales</h2>
            <p className="kpi-section-subtitle">{evoSubtitle}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div className="kpi-filter-row" style={{ flex: '0 0 auto', margin: 0 }}>
              <label>
                <span>Buscar</span>
                <input type="text" placeholder="Nombre del material..." value={evoMatSearch} onChange={e => { setEvoMatSearch(e.target.value); setEvoMatIdx(-1) }} />
              </label>
              <label>
                <span>Material</span>
                <select value={evoMatIdx} onChange={e => setEvoMatIdx(+e.target.value)}>
                  <option value={-1}>Todos</option>
                  <option value={-2}>Materiales diferentes</option>
                  {filteredEvoMats.map((m, i) => <option key={i} value={summary.indexOf(m)}>{m.name}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginLeft: 'auto' }}>
              {!evoCustom && (
                <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                  {[
                    { val: 1, label: '1 mes' },
                    { val: 3, label: '3 meses' },
                    { val: 6, label: '6 meses' },
                  ].map(({ val, label }) => (
                    <button key={val} className={`kpi-pipeline-view-btn ${evoMonths === val ? 'active' : ''}`} onClick={() => setEvoMonths(val)}>{label}</button>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
              <button className={`kpi-pipeline-view-btn ${evoChartType === 'area' ? 'active' : ''}`} onClick={() => setEvoChartType('area')}>Área</button>
              <button className={`kpi-pipeline-view-btn ${evoChartType === 'line' ? 'active' : ''}`} onClick={() => setEvoChartType('line')}>Línea</button>
              <button className={`kpi-pipeline-view-btn ${evoChartType === 'bar' ? 'active' : ''}`} onClick={() => setEvoChartType('bar')}>Barras</button>
            </div>
          </div>
          {(() => {
            const hasComp = !!(materialComparison?.summary?.length)
            const compColor = '#94A3B8'
            return (
              <>
                <div style={{ height: 280 }} key={`evo-mat-${evoMatIdx}-${evoMonths}-${evoCustom}-${evoChartType}`}>
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
                <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE.cyan }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>
                      {evoMatIdx >= 0 ? filteredEvoMats[evoMatIdx]?.name : evoMatIdx === -2 ? 'Materiales diferentes' : 'Todos los materiales'}
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

      {/* ─── PERIOD COMPARISON ─── */}
      {materialComparison && (() => {
        const currBounds = getPeriodBounds('month')
        const prevBounds = getComparePeriodBounds('month')
        const fmtDate = (d) => new Date(d).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
        const currDays = Math.round((new Date(currBounds.dateTo) - new Date(currBounds.dateFrom)) / 86400000)
        const prevDays = Math.round((new Date(prevBounds.dateTo) - new Date(prevBounds.dateFrom)) / 86400000)
        const dayDiff = Math.abs(currDays - prevDays)
        return (
        <div className="kpi-section">
          <div className="kpi-section-header">
            <div>
              <span className="kpi-section-kicker">Comparación</span>
              <h2 className="kpi-section-title">Comparación con Período Anterior</h2>
              <p className="kpi-section-subtitle">Compara el uso de materiales entre el mes actual ({currDays} días: {fmtDate(currBounds.dateFrom)} - {fmtDate(currBounds.dateTo)}) y el mes anterior ({prevDays} días: {fmtDate(prevBounds.dateFrom)} - {fmtDate(prevBounds.dateTo)}){dayDiff > 0 ? `. Los períodos difieren en ${dayDiff} día${dayDiff > 1 ? 's' : ''}, por lo que los totales pueden variar ligeramente.` : ''}</p>
            </div>
          </div>
          <div className="kpi-card" style={{ padding: 24 }}>
            {/* ── Hero: dos períodos lado a lado ── */}
            {(() => {
              const prevMats = new Set((materialComparison.summary || []).map(m => m.name))
              const currMats = new Set(summary.map(m => m.name))
              const kept = [...prevMats].filter(m => currMats.has(m))
              const newMats = [...currMats].filter(m => !prevMats.has(m))
              const lost = [...prevMats].filter(m => !currMats.has(m))
              const change = prevMats.size > 0 ? Math.round(((currMats.size - prevMats.size) / prevMats.size) * 100) : (currMats.size > 0 ? 100 : 0)
              const isUp = currMats.size > prevMats.size
              const isDown = currMats.size < prevMats.size
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 160, textAlign: 'center', padding: '20px 16px', borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Mes Anterior ({prevDays}d)</div>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#091127' }}>{prevMats.size}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>materiales · {fmtDate(prevBounds.dateFrom)} - {fmtDate(prevBounds.dateTo)}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: isUp ? '#DCFCE7' : isDown ? '#FEF2F2' : '#F1F5F9',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 20, color: isUp ? '#16A34A' : isDown ? '#DC2626' : '#64748b',
                      }}>
                        {isUp ? '↑' : isDown ? '↓' : '→'}
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 700,
                        color: isUp ? '#16A34A' : isDown ? '#DC2626' : '#64748b',
                      }}>
                        {isUp ? '+' : ''}{change}%
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 160, textAlign: 'center', padding: '20px 16px', borderRadius: 14, background: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#0284C7', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Mes Actual ({currDays}d)</div>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#0284C7' }}>{currMats.size}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>materiales · {fmtDate(currBounds.dateFrom)} - {fmtDate(currBounds.dateTo)}</div>
                    </div>
                  </div>

                  {/* ── Cards de movimiento ── */}
                   <div className="kpi-hero-grid kpi-hero-grid--3" style={{ marginBottom: 24, gap: 12 }}>
                    <div style={{ padding: '14px 16px', borderRadius: 12, background: '#F0F9FF', border: '1px solid #BAE6FD', textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#0284C7' }}>{kept.length}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#0284C7', marginTop: 2 }}>Mantenidos</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>en ambos períodos</div>
                    </div>
                    <div style={{ padding: '14px 16px', borderRadius: 12, background: '#DCFCE7', border: '1px solid #BBF7D0', textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#16A34A' }}>{newMats.length}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#16A34A', marginTop: 2 }}>Nuevos</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{newMats.length > 0 ? newMats.join(', ') : '—'}</div>
                    </div>
                    <div style={{ padding: '14px 16px', borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA', textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#DC2626' }}>{lost.length}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', marginTop: 2 }}>Perdidos</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{lost.length > 0 ? lost.join(', ') : '—'}</div>
                    </div>
                  </div>

                  {/* ── Tabla simplificada ── */}
                  {materialComparison.summary?.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Detalle por material</div>
                        <Pagination page={compPage} total={materialComparison.summary.length} pageSize={7} onPage={setCompPage} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 8, padding: '6px 12px', fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', alignItems: 'center' }}>
                              <div style={{ fontWeight: 600, color: '#091127', fontSize: 13 }}>{m.name}</div>
                              <div style={{ textAlign: 'center', fontSize: 13, color: '#64748b' }}>{formatNumber(m.total_orders)}</div>
                              <div style={{ textAlign: 'center', fontSize: 13, color: '#091127', fontWeight: 600 }}>{formatNumber(currTotal)}</div>
                              <div style={{ textAlign: 'center' }}>
                                {isGone ? (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', padding: '3px 10px', borderRadius: 12 }}>Perdido</span>
                                ) : isNew ? (
                                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: '#16A34A', background: '#DCFCE7', padding: '3px 10px', borderRadius: 12 }}>Nuevo</span>
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

      {/* ─── ORDER TYPE PIE (unified) ─── */}
      <div className="kpi-section">
        <div className="kpi-section-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span className="kpi-section-kicker">Distribución</span>
              <h2 className="kpi-section-title">Tipo de Orden por Material</h2>
              <p className="kpi-section-subtitle">
                {orderTypeMatIdx >= 0
                  ? `Órdenes normales vs urgentes de ${summary[orderTypeMatIdx]?.name || ''}.`
                  : 'Participación de órdenes normales vs urgentes en el período.'}
              </p>
            </div>
            <div className="kpi-filter-row" style={{ flex: '0 0 auto', margin: 0 }}>
              <label>
                <span>Material</span>
                <select value={orderTypeMatIdx} onChange={e => setOrderTypeMatIdx(+e.target.value)}>
                  <option value={-1}>Todos</option>
                  {summary.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="kpi-card" style={{ padding: 24 }}>
          {orderTypePieData.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48 }}>
              <div style={{ position: 'relative', width: 280, height: 280, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={orderTypePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={orderTypePieData.length > 1 ? 5 : 0} stroke="none">
                      {orderTypePieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      const total = orderTypePieData.reduce((s, e) => s + e.value, 0)
                      return (
                        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                          <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                          <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes — {total > 0 ? Math.round((d.value / total) * 100) : 0}%</p>
                        </div>
                      )
                    }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, fontWeight: 800, color: '#091127' }}>{formatNumber(orderTypePieData.reduce((s, e) => s + e.value, 0))}</div>
                  <div style={{ fontSize: 13, color: '#94A3B8' }}>órdenes</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 240 }}>
                {orderTypePieData.map((entry, i) => {
                  const total = orderTypePieData.reduce((s, e) => s + e.value, 0)
                  const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: entry.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, background: entry.color }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#091127' }}>{entry.name}</div>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{entry.value} órdenes</div>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: entry.color }}>{pct}%</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de tipos de orden</div></div>
          )}
        </div>
      </div>

      {/* ─── RANKING SECTION ─── */}
      <div className="kpi-section">
        <div className="kpi-section-header">
          <div>
            <span className="kpi-section-kicker">Ranking</span>
            <h2 className="kpi-section-title">Ranking de Materiales</h2>
            <p className="kpi-section-subtitle">Materiales con mayor utilización durante el período seleccionado. · {filteredSummary.length} materiales</p>
          </div>
        </div>

        {/* ─── TABS: RANKING / HEATMAP / ALERTAS ─── */}
        <div className="kpi-pipeline-view-toggle" style={{ marginBottom: 16 }}>
          {[['ranking', 'Ranking de Materiales'], ['heatmap', 'Heatmap'], ['alerts', 'Alertas']].map(([key, label]) => (
            <button key={key} onClick={() => setDetailTab(key)}
              className={`kpi-pipeline-view-btn ${detailTab === key ? 'active' : ''}`}>
              {label}
            </button>
          ))}
        </div>

      {/* ─── RANKING TAB ─── */}
      {detailTab === 'ranking' && (
        <div className="kpi-card" style={{ padding: 24 }}>
          <div className="kpi-filter-row" style={{ marginBottom: 16 }}>
              <label>
                <span>Buscar</span>
                <div style={{ position: 'relative' }}>
                  <Icons.Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input type="text" placeholder="Nombre del material..." value={materialSearch}
                    onChange={e => { setMaterialSearch(e.target.value); setSelectedMaterial(-1); setPage(0); setTopClientsPage(0) }}
                    style={{ paddingLeft: 32 }} />
                </div>
              </label>
              <label>
                <span>Material</span>
                <select value={selectedMaterial} onChange={e => { setSelectedMaterial(+e.target.value); setPage(0); setTopClientsPage(0) }}>
                  <option value={-1}>Todos</option>
                  {filteredSummary.map((m, i) => <option key={i} value={filteredSummary.indexOf(m)}>{m.name}</option>)}
                </select>
              </label>
            </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detailPageData.map((m, i) => {
              const rank = selectedMat ? 1 : page * PAGE_SIZE + i + 1
              const pct = totalCurrent > 0 ? Math.round((m.total_orders / totalCurrent) * 100) : 0
              const topClient = m.top_clients?.[0]
              const sparkData = (m.monthly_trend || []).map(t => ({ v: t.count }))
              const prevOrders = materialComparison?.summary?.find(c => c.name === m.name)?.total_orders || 0
              const trendPct = prevOrders > 0 ? Math.round(((m.total_orders - prevOrders) / prevOrders) * 100) : (m.total_orders > 0 ? 100 : 0)
              const trendUp = m.total_orders > prevOrders
              const trendDown = m.total_orders < prevOrders
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                  <div style={{ width: 4, background: PALETTE.pie[(rank - 1) % PALETTE.pie.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#94A3B8', width: 28, textAlign: 'center', flexShrink: 0 }}>{rank}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#091127' }}>{m.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', background: '#E2E8F0', padding: '2px 8px', borderRadius: 20 }}>{pct}% uso</span>
                        {materialComparison?.summary && (
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                            color: trendUp ? '#16A34A' : trendDown ? '#DC2626' : '#64748b',
                            background: trendUp ? '#DCFCE7' : trendDown ? '#FEF2F2' : '#F1F5F9',
                          }}>
                            {trendUp ? `↑ +${trendPct}%` : trendDown ? `↓ ${trendPct}%` : '='}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                        <span><strong style={{ color: '#091127' }}>{m.total_orders}</strong> órdenes</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icons.User size={12} /> <strong style={{ color: '#091127' }}>{m.top_clients?.length || 0}</strong> clientes</span>
                        {topClient && <span style={{ color: '#94A3B8' }}>· {topClient.client_name} ({topClient.count})</span>}
                      </div>
                      <div style={{ height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden', maxWidth: 300 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[(rank - 1) % PALETTE.pie.length], borderRadius: 2 }} />
                      </div>
                    </div>
                    {sparkData.length > 1 && (
                      <div style={{ flexShrink: 0, width: 80, height: 32 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={sparkData}>
                            <Line type="monotone" dataKey="v" stroke={PALETTE.cyan} strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
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
        <div className="kpi-card" style={{ padding: 24 }}>
          <div className="kpi-card-title">Heatmap: Uso Mensual por Material (Top 6)</div>
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
                          const bg = val === 0 ? '#F8FAFC' : `rgba(6, 182, 212, ${0.1 + intensity * 0.8})`
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="kpi-card" style={{ padding: 24 }}>
            <div className="kpi-card-title"><Icons.AlertCircle size={16} color={PALETTE.amber} /> Materiales Estrella</div>
            {starMaterials.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {starMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                    <Icons.CheckCircle size={16} color="#16A34A" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#047857' }}>{formatNumber(m.total_orders)} órdenes · {m.cancel_rate}% cancelación</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PALETTE.green, background: '#D1FAE5', padding: '2px 8px', borderRadius: 20 }}>Óptimo</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">No hay materiales estrella aún</div></div>
            )}
          </div>

          <div className="kpi-card" style={{ padding: 24 }}>
            <div className="kpi-card-title"><Icons.AlertCircle size={16} color={PALETTE.rose} /> Alta Tasa de Cancelación</div>
            {highCancelMaterials.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {highCancelMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <Icons.AlertCircle size={16} color="#DC2626" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#B91C1C' }}>{formatNumber(m.total_orders)} órdenes · <strong>{m.cancel_rate}%</strong> cancelación</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PALETTE.rose, background: '#FEE2E2', padding: '2px 8px', borderRadius: 20 }}>Revisar</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">No hay materiales con alta cancelación</div></div>
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
          <div className="kpi-card" style={{ padding: 24, marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="kpi-card-title" style={{ marginBottom: 0 }}>
                Clientes que más usan <strong style={{ color: '#091127' }}>{selectedMat.name}</strong> · {topClientsTotal} clientes
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
      </div>
    </div>
  )
}
