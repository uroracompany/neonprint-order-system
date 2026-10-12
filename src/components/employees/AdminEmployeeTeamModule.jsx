import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getKpiBounds } from "../../hooks/useKPI";
import { adminApiFetch } from "../../utils/adminApi";
import { formatNumber } from "../../utils/kpiHelpers";
import { Icons } from "../../utils/icons";

const TABS = [
  { id: "general", label: "Desempeño general", icon: Icons.TrendUp },
  { id: "sales", label: "Ventas", icon: Icons.Users },
  { id: "design", label: "Diseño", icon: Icons.Brush },
  { id: "production", label: "Producción", icon: Icons.Package },
];

const AREA_TABS = [
  { id: "digital", label: "Digital" },
  { id: "dtf", label: "DTF" },
  { id: "ploteo", label: "Ploteo" },
  { id: "all", label: "Todas las áreas" },
];

const PRODUCTION_AREA_IDS = AREA_TABS.filter((area) => area.id !== "all").map((area) => area.id);
const PRODUCTION_AREA_COLORS = { digital: "#2563EB", dtf: "#F59E0B", ploteo: "#8B5CF6" };

const EMPTY_DATA = {
  general: { summary: {}, comparison: {}, trend: { points: [] }, department_breakdown: [] },
  sales: { summary: {}, comparison: {}, trend: { points: [] }, ranking: [] },
  design: { summary: {}, comparison: {}, trend: { points: [] }, ranking: [] },
  production: { summary: {}, comparison: {}, trend: { points: [] }, areas: {} },
};

const number = (value) => formatNumber(Number(value) || 0);
const percent = (value) => `${formatNumber(Number(value) || 0, { decimals: 1 })}%`;

function MetricCard({ label, value, detail, icon: Icon, tone = "blue", comparison, inverse = false }) {
  return (
    <article className={`aet-stat-card ${tone}`}>
      <span className="aet-stat-icon">{createElement(Icon)}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
        {comparison && <Comparison value={comparison.change_pct} inverse={inverse} />}
      </div>
    </article>
  );
}

function Comparison({ value, inverse = false }) {
  const change = Number(value) || 0;
  if (!change) return <small className="aet-comparison neutral">Sin cambios</small>;
  const positive = inverse ? change < 0 : change > 0;
  return <small className={`aet-comparison ${positive ? "positive" : "negative"}`}>{change > 0 ? "↑" : "↓"} {Math.abs(change)}% vs. anterior</small>;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="aet-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => <span key={entry.dataKey} style={{ color: entry.color }}>{entry.name}: {number(entry.value)}</span>)}
    </div>
  );
}

