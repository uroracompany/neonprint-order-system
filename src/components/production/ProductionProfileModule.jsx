import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Icons } from "../../utils/icons";
import { adminApiFetch } from "../../utils/adminApi";
import useOrdersRealtimeSync from "../../hooks/useOrdersRealtimeSync";
import ProfilePeriodControl from "../profile/ProfilePeriodControl";

const EMPTY_METRICS = {
  orders_completed: 0,
  completion_rate: 0,
  orders_active: 0,
  orders_delivered: 0,
  orders_cancelled: 0,
  total_orders: 0,
  goals_achieved: 0,
  files_processed: 0,
  avg_completion_time: 0,
  termination_rate: 0,
};

const EMPTY_ANALYTICS = {
  order_types: { rows: [], total: 0 },
  trends: {},
  top_materials: [],
  top_clients: [],
  status_summary: {},
  production_file_status: { rows: [], total: 0 },
};

const TREND_OPTIONS = [
  { key: "dia", label: "Hoy" },
  { key: "30d", label: "30 dias" },
  { key: "3m", label: "3 meses" },
  { key: "mensual", label: "Mensual" },
];

const ORDER_TYPE_COLORS = ["#1d4ed8", "#dc2626"];
const FILE_STATUS_COLORS = ["#f59e0b", "#06b6d4", "#8b5cf6", "#10b981"];

const formatPercentage = (value) =>
  Number(value || 0).toLocaleString("es-DO", { maximumFractionDigits: 1 });

const getDominantOrderType = (rows) => {
  if (!rows?.length) return null;
  return rows.reduce((best, row) =>
    (row.percentage || 0) > (best.percentage || 0) ? row : best
  , rows[0]);
};

const getInitials = (name) =>
  String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join("").toUpperCase();

const getDisplayName = (profile, authUser) =>
  profile?.name || authUser?.user_metadata?.display_name || authUser?.email || "Productor";

const formatDate = (dateStr) => {
  if (!dateStr) return "---";
  return new Date(dateStr).toLocaleDateString("es-DO", {
    year: "numeric", month: "long", day: "numeric",
  });
};

