import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Icons } from "../../utils/icons";
import { adminApiFetch } from "../../utils/adminApi";
import useOrdersRealtimeSync from "../../hooks/useOrdersRealtimeSync";
import ProfilePeriodControl from "../profile/ProfilePeriodControl";
import PaginatedProgressList from "../profile/PaginatedProgressList";

const EMPTY_METRICS = {
  total_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  delivered_orders: 0,
  completion_rate: 0,
  cancellation_rate: 0,
  goals_achieved: 0,
};

const EMPTY_ANALYTICS = {
  order_types: {
    total: 0,
    normal: { label: "Normales", count: 0, percentage: 0 },
    urgent: { label: "911", count: 0, percentage: 0 },
    rows: [],
  },
  trends: {
    dia: [],
    "30d": [],
    "3m": [],
    mensual: [],
  },
  top_designer: { name: "Sin asignaciones", count: 0, percentage: 0 },
  top_materials: [],
  top_clients: [],
  status_summary: {
    active: 0,
    completed: 0,
    pending: 0,
    cancelled: 0,
    overdue: 0,
    returned: 0,
  },
};

const ROLE_LABELS = {
  seller: "Vendedor",
  admin: "Administrador",
};

const TREND_OPTIONS = [
  { key: "dia", label: "Dia" },
  { key: "30d", label: "30 dias" },
  { key: "3m", label: "3 meses" },
  { key: "mensual", label: "Mensual" },
];

const ORDER_TYPE_COLORS = ["#1d4ed8", "#dc2626"];

const formatPercentage = (value) => Number(value || 0).toLocaleString("es-DO", { maximumFractionDigits: 1 });

const getDominantOrderType = (rows) => (rows || []).reduce((dominant, item) => (
  (item.percentage || 0) > (dominant.percentage || 0) ? item : dominant
), rows?.[0] || { name: "Sin datos", percentage: 0 });

const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

const getDisplayName = (profile, authUser) => (
  profile?.name
  || authUser?.user_metadata?.display_name
  || authUser?.user_metadata?.full_name
  || authUser?.user_metadata?.name
  || authUser?.email?.split("@")[0]
  || "Vendedor"
);

const formatDate = (value) => {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return date.toLocaleDateString("es-DO", { year: "numeric", month: "short", day: "2-digit" });
};

function ProfileMetricCard({ icon, label, value, sub, tone = "info" }) {
  return (
    <article className="ps-profile-metric-card">
      <span className={`ps-profile-metric-icon ${tone}`}>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </article>
  );
}

function AnalyticsEmpty({ label = "Sin datos suficientes" }) {
  return (
    <div className="ps-profile-analytics-empty">
      <Icons.BarChart />
      <span>{label}</span>
    </div>
  );
}

function AnalyticsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="ps-profile-chart-tooltip">
      <strong>{label || item.name}</strong>
      <span>{item.value} ordenes</span>
    </div>
  );
}