function Ranking({ rows, valueKey, valueLabel, secondaryKey }) {
  if (!rows.length) return <p className="aet-empty">No hay empleados con actividad en este período.</p>;
  return (
    <div className="aet-ranking" role="list" aria-label={`Ranking de ${valueLabel}`}>
      {rows.map((row) => (
        <div className="aet-ranking-row" role="listitem" key={row.id}>
          <span className="aet-rank">{row.rank}</span>
          <span className="aet-avatar">{String(row.name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
          <span className="aet-ranking-name"><strong>{row.name}</strong><small>{row.role?.replaceAll("_", " ")}</small></span>
          <span className="aet-ranking-value"><strong>{number(row[valueKey])}</strong><small>{valueLabel}</small></span>
          {secondaryKey && <span className="aet-ranking-secondary">{number(row[secondaryKey])}{secondaryKey.includes("rate") ? "%" : ""}</span>}
        </div>
      ))}
    </div>
  );
}

function SummaryCards({ summary, comparison = {}, kind }) {
  if (kind === "production") {
    return (
      <div className="aet-stat-grid">
        <MetricCard label="Archivos" value={number(summary.total_files)} detail={`${number(summary.completed)} completados`} icon={Icons.Package} comparison={comparison.total_files} />
        <MetricCard label="Carga activa" value={number(summary.active_files)} detail={`${number(summary.pending)} pendientes`} icon={Icons.Clock} tone="orange" comparison={comparison.active_files} />
        <MetricCard label="Finalización" value={percent(summary.completion_rate)} detail="Salida efectiva" icon={Icons.CheckCircle} tone="green" comparison={comparison.completion_rate} />
        <MetricCard label="Calidad" value={percent(summary.first_time_right)} detail={`${number(summary.reversions)} reversiones`} icon={Icons.Check} tone="violet" comparison={comparison.reversions} inverse />
        <MetricCard label="Tiempo promedio" value={`${number(summary.avg_time_days)} d`} detail={`${number(summary.files_per_day)} archivos/día`} icon={Icons.TrendUp} tone="cyan" comparison={comparison.avg_time_days} inverse />
      </div>
    );
  }
  return (
    <div className="aet-stat-grid">
      <MetricCard label="Órdenes" value={number(summary.total_orders)} detail={`${number(summary.active_orders)} activas`} icon={Icons.Orders} comparison={comparison.total_orders} />
      <MetricCard label="Completadas" value={number(summary.completed_orders)} detail={`${percent(summary.completion_rate)} finalización`} icon={Icons.CheckCircle} tone="green" comparison={comparison.completed_orders} />
      <MetricCard label="Entregadas" value={number(summary.delivered_orders)} detail={`${number(summary.cancelled_orders)} canceladas`} icon={Icons.Truck} tone="cyan" comparison={comparison.delivered_orders} />
      <MetricCard label="Órdenes 911" value={number(summary.urgent_911_orders)} detail={`${number(summary.normal_orders)} normales`} icon={Icons.Bell} tone="orange" />
      <MetricCard label="Ciclo promedio" value={`${number(summary.avg_cycle_days)} d`} detail={`${percent(summary.cancellation_rate)} cancelación`} icon={Icons.Clock} tone="violet" comparison={comparison.avg_cycle_days} inverse />
    </div>
  );
}

function TrendSection({ trend, title, production = false }) {
  const points = trend?.points || [];
  const keys = production ? [{ key: "production", label: "Archivos", color: "#8B5CF6" }] : [
    { key: "sales", label: "Ventas", color: "#2563EB" },
    { key: "design", label: "Diseño", color: "#9333EA" },
    { key: "production", label: "Producción", color: "#F59E0B" },
  ];
  return (
    <article className="aet-panel aet-chart-panel">
      <div className="aet-panel-heading"><div><span className="aet-kicker">Actividad temporal</span><h3>{title}</h3></div><span>{trend?.granularity || "día"}</span></div>
      {points.length ? (
        <div className="aet-chart" role="img" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
              <defs><linearGradient id={production ? "aet-production-gradient" : "aet-general-gradient"} x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor={keys[0].color} stopOpacity={0.22} /><stop offset="95%" stopColor={keys[0].color} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke="#e8edf8" strokeDasharray="3 4" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71809a" }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#71809a" }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              {keys.map((item, index) => <Area key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2.2} fill={index === 0 ? `url(#${production ? "aet-production-gradient" : "aet-general-gradient"})` : "transparent"} />)}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="aet-empty">No hay actividad suficiente para graficar este período.</p>}
    </article>
  );
}

function GeneralView({ data }) {
  const summary = data.general?.summary || {};
  const breakdown = data.general?.department_breakdown || [];
  return <>
    <SummaryCards summary={summary} comparison={data.general?.comparison} />
    <div className="aet-two-column">
      <TrendSection trend={data.general?.trend} title="Actividad por departamento" />
      <article className="aet-panel aet-chart-panel"><div className="aet-panel-heading"><div><span className="aet-kicker">Distribución</span><h3>Trabajo registrado</h3></div></div><div className="aet-bar-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={breakdown} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8edf8" strokeDasharray="3 4" /><XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="value" name="Actividad" fill="#2563EB" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
    </div>
  </>;
}

function ProductionAreaTabs({ selectedArea, onAreaChange }) {
  return (
    <div className="aet-area-tabs" role="tablist" aria-label="Áreas de producción">
      {AREA_TABS.map((item) => (
        <button type="button" role="tab" aria-selected={selectedArea === item.id} className={selectedArea === item.id ? "active" : ""} onClick={() => onAreaChange(item.id)} key={item.id}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function getProductionAreaRows(department) {
  return PRODUCTION_AREA_IDS.map((id) => {
    const area = department.areas?.[id] || {};
    const summary = area.summary || {};
    const tab = AREA_TABS.find((item) => item.id === id);
    return {
      id,
      name: area.label || tab?.label || id,
      role: "Área de producción",
      total_orders: Number(summary.total_orders) || 0,
      total_files: Number(summary.total_files) || 0,
      completed: Number(summary.completed) || 0,
      active_files: Number(summary.active_files) || 0,
      completion_rate: Number(summary.completion_rate) || 0,
      first_time_right: Number(summary.first_time_right) || 0,
      avg_time_days: Number(summary.avg_time_days) || 0,
      files_per_day: Number(summary.files_per_day) || 0,
    };
  });
}

function getProductionComparisonTrend(department) {
  const points = new Map();
  PRODUCTION_AREA_IDS.forEach((id) => {
    (department.areas?.[id]?.trend?.points || []).forEach((sourcePoint) => {
      const point = points.get(sourcePoint.date) || { date: sourcePoint.date, digital: 0, dtf: 0, ploteo: 0, total: 0 };
      point[id] = Number(sourcePoint.production) || 0;
      point.total = point.digital + point.dtf + point.ploteo;
      points.set(sourcePoint.date, point);
    });
  });
  return {
    granularity: department.areas?.digital?.trend?.granularity || "día",
    points: [...points.values()].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function ProductionComparisonView({ department }) {
  const rows = getProductionAreaRows(department);
  const trend = getProductionComparisonTrend(department);
  const chartData = rows.map((row) => ({
    label: row.name,
    orders: row.total_orders,
    completed: row.completed,
    active: row.active_files,
  }));
  const ranking = [...rows]
    .sort((left, right) => right.completed - left.completed || right.total_orders - left.total_orders || left.name.localeCompare(right.name, "es"))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return (
    <>
      <div className="aet-area-compare-grid">
        {rows.map((row) => (
          <article className={`aet-area-compare-card ${row.id}`} key={row.id}>
            <div className="aet-area-compare-heading">
              <span className="aet-area-compare-dot" style={{ background: PRODUCTION_AREA_COLORS[row.id] }} />
              <strong>{row.name}</strong>
            </div>
            <div className="aet-area-compare-main"><strong>{number(row.total_orders)}</strong><span>órdenes</span></div>
            <div className="aet-area-compare-details">
              <span>{number(row.total_files)} archivos</span>
              <span>{number(row.completed)} completados</span>
              <span>{percent(row.completion_rate)} finalización</span>
            </div>
          </article>
        ))}
      </div>
      <div className="aet-two-column">
        <article className="aet-panel aet-chart-panel">
          <div className="aet-panel-heading"><div><span className="aet-kicker">Comparación de áreas</span><h3>Órdenes y producción</h3></div></div>
          <div className="aet-bar-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e8edf8" strokeDasharray="3 4" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="orders" name="Órdenes" fill="#2563EB" radius={[8, 8, 0, 0]} />
                <Bar dataKey="completed" name="Completados" fill="#16A34A" radius={[8, 8, 0, 0]} />
                <Bar dataKey="active" name="Carga activa" fill="#F59E0B" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="aet-panel aet-ranking-panel">
          <div className="aet-panel-heading"><div><span className="aet-kicker">Ranking comparativo</span><h3>Áreas con mayor actividad</h3></div><span>{number(rows.length)} áreas</span></div>
          <Ranking rows={ranking} valueKey="completed" valueLabel="completados" secondaryKey="total_orders" />
        </article>
      </div>
      <article className="aet-panel aet-chart-panel">
        <div className="aet-panel-heading"><div><span className="aet-kicker">Tendencia comparativa</span><h3>Actividad por área</h3></div><span>{trend.granularity}</span></div>
        {trend.points.length ? (
          <div className="aet-chart" role="img" aria-label="Tendencia comparativa de producción por área">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.points} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e8edf8" strokeDasharray="3 4" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71809a" }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#71809a" }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                {PRODUCTION_AREA_IDS.map((id) => <Area key={id} type="monotone" dataKey={id} name={AREA_TABS.find((item) => item.id === id)?.label || id} stroke={PRODUCTION_AREA_COLORS[id]} strokeWidth={2.2} fill="transparent" />)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="aet-empty">No hay actividad suficiente para graficar este período.</p>}
      </article>
    </>
  );
}

function DepartmentView({ data, kind }) {
  const department = data[kind] || EMPTY_DATA[kind];
  const production = kind === "production";
  if (production && data.selectedArea === "all") {
    return <><ProductionAreaTabs selectedArea={data.selectedArea} onAreaChange={data.onAreaChange} /><ProductionComparisonView department={department} /></>;
  }
  const area = production ? (department.areas?.[data.selectedArea] || department.areas?.digital || {}) : department;
  const summary = production ? area.summary : department.summary;
  const ranking = production ? area.ranking : department.ranking;
  const trend = production ? area.trend : department.trend;
  return <>
    {production && <ProductionAreaTabs selectedArea={data.selectedArea} onAreaChange={data.onAreaChange} />}
    <SummaryCards summary={summary} comparison={production ? area.comparison : department.comparison} kind={production ? "production" : kind} />
    <div className="aet-two-column">
      <TrendSection trend={trend} title={production ? `Actividad de Producción ${area.label || ""}` : `Tendencia de ${kind === "sales" ? "Ventas" : "Diseño"}`} production={production} />
      <article className="aet-panel aet-ranking-panel"><div className="aet-panel-heading"><div><span className="aet-kicker">Ranking operativo</span><h3>{production ? `Productores ${area.label || ""}` : kind === "sales" ? "Vendedores" : "Diseñadores"}</h3></div><span>{number(ranking.length)} empleados</span></div><Ranking rows={ranking} valueKey={production ? "completed" : "completed"} valueLabel={production ? "completados" : "órdenes completas"} secondaryKey={production ? "efficiency_score" : "completion_rate"} /></article>
    </div>
  </>;
}

export default function AdminEmployeeTeamModule({ onBack }) {
  const [activeTab, setActiveTab] = useState("general");
  const [selectedArea, setSelectedArea] = useState("digital");
  const [period] = useState("month");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const bounds = useMemo(() => getKpiBounds(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo]);

  const load = useCallback(async () => {
    if (!bounds) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await adminApiFetch("/api/admin", { action: "employee-team-performance", ...bounds });
      if (!result.response.ok) throw new Error(result.result?.error || "No se pudieron cargar las estadísticas de equipo.");
      setData(result.result || EMPTY_DATA);
    } catch (requestError) {
      setData(null);
      setError(requestError.message || "No se pudieron cargar las estadísticas de equipo.");
    } finally {
      setLoading(false);
    }
  }, [bounds]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="pa-section acm-detail-view aet-view" aria-labelledby="employee-team-title">
      <button type="button" className="acm-back" onClick={onBack}><Icons.ArrowLeft /> Volver a empleado</button>
      <div className="aet-header">
        <div><span className="aet-kicker">Estadísticas de equipo</span><h2 id="employee-team-title">Desempeño por departamento</h2><p>Rendimiento operativo de los equipos y sus áreas durante el período seleccionado.</p></div>
      </div>
      {period === "custom" && <div className="aet-custom-dates"><label>Desde <input type="date" value={customDateFrom} onChange={(event) => setCustomDateFrom(event.target.value)} /></label><label>Hasta <input type="date" value={customDateTo} onChange={(event) => setCustomDateTo(event.target.value)} /></label></div>}
      <div className="aet-tabs" role="tablist" aria-label="Departamentos de estadísticas">{TABS.map((tab) => { const Icon = tab.icon; return <button type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)} key={tab.id}><Icon />{tab.label}</button>; })}</div>
      {loading && <div className="aet-state"><div className="kpi-spinner" /> Cargando estadísticas de equipo…</div>}
      {!loading && error && <div className="aet-state aet-error"><Icons.AlertCircle /><span>{error}</span><button type="button" className="pa-btn secondary pa-btn-sm" onClick={() => void load()}>Reintentar</button></div>}
      {!loading && !error && data && (activeTab === "general" ? <GeneralView data={data} /> : <DepartmentView data={{ ...data, selectedArea, onAreaChange: setSelectedArea }} kind={activeTab} />)}
      {!loading && !error && !data && <div className="aet-state">Selecciona un período válido para consultar estadísticas.</div>}
    </section>
  );
}
