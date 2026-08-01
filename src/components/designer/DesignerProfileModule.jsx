import { useEffect, useMemo, useState } from "react";
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

const EMPTY_METRICS = {
  total_orders: 0,
  assigned_orders: 0,
  ready_to_quote_orders: 0,
  returned_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  delivered_orders: 0,
  files_created: 0,
  classified_files: 0,
  preview_orders: 0,
  ready_to_quote_rate: 0,
  return_rate: 0,
  classification_rate: 0,
  preview_coverage_rate: 0,
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
  top_materials: [],
  top_clients: [],
  top_production_areas: [],
  production_file_status: {
    total: 0,
    pending: 0,
    in_production: 0,
    in_termination: 0,
    completed: 0,
    rows: [],
  },
  status_summary: {
    active: 0,
    completed: 0,
    pending: 0,
    cancelled: 0,
    overdue: 0,
  },
};

const ROLE_LABELS = {
  designer: "Disenador",
  admin: "Administrador",
};

const TREND_OPTIONS = [
  { key: "dia", label: "Dia" },
  { key: "30d", label: "30 dias" },
  { key: "3m", label: "3 meses" },
  { key: "mensual", label: "Mensual" },
];

const ORDER_TYPE_COLORS = ["#1d4ed8", "#dc2626"];
const FILE_STATUS_COLORS = ["#f59e0b", "#06b6d4", "#8b5cf6", "#10b981"];

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
  || "Disenador"
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
  const unit = item.payload?.unit || "ordenes";
  return (
    <div className="ps-profile-chart-tooltip">
      <strong>{label || item.name}</strong>
      <span>{item.value} {unit}</span>
    </div>
  );
}

function ProgressList({ items, emptyLabel, unit = "ordenes" }) {
  if (!items?.length) return <AnalyticsEmpty label={emptyLabel} />;

  return (
    <div className="ps-profile-progress-list">
      {items.map((item) => (
        <div className="ps-profile-progress-row" key={item.name}>
          <div className="ps-profile-progress-top">
            <strong>{item.name}</strong>
            <span>{item.count} {unit}</span>
          </div>
          <div className="ps-profile-progress-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, item.percentage || 0)}%` }} />
          </div>
          <small>{item.percentage || 0}% de participacion</small>
        </div>
      ))}
    </div>
  );
}