export default function SellerProfileModule({ authUser, fallbackProfile }) {
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
      const { response, result } = await adminApiFetch("/api/seller-profile", { period });
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
    scope: "seller-profile",
    refreshOrders: () => fetchProfile({ silent: true }),
  });

  const profile = data?.profile || fallbackProfile || null;
  const metrics = data?.metrics || EMPTY_METRICS;
  const ranking = data?.ranking || {};
  const analytics = data?.analytics || EMPTY_ANALYTICS;
  const displayName = getDisplayName(profile, authUser);
  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || "";
  const roleLabel = ROLE_LABELS[profile?.role] || profile?.role || "Vendedor";
  const isActive = profile?.employment_status !== false;
  const goalsTotal = 3;
  const goalsProgress = Math.min(100, Math.round(((metrics.goals_achieved || 0) / goalsTotal) * 100));
  const rankingPosition = ranking.position ? `#${ranking.position}` : "Sin ranking";
  const totalSellersLabel = ranking.total_sellers ? `de ${ranking.total_sellers}` : "sin equipo activo";
  const trendData = analytics.trends?.[trendView] || [];
  const orderTypeRows = analytics.order_types?.rows?.length
    ? analytics.order_types.rows
    : EMPTY_ANALYTICS.order_types.rows;
  const dominantOrderType = getDominantOrderType(orderTypeRows);
  const topDesigner = analytics.top_designer || EMPTY_ANALYTICS.top_designer;
  const statusSummary = analytics.status_summary || EMPTY_ANALYTICS.status_summary;
  const statusCards = [
    { key: "active", label: "Activas", value: statusSummary.active || 0, tone: "info", icon: <Icons.Clock /> },
    { key: "completed", label: "Completadas", value: statusSummary.completed || 0, tone: "success", icon: <Icons.CheckCircle /> },
    { key: "pending", label: "Pendientes", value: statusSummary.pending || 0, tone: "warning", icon: <Icons.Clipboard /> },
    { key: "cancelled", label: "Canceladas", value: statusSummary.cancelled || 0, tone: "danger", icon: <Icons.X /> },
    { key: "overdue", label: "Atrasadas", value: statusSummary.overdue || 0, tone: "warning", icon: <Icons.AlertCircle /> },
    { key: "returned", label: "Devueltas", value: statusSummary.returned || 0, tone: "violet", icon: <Icons.ArrowLeft /> },
  ];

  const goalItems = useMemo(() => ([
    { label: "Actividad mensual", done: (metrics.total_orders || 0) > 0 },
    { label: "Finalizacion saludable", done: (metrics.total_orders || 0) > 0 && (metrics.completion_rate || 0) >= 70 },
    { label: "Cancelacion controlada", done: (metrics.total_orders || 0) > 0 && (metrics.cancellation_rate || 0) <= 15 },
  ]), [metrics.cancellation_rate, metrics.completion_rate, metrics.total_orders]);

  if (loading) {
    return (
      <section className="ps-profile" aria-labelledby="seller-profile-title">
        <div className="ps-panel ps-profile-loading">
          <div className="kpi-spinner" />
          <span>Cargando Mi Perfil...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="ps-profile" aria-labelledby="seller-profile-title">
      {error && (
        <div className="ps-profile-error" role="alert">
          <Icons.AlertCircle />
          <span>{error}</span>
        </div>
      )}

      <div className="ps-profile-hero">
        <div className="ps-profile-identity">
          {avatarUrl ? (
            <img className="acm-avatar acm-avatar-large ps-profile-photo" src={avatarUrl} alt={`Foto de ${displayName}`} />
          ) : (
            <span className="acm-avatar acm-avatar-large">{getInitials(displayName)}</span>
          )}
          <div className="ps-profile-copy">
            <div className="ps-profile-name-line">
              <h2 id="seller-profile-title">{displayName}</h2>
              <span className="ps-badge info">{roleLabel}</span>
            </div>
            <div className="ps-profile-contact">
              <span><Icons.Mail /> {profile?.email || authUser?.email || "Sin correo"}</span>
              <span><Icons.Calendar /> Registrado el {formatDate(profile?.created_at || authUser?.created_at)}</span>
            </div>
            <div className="ps-profile-status-line">
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

      <div className="ps-profile-layout">
        <article className="ps-profile-ranking-panel">
          <div className="ps-profile-ranking-copy">
            <span className="ps-profile-kicker">Ranking privado</span>
            <h3>Tu posicion actual</h3>
            <p>Calculado con el criterio de Administracion: {ranking.metric_label || "Mejor % Finalizacion"}.</p>
          </div>
          <div className="ps-profile-rank-display">
            <strong>{rankingPosition}</strong>
            <span>{totalSellersLabel}</span>
          </div>
          <div className="ps-profile-rank-meta">
            <span className="ps-profile-level"><Icons.TrendUp /> {ranking.level || "Sin ranking"}</span>
            <span>{Number(ranking.score || 0).toLocaleString("es-DO")}% score</span>
          </div>
        </article>

        <article className="ps-profile-goals-panel">
          <div className="ps-profile-goals-header">
            <div>
              <span className="ps-profile-kicker">Objetivos</span>
              <h3>{metrics.goals_achieved || 0}/{goalsTotal} alcanzados</h3>
            </div>
            <strong>{goalsProgress}%</strong>
          </div>
          <div className="ps-profile-goal-bar" aria-hidden="true">
            <span style={{ width: `${goalsProgress}%` }} />
          </div>
          <div className="ps-profile-goal-list">
            {goalItems.map((goal) => (
              <span key={goal.label} className={goal.done ? "done" : ""}>
                <Icons.Check /> {goal.label}
              </span>
            ))}
          </div>
        </article>
      </div>

      <div className="ps-profile-metrics-grid">
        <ProfileMetricCard
          icon={<Icons.CheckCircle />}
          label="Ordenes completadas"
          value={metrics.completed_orders || 0}
          sub={`${metrics.completion_rate || 0}% de finalizacion`}
          tone="success"
        />
        <ProfileMetricCard
          icon={<Icons.TrendUp />}
          label="Tasa de finalizacion"
          value={`${metrics.completion_rate || 0}%`}
          sub={`${metrics.completed_orders || 0} de ${metrics.total_orders || 0} ordenes completadas`}
          tone="cyan"
        />
        <ProfileMetricCard
          icon={<Icons.Clock />}
          label="Ordenes activas"
          value={metrics.active_orders || 0}
          sub={`${metrics.total_orders || 0} ordenes en el periodo`}
          tone="warning"
        />
        <ProfileMetricCard
          icon={<Icons.Truck />}
          label="Ordenes entregadas"
          value={metrics.delivered_orders || 0}
          sub="Cerradas con entrega"
          tone="info"
        />
        <ProfileMetricCard
          icon={<Icons.X />}
          label="Cancelaciones"
          value={metrics.cancelled_orders || 0}
          sub={`${metrics.cancellation_rate || 0}% de cancelacion`}
          tone="danger"
        />
        <ProfileMetricCard
          icon={<Icons.BarChart />}
          label="Total de ordenes"
          value={metrics.total_orders || 0}
          sub={data?.period?.label || "Todo el historial"}
          tone="violet"
        />
      </div>

      <section className="ps-profile-analytics" aria-labelledby="seller-profile-analytics-title">
        <div className="ps-profile-analytics-heading">
          <div>
            <span className="ps-profile-kicker">Analiticas personales</span>
            <h3 id="seller-profile-analytics-title">Dashboard de rendimiento</h3>
          </div>
          <p>Lectura privada basada solo en tus ordenes.</p>
        </div>

        <div className="ps-profile-analytics-grid">
          <article className="ps-profile-analytics-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Distribucion</span>
                <h4>Normales vs 911</h4>
              </div>
              <strong>{analytics.order_types?.total || 0}</strong>
            </div>
            {analytics.order_types?.total > 0 ? (
              <>
                <div className="ps-profile-chart-shell compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={orderTypeRows}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={44}
                        outerRadius={68}
                        paddingAngle={3}
                      >
                        {orderTypeRows.map((entry, index) => (
                          <Cell key={entry.name} fill={ORDER_TYPE_COLORS[index % ORDER_TYPE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<AnalyticsTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="ps-profile-donut-center" aria-hidden="true">
                    <strong>{formatPercentage(dominantOrderType.percentage)}%</strong>
                    <span>{dominantOrderType.name}</span>
                  </div>
                </div>
                <div className="ps-profile-type-list">
                  {orderTypeRows.map((item, index) => (
                    <span key={item.name}>
                      <i style={{ background: ORDER_TYPE_COLORS[index % ORDER_TYPE_COLORS.length] }} />
                      {item.name}
                      <strong>{item.value}</strong>
                      <small>{item.percentage}%</small>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <AnalyticsEmpty label="Aun no hay ordenes para comparar" />
            )}
          </article>

          <article className="ps-profile-analytics-card wide">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Tendencia</span>
                <h4>Registros de ordenes</h4>
              </div>
              <div className="ps-profile-trend-tabs" role="tablist" aria-label="Rango de tendencia">
                {TREND_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    className={trendView === option.key ? "active" : ""}
                    onClick={() => setTrendView(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {trendData.some((item) => item.count > 0) ? (
              <div className="ps-profile-chart-shell">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <Tooltip content={<AnalyticsTooltip />} />
                    <Line type="monotone" dataKey="count" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <AnalyticsEmpty label="Sin registros en este rango" />
            )}
          </article>

          <article className="ps-profile-analytics-card ps-profile-designer-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Asignaciones</span>
                <h4>Disenador mas asignado</h4>
              </div>
              <Icons.Brush />
            </div>
            <div className="ps-profile-designer-body">
              <span className="acm-avatar acm-avatar-small">{getInitials(topDesigner.name)}</span>
              <div>
                <strong>{topDesigner.name}</strong>
                <span>{topDesigner.count || 0} ordenes asignadas</span>
              </div>
            </div>
            <div className="ps-profile-progress-track designer" aria-hidden="true">
              <span style={{ width: `${Math.min(100, topDesigner.percentage || 0)}%` }} />
            </div>
            <small>{topDesigner.percentage || 0}% respecto a tus ordenes del mes</small>
          </article>

          <article className="ps-profile-analytics-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Materiales</span>
                <h4>Mas utilizados</h4>
              </div>
              <Icons.Package />
            </div>
            <PaginatedProgressList items={analytics.top_materials || []} emptyLabel="Sin materiales registrados" accent="#1d4ed8" />
          </article>

          <article className="ps-profile-analytics-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Clientes</span>
                <h4>Mas frecuentes</h4>
              </div>
              <Icons.Users />
            </div>
            <PaginatedProgressList items={analytics.top_clients || []} emptyLabel="Sin clientes frecuentes" accent="#0f766e" />
          </article>

          <article className="ps-profile-analytics-card full ps-profile-status-summary-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Estados</span>
                <h4>Resumen de ordenes</h4>
              </div>
              <Icons.BarChart />
            </div>
            <div className="ps-profile-status-grid">
              {statusCards.map((item) => (
                <div className="ps-profile-status-card" key={item.key}>
                  <span className={`ps-profile-metric-icon ${item.tone}`}>{item.icon}</span>
                  <div>
                    <strong>{item.value}</strong>
                    <small>{item.label}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="ps-profile-chart-shell mini">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusCards} margin={{ top: 6, right: 6, left: -24, bottom: 0 }}>
                  <CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <Tooltip content={<AnalyticsTooltip />} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {statusCards.map((item) => (
                      <Cell key={item.key} fill={{ info: "#2563eb", success: "#16a34a", warning: "#f59e0b", danger: "#dc2626", violet: "#7c3aed" }[item.tone]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