function ProfileMetricCard({ icon, label, value, sub, tone }) {
  return (
    <div className="pp-profile-metric-card">
      <div className={`pp-profile-metric-icon ${tone || ""}`}>{icon}</div>
      <div className="pp-profile-metric-body">
        <strong>{value ?? "---"}</strong>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

function AnalyticsEmpty({ label }) {
  return (
    <div className="pp-profile-analytics-empty">
      <Icons.BarChart />
      <span>{label || "Sin datos disponibles"}</span>
    </div>
  );
}

function AnalyticsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pp-profile-chart-tooltip">
      <p className="pp-profile-chart-tooltip-label">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function ProgressList({ items, tone }) {
  if (!items?.length) return <AnalyticsEmpty label="Sin datos" />;
  return (
    <div className="pp-profile-progress-list">
      {items.map((item, i) => (
        <div key={i} className="pp-profile-progress-row">
          <div className="pp-profile-progress-top">
            <span>{item.name || item.label || "---"}</span>
            <span>{formatPercentage(item.percentage ?? item.value)}%</span>
          </div>
          <div className={`pp-profile-progress-track ${tone || ""}`}>
            <div style={{ width: `${Math.min(100, item.percentage ?? item.value ?? 0)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProductionProfileModule({ authUser, fallbackProfile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trendView, setTrendView] = useState("30d");
  const [period, setPeriod] = useState("all");
  const requestIdRef = useRef(0);
  const blockingRequestIdRef = useRef(null);

  const fetchProfile = useCallback(async ({ silent = false } = {}) => {
    if (silent && blockingRequestIdRef.current !== null) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!silent) {
      blockingRequestIdRef.current = requestId;
      setLoading(true);
    }
    setError("");
    try {
      const { response, result } = await adminApiFetch("/api/production-profile", { period });
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(result?.error || "No se pudo cargar Mi Perfil.");
      setData(result);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err?.message || "No se pudo cargar Mi Perfil.");
    } finally {
      if (!silent) {
        if (blockingRequestIdRef.current === requestId) {
          blockingRequestIdRef.current = null;
          if (requestId === requestIdRef.current) setLoading(false);
        }
      }
    }
  }, [period]);

  useEffect(() => {
    void fetchProfile();
    return () => { requestIdRef.current += 1; };
  }, [fetchProfile]);

  useOrdersRealtimeSync({
    userId: authUser?.id,
    scope: "production-profile",
    refreshOrders: () => fetchProfile({ silent: true }),
    tables: ["orders", "order_production_files", "order_production_assignments"],
  });

  const profile = data?.profile || fallbackProfile || null;
  const metrics = data?.metrics || EMPTY_METRICS;
  const ranking = data?.ranking || {};
  const analytics = data?.analytics || EMPTY_ANALYTICS;
  const displayName = getDisplayName(profile, authUser);
  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || "";
  const isActive = profile?.employment_status !== false;
  const goalsTotal = 3;
  const goalsProgress = Math.min(100, Math.round(((metrics.goals_achieved || 0) / goalsTotal) * 100));
  const rankingPosition = ranking.position ? `#${ranking.position}` : "Sin ranking";
  const totalProducersLabel = ranking.total_producers ? `de ${ranking.total_producers}` : "sin equipo activo";
  const trendData = analytics.trends?.[trendView] || [];
  const orderTypeRows = analytics.order_types?.rows || EMPTY_ANALYTICS.order_types.rows;
  const dominantOrderType = getDominantOrderType(orderTypeRows);
  const statusSummary = analytics.status_summary || EMPTY_ANALYTICS.status_summary;
  const fileStatusRows = (analytics.production_file_status?.rows || []).map((item) => ({ ...item, unit: "archivos" }));

  const statusCards = useMemo(() => [
    { key: "in_production", label: "En produccion", icon: <Icons.Package />, tone: "info" },
    { key: "in_termination", label: "En terminacion", icon: <Icons.Clock />, tone: "warning" },
    { key: "delivered", label: "Entregadas", icon: <Icons.Truck />, tone: "cyan" },
    { key: "completed", label: "Completadas", icon: <Icons.Check />, tone: "success" },
    { key: "cancelled", label: "Canceladas", icon: <Icons.AlertCircle />, tone: "danger" },
  ], []);

  const goalItems = useMemo(() => [
    {
      label: "Actividad asignada",
      done: (metrics.total_orders || 0) > 0,
    },
    {
      label: "Finalizacion eficiente",
      done: (metrics.completion_rate || 0) >= 70,
    },
    {
      label: "Control de cancelaciones",
      done: (metrics.orders_cancelled || 0) <= 2,
    },
  ], [metrics]);

  if (loading) {
    return (
      <section className="pp-profile">
        <div className="pp-profile-loading">
          <div className="kpi-spinner" />
          <span>Cargando Mi Perfil...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="pp-profile" aria-labelledby="production-profile-title">

      {error && (
        <div className="pp-profile-error">
          <Icons.AlertCircle />
          <span>{error}</span>
        </div>
      )}

      <div className="pp-profile-hero">
        <div className="pp-profile-identity">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="pp-profile-photo acm-avatar acm-avatar-large" />
          ) : (
            <span className="acm-avatar acm-avatar-large">{getInitials(displayName)}</span>
          )}
          <div className="pp-profile-copy">
            <div className="pp-profile-name-line">
              <h2 id="production-profile-title">{displayName}</h2>
            </div>
            <div className="pp-profile-contact">
              <span><Icons.Mail /> {authUser?.email || "---"}</span>
              <span><Icons.Calendar /> {formatDate(profile?.created_at)}</span>
            </div>
            <div className="pp-profile-status-line">
              {isActive ? (
                <span className="acm-profile-status active"><span /> Usuario activo</span>
              ) : (
                <span className="acm-profile-status inactive">Usuario inactivo</span>
              )}
              <small>Periodo: {data?.period?.label || "Todo el historial"}</small>
              <ProfilePeriodControl value={period} onChange={setPeriod} />
            </div>
          </div>
        </div>
      </div>

      <div className="pp-profile-layout">
        <article className="pp-profile-ranking-panel">
          <div className="pp-profile-ranking-header">
            <div>
              <div className="pp-profile-kicker">Ranking privado</div>
              <h3>Tu avance en produccion</h3>
            </div>
            <div className="pp-profile-rank-display">
              <strong>{rankingPosition}</strong>
              <span>{totalProducersLabel}</span>
            </div>
          </div>
          <div className="pp-profile-rank-meta">
            <span className="pp-profile-level">
              {ranking.score >= 80 ? "Nivel destacado" :
               ranking.score >= 60 ? "Nivel alto" :
               ranking.score >= 40 ? "Nivel en crecimiento" : "Nivel inicial"}
            </span>
            <span>{formatPercentage(ranking.score)}% score</span>
          </div>
        </article>

        <article className="pp-profile-goals-panel">
          <div className="pp-profile-goals-header">
            <h3>Metas de calidad</h3>
            <span>{metrics.goals_achieved || 0}/{goalsTotal}</span>
          </div>
          <div className="pp-profile-goal-bar">
            <div style={{ width: `${goalsProgress}%` }} />
          </div>
          <div className="pp-profile-goal-list">
            {goalItems.map((goal, i) => (
              <span key={i} className={goal.done ? "done" : ""}>
                {goal.done ? <Icons.Check /> : <Icons.Clock />}
                {goal.label}
              </span>
            ))}
          </div>
        </article>
      </div>

      <div className="pp-profile-metrics-grid">
        <ProfileMetricCard icon={<Icons.Check />} label="Ordenes completadas" value={metrics.orders_completed} tone="success" />
        <ProfileMetricCard icon={<Icons.BarChart />} label="Tasa de finalizacion" value={`${formatPercentage(metrics.completion_rate)}%`} tone="info" />
        <ProfileMetricCard icon={<Icons.Package />} label="Ordenes activas" value={metrics.orders_active} tone="warning" />
        <ProfileMetricCard icon={<Icons.Truck />} label="Entregadas" value={metrics.orders_delivered} tone="cyan" />
        <ProfileMetricCard icon={<Icons.AlertCircle />} label="Cancelaciones" value={metrics.orders_cancelled} tone="danger" />
        <ProfileMetricCard icon={<Icons.Clipboard />} label="Total de ordenes" value={metrics.total_orders} />
      </div>

      <section className="pp-profile-analytics">
        <div className="pp-profile-analytics-heading">
          <h3>Analiticas personales</h3>
        </div>

        <div className="pp-profile-analytics-grid">

          <article className="pp-profile-analytics-card">
            <div className="pp-profile-card-heading">
              <div>
                <span className="pp-profile-kicker">Distribucion</span>
                <h4>Normales vs 911</h4>
              </div>
              <strong>{orderTypeRows.reduce((sum, r) => sum + (r.value || 0), 0)}</strong>
            </div>
            {orderTypeRows.length > 0 ? (
              <div className="pp-profile-chart-shell">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={orderTypeRows}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {orderTypeRows.map((_, i) => (
                        <Cell key={i} fill={ORDER_TYPE_COLORS[i % ORDER_TYPE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<AnalyticsTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                {dominantOrderType && (
                  <div className="pp-profile-donut-center">
                    <strong>{formatPercentage(dominantOrderType.percentage)}%</strong>
                    <span>{dominantOrderType.name}</span>
                  </div>
                )}
              </div>
            ) : (
              <AnalyticsEmpty label="Sin datos de ordenes" />
            )}
          </article>

          <article className="pp-profile-analytics-card wide">
            <div className="pp-profile-card-heading">
              <h4>Tendencia de ordenes</h4>
              <div className="pp-profile-trend-tabs">
                {TREND_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    className={trendView === opt.key ? "active" : ""}
                    onClick={() => setTrendView(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {trendData.length > 0 ? (
              <div className="pp-profile-chart-shell">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<AnalyticsTooltip />} />
                    <Line type="monotone" dataKey="count" stroke="#091127" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <AnalyticsEmpty label="Sin datos de tendencia" />
            )}
          </article>

          <article className="pp-profile-analytics-card">
            <div className="pp-profile-card-heading">
              <h4>Materiales mas trabajados</h4>
              <Icons.Package />
            </div>
            <ProgressList items={analytics.top_materials} />
          </article>

          <article className="pp-profile-analytics-card">
            <div className="pp-profile-card-heading">
              <h4>Clientes con mas ordenes</h4>
              <Icons.Users />
            </div>
            <ProgressList items={analytics.top_clients} />
          </article>

          <article className="pp-profile-analytics-card pp-profile-status-summary-card">
            <div className="pp-profile-card-heading">
              <h4>Estado de produccion</h4>
              <Icons.BarChart />
            </div>
            <div className="pp-profile-status-grid">
              {statusCards.map((sc) => (
                <div key={sc.key} className={`pp-profile-status-card ${sc.tone}`}>
                  {sc.icon}
                  <strong>{statusSummary[sc.key] ?? 0}</strong>
                  <small>{sc.label}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="pp-profile-analytics-card pp-profile-status-chart-card">
            <div className="pp-profile-card-heading">
              <h4>Estado de archivos</h4>
              <Icons.BarChart />
            </div>
            {fileStatusRows.length > 0 ? (
              <div className="pp-profile-chart-shell compact">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={fileStatusRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<AnalyticsTooltip />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {fileStatusRows.map((_, i) => (
                        <Cell key={i} fill={FILE_STATUS_COLORS[i % FILE_STATUS_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <AnalyticsEmpty label="Sin datos de archivos" />
            )}
          </article>

        </div>
      </section>
    </section>
  );
}