export default function DesignerProfileModule({ authUser, fallbackProfile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trendView, setTrendView] = useState("30d");

  useEffect(() => {
    let cancelled = false;

    async function fetchProfile() {
      setLoading(true);
      setError("");
      try {
        const { response, result } = await adminApiFetch("/api/designer-profile", {});
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(result?.error || "No se pudo cargar Mi Perfil.");
        }
        setData(result);
      } catch (err) {
        if (!cancelled) setError(err?.message || "No se pudo cargar Mi Perfil.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfile();
    return () => { cancelled = true; };
  }, []);

  const profile = data?.profile || fallbackProfile || null;
  const metrics = data?.metrics || EMPTY_METRICS;
  const ranking = data?.ranking || {};
  const analytics = data?.analytics || EMPTY_ANALYTICS;
  const displayName = getDisplayName(profile, authUser);
  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || "";
  const roleLabel = ROLE_LABELS[profile?.role] || profile?.role || "Disenador";
  const isActive = profile?.employment_status !== false;
  const goalsTotal = 4;
  const goalsProgress = Math.min(100, Math.round(((metrics.goals_achieved || 0) / goalsTotal) * 100));
  const rankingPosition = ranking.position ? `#${ranking.position}` : "Sin ranking";
  const totalDesignersLabel = ranking.total_designers ? `de ${ranking.total_designers}` : "sin equipo activo";
  const trendData = analytics.trends?.[trendView] || [];
  const orderTypeRows = analytics.order_types?.rows?.length
    ? analytics.order_types.rows
    : EMPTY_ANALYTICS.order_types.rows;
  const dominantOrderType = getDominantOrderType(orderTypeRows);
  const statusSummary = analytics.status_summary || EMPTY_ANALYTICS.status_summary;
  const fileStatusRows = (analytics.production_file_status?.rows || []).map((item) => ({ ...item, unit: "archivos" }));
  const statusCards = [
    { key: "active", label: "Activas en flujo", value: statusSummary.active || 0, tone: "info", icon: <Icons.Brush /> },
    { key: "ready", label: "Listas para caja", value: metrics.ready_to_quote_orders || 0, tone: "success", icon: <Icons.CheckCircle /> },
    { key: "returned", label: "Devueltas", value: metrics.returned_orders || 0, tone: "danger", icon: <Icons.X /> },
    { key: "completed", label: "Completadas", value: statusSummary.completed || 0, tone: "cyan", icon: <Icons.Truck /> },
    { key: "overdue", label: "Atrasadas", value: statusSummary.overdue || 0, tone: "violet", icon: <Icons.AlertCircle /> },
  ];

  const goalItems = useMemo(() => ([
    { label: "Actividad de diseño", done: (metrics.assigned_orders || metrics.total_orders || 0) > 0 },
    { label: "Avance limpio a caja", done: (metrics.assigned_orders || 0) > 0 && (metrics.ready_to_quote_rate || 0) >= 70 },
    { label: "Devoluciones controladas", done: (metrics.assigned_orders || 0) > 0 && (metrics.return_rate || 0) <= 15 },
    { label: "Archivos clasificados", done: (metrics.files_created || 0) > 0 && (metrics.classification_rate || 0) >= 90 },
  ]), [
    metrics.assigned_orders,
    metrics.classification_rate,
    metrics.files_created,
    metrics.ready_to_quote_rate,
    metrics.return_rate,
    metrics.total_orders,
  ]);

  if (loading) {
    return (
      <section className="ps-profile" aria-labelledby="designer-profile-title">
        <div className="ps-panel ps-profile-loading">
          <div className="kpi-spinner" />
          <span>Cargando Mi Perfil...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="ps-profile" aria-labelledby="designer-profile-title">
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
              <h2 id="designer-profile-title">{displayName}</h2>
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
              <small>Periodo: {data?.period?.label || "Mes actual"}</small>
            </div>
          </div>
        </div>
      </div>

      <div className="ps-profile-layout">
        <article className="ps-profile-ranking-panel">
          <div className="ps-profile-ranking-copy">
            <span className="ps-profile-kicker">Ranking privado</span>
            <h3>Tu avance de diseño</h3>
            <p>Calculado por avance a caja, devoluciones y archivos clasificados.</p>
          </div>
          <div className="ps-profile-rank-display">
            <strong>{rankingPosition}</strong>
            <span>{totalDesignersLabel}</span>
          </div>
          <div className="ps-profile-rank-meta">
            <span className="ps-profile-level"><Icons.TrendUp /> {ranking.level || "Sin ranking"}</span>
            <span>{Number(ranking.score || 0).toLocaleString("es-DO")}% score</span>
          </div>
        </article>

        <article className="ps-profile-goals-panel">
          <div className="ps-profile-goals-header">
            <div>
              <span className="ps-profile-kicker">Calidad de entrega</span>
              <h3>{metrics.goals_achieved || 0}/{goalsTotal} criterios al dia</h3>
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
          icon={<Icons.Brush />}
          label="Diseños trabajados"
          value={metrics.assigned_orders || metrics.total_orders || 0}
          sub={`${metrics.active_orders || 0} siguen activos en el flujo`}
          tone="info"
        />
        <ProfileMetricCard
          icon={<Icons.CheckCircle />}
          label="Listos para caja"
          value={metrics.ready_to_quote_orders || 0}
          sub={`${metrics.ready_to_quote_rate || 0}% de avance limpio`}
          tone="success"
        />
        <ProfileMetricCard
          icon={<Icons.File />}
          label="Archivos generados"
          value={metrics.files_created || 0}
          sub={`${metrics.classified_files || 0} clasificados para produccion`}
          tone="cyan"
        />
        <ProfileMetricCard
          icon={<Icons.Image />}
          label="Preview cargada"
          value={`${metrics.preview_coverage_rate || 0}%`}
          sub={`${metrics.preview_orders || 0} ordenes con vista previa`}
          tone="violet"
        />
        <ProfileMetricCard
          icon={<Icons.X />}
          label="Devueltas para correccion"
          value={metrics.returned_orders || 0}
          sub={`${metrics.return_rate || 0}% de retorno`}
          tone="danger"
        />
        <ProfileMetricCard
          icon={<Icons.Package />}
          label="Clasificacion"
          value={`${metrics.classification_rate || 0}%`}
          sub="Archivos con area de produccion"
          tone="warning"
        />
      </div>

      <section className="ps-profile-analytics" aria-labelledby="designer-profile-analytics-title">
        <div className="ps-profile-analytics-heading">
          <div>
            <span className="ps-profile-kicker">Analiticas personales</span>
            <h3 id="designer-profile-analytics-title">Panel de trabajo de diseño</h3>
          </div>
          <p>Lectura privada basada solo en tus ordenes y archivos.</p>
        </div>

        <div className="ps-profile-analytics-grid">
          <article className="ps-profile-analytics-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Prioridad</span>
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
                <span className="ps-profile-kicker">Carga creativa</span>
                <h4>Ordenes asignadas</h4>
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

          <article className="ps-profile-analytics-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Produccion</span>
                <h4>Areas mas usadas</h4>
              </div>
              <Icons.Package />
            </div>
            <ProgressList items={analytics.top_production_areas || []} emptyLabel="Sin archivos clasificados" unit="archivos" />
          </article>

          <article className="ps-profile-analytics-card">
            <div className="ps-profile-card-heading">
              <div>
                <span className="ps-profile-kicker">Materiales</span>
                <h4>Mas trabajados</h4>
              </div>
              <Icons.Brush />
          </div>
          <ProgressList items={analytics.top_materials || []} emptyLabel="Sin materiales registrados" unit="usos" />
        </article>

        <article className="ps-profile-analytics-card">
          <div className="ps-profile-card-heading">
            <div>
              <span className="ps-profile-kicker">CLIENTES</span>
              <h4>Con mas diseños</h4>
            </div>
            <Icons.Users />
          </div>
          <ProgressList items={analytics.top_clients || []} emptyLabel="Sin clientes frecuentes" unit="diseños" />
        </article>

        <article className="ps-profile-analytics-card full ps-profile-status-summary-card">
          <div className="ps-profile-card-heading">
            <div>
              <span className="ps-profile-kicker">Archivos</span>
                <h4>Estado de produccion</h4>
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
            {fileStatusRows.some((item) => item.value > 0) ? (
              <div className="ps-profile-chart-shell mini">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fileStatusRows} margin={{ top: 6, right: 6, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <Tooltip content={<AnalyticsTooltip />} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {fileStatusRows.map((entry, index) => (
                        <Cell key={entry.key} fill={FILE_STATUS_COLORS[index % FILE_STATUS_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <AnalyticsEmpty label="Sin archivos de produccion en el periodo" />
            )}
          </article>
        </div>
      </section>
    </section>
  );
}
