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
import "./QuoteProfileModule.css";

const EMPTY_METRICS = {
  total_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  paid_orders: 0,
  partial_paid_orders: 0,
  pending_payment_orders: 0,
  completion_rate: 0,
  cancellation_rate: 0,
  payment_rate: 0,
  clients_served: 0,
  archived_orders: 0,
};

const EMPTY_ANALYTICS = {
  payment_types: { total: 0, rows: [] },
  payment_summary: { pagado: 0, pendiente: 0, parcial: 0, credito_pendiente: 0 },
  top_clients: [],
  trends: { dia: [], "30d": [], "3m": [], mensual: [] },
};

const ROLE_LABELS = { quote: "Caja / Cotizador", admin: "Administrador" };
const TREND_OPTIONS = [
  { key: "dia", label: "Dia" },
  { key: "30d", label: "30 dias" },
  { key: "3m", label: "3 meses" },
  { key: "mensual", label: "Mensual" },
];
const PAYMENT_COLORS = ["#166534", "#dc2626", "#d97706", "#6d28d9"];

const formatPercentage = (value) => Number(value || 0).toLocaleString("es-DO", { maximumFractionDigits: 1 });

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
  || "Cotizador"
);

const formatDate = (value) => {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return date.toLocaleDateString("es-DO", { year: "numeric", month: "short", day: "2-digit" });
};

function ProfileMetricCard({ icon, label, value, sub, tone = "info" }) {
  return (
    <article className="pq-profile-metric-card">
      <span className={`pq-profile-metric-icon ${tone}`}>{icon}</span>
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
    <div className="pq-profile-analytics-empty">
      <Icons.BarChart />
      <span>{label}</span>
    </div>
  );
}

function AnalyticsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="pq-profile-chart-tooltip">
      <strong>{label || item.name}</strong>
      <span>{item.value} ordenes</span>
    </div>
  );
}

function ProgressList({ items, emptyLabel }) {
  if (!items?.length) return <AnalyticsEmpty label={emptyLabel} />;
  return (
    <div className="pq-profile-progress-list">
      {items.map((item) => (
        <div className="pq-profile-progress-row" key={item.name}>
          <div className="pq-profile-progress-top">
            <strong>{item.name}</strong>
            <span>{item.count} ordenes</span>
          </div>
          <div className="pq-profile-progress-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, item.percentage || 0)}%` }} />
          </div>
          <small>{item.percentage || 0}% de participacion</small>
        </div>
      ))}
    </div>
  );
}

export default function QuoteProfileModule({ authUser, fallbackProfile }) {
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
      const { response, result } = await adminApiFetch("/api/quote-profile", { period });
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
    scope: "quote-profile",
    refreshOrders: () => fetchProfile({ silent: true }),
  });

  const profile = data?.profile || fallbackProfile || null;
  const metrics = data?.metrics || EMPTY_METRICS;
  const ranking = data?.ranking || {};
  const analytics = data?.analytics || EMPTY_ANALYTICS;
  const displayName = getDisplayName(profile, authUser);
  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || "";
  const roleLabel = ROLE_LABELS[profile?.role] || profile?.role || "Cotizador";
  const isActive = profile?.employment_status !== false;
  const rankingPosition = ranking.position ? `#${ranking.position}` : "Sin ranking";
  const totalQuotersLabel = ranking.total_quoters ? `de ${ranking.total_quoters}` : "sin equipo activo";
  const trendData = analytics.trends?.[trendView] || [];
  const paymentTypeRows = analytics.payment_types?.rows?.length ? analytics.payment_types.rows : EMPTY_ANALYTICS.payment_types.rows;
  const paymentSummary = analytics.payment_summary || EMPTY_ANALYTICS.payment_summary;

  const goalItems = useMemo(() => ([
    { label: "Actividad activa", done: (metrics.active_orders || 0) > 0 },
    { label: "Pagos confirmados", done: (metrics.payment_rate || 0) >= 70 },
    { label: "Control de cancelaciones", done: (metrics.total_orders || 0) > 0 && (metrics.cancellation_rate || 0) <= 15 },
  ]), [metrics.active_orders, metrics.payment_rate, metrics.total_orders, metrics.cancellation_rate]);

  if (loading) {
    return (
      <section className="pq-profile" aria-labelledby="quote-profile-title">
        <div className="pq-panel pq-profile-loading">
          <div className="kpi-spinner" />
          <span>Cargando Mi Perfil...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="pq-profile" aria-labelledby="quote-profile-title">
      {error && (
        <div className="pq-profile-error" role="alert">
          <Icons.AlertCircle />
          <span>{error}</span>
        </div>
      )}

      <div className="pq-profile-hero">
        <div className="pq-profile-identity">
          {avatarUrl ? (
            <img className="acm-avatar acm-avatar-large pq-profile-photo" src={avatarUrl} alt={`Foto de ${displayName}`} />
          ) : (
            <span className="acm-avatar acm-avatar-large">{getInitials(displayName)}</span>
          )}
          <div className="pq-profile-copy">
            <div className="pq-profile-name-line">
              <h2 id="quote-profile-title">{displayName}</h2>
              <span className="pq-badge info">{roleLabel}</span>
            </div>
            <div className="pq-profile-contact">
              <span><Icons.Mail /> {profile?.email || authUser?.email || "Sin correo"}</span>
              <span><Icons.Calendar /> Registrado el {formatDate(profile?.created_at || authUser?.created_at)}</span>
            </div>
            <div className="pq-profile-status-line">
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

      <div className="pq-profile-layout">
        <article className="pq-profile-ranking-panel">
          <div className="pq-profile-ranking-copy">
            <span className="pq-profile-kicker">Ranking privado</span>
            <h3>Tu posicion actual</h3>
            <p>Calculado con el criterio de Administracion: {ranking.metric_label || "Mejor % Confirmacion de Pago"}.</p>
          </div>
          <div className="pq-profile-rank-display">
            <strong>{rankingPosition}</strong>
            <span>{totalQuotersLabel}</span>
          </div>
          <div className="pq-profile-rank-meta">
            <span className="pq-profile-level"><Icons.TrendUp /> {ranking.score >= 80 ? "Nivel destacado" : ranking.score >= 60 ? "Nivel alto" : ranking.score >= 40 ? "Nivel en crecimiento" : "Nivel inicial"}</span>
            <span>{Number(ranking.score || 0).toLocaleString("es-DO")}% score</span>
          </div>
        </article>

        <article className="pq-profile-goals-panel">
          <div className="pq-profile-goals-header">
            <div>
              <span className="pq-profile-kicker">Objetivos</span>
              <h3>{goalItems.filter((g) => g.done).length}/{goalItems.length} alcanzados</h3>
            </div>
            <strong>{Math.min(100, Math.round((goalItems.filter((g) => g.done).length / goalItems.length) * 100))}%</strong>
          </div>
          <div className="pq-profile-goal-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round((goalItems.filter((g) => g.done).length / goalItems.length) * 100))}%` }} />
          </div>
          <div className="pq-profile-goal-list">
            {goalItems.map((goal) => (
              <span key={goal.label} className={goal.done ? "done" : ""}>
                <Icons.Check /> {goal.label}
              </span>
            ))}
          </div>
        </article>
      </div>

      <div className="pq-profile-metrics-grid">
        <ProfileMetricCard
          icon={<Icons.CheckCircle />}
          label="Pagos confirmados"
          value={metrics.paid_orders || 0}
          sub={`${metrics.payment_rate || 0}% de confirmacion`}
          tone="success"
        />
        <ProfileMetricCard
          icon={<Icons.TrendUp />}
          label="Tasa de confirmacion"
          value={`${metrics.payment_rate || 0}%`}
          sub={`${metrics.paid_orders || 0} de ${metrics.total_orders || 0} ordenes pagadas`}
          tone="cyan"
        />
        <ProfileMetricCard
          icon={<Icons.Clock />}
          label="Pagos pendientes"
          value={metrics.pending_payment_orders || 0}
          sub="Esperando confirmacion"
          tone="warning"
        />
        <ProfileMetricCard
          icon={<Icons.Receipt />}
          label="Pagos parciales"
          value={metrics.partial_paid_orders || 0}
          sub="Abonos parciales registrados"
          tone="violet"
        />
        <ProfileMetricCard
          icon={<Icons.Users />}
          label="Clientes atendidos"
          value={metrics.clients_served || 0}
          sub={`${metrics.archived_orders || 0} ordenes archivadas`}
          tone="danger"
        />
      </div>

      <section className="pq-profile-analytics" aria-labelledby="quote-profile-analytics-title">
        <div className="pq-profile-analytics-heading">
          <div>
            <span className="pq-profile-kicker">Analiticas personales</span>
            <h3 id="quote-profile-analytics-title">Dashboard de rendimiento</h3>
          </div>
          <p>Lectura privada basada solo en tus ordenes.</p>
        </div>

        <div className="pq-profile-analytics-grid">
          <article className="pq-profile-analytics-card">
            <div className="pq-profile-card-heading">
              <div>
                <span className="pq-profile-kicker">Distribucion</span>
                <h4>Tipos de pago</h4>
              </div>
              <strong>{analytics.payment_types?.total || 0}</strong>
            </div>
            {analytics.payment_types?.total > 0 ? (
              <>
                <div className="pq-profile-chart-shell compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentTypeRows}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={44}
                        outerRadius={68}
                        paddingAngle={3}
                      >
                        {paymentTypeRows.map((entry, index) => (
                          <Cell key={entry.name} fill={PAYMENT_COLORS[index % PAYMENT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<AnalyticsTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pq-profile-donut-center" aria-hidden="true">
                    <strong>{paymentTypeRows.length ? formatPercentage(paymentTypeRows[0].percentage) : 0}%</strong>
                    <span>{paymentTypeRows.length ? paymentTypeRows[0].name : "Sin datos"}</span>
                  </div>
                </div>
                <div className="pq-profile-type-list">
                  {paymentTypeRows.map((item, index) => (
                    <span key={item.name}>
                      <i style={{ background: PAYMENT_COLORS[index % PAYMENT_COLORS.length] }} />
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

          <article className="pq-profile-analytics-card wide pq-profile-status-summary-card">
            <div className="pq-profile-card-heading">
              <div>
                <span className="pq-profile-kicker">Estados</span>
                <h4>Resumen de pagos</h4>
              </div>
              <Icons.BarChart />
            </div>
            <div className="pq-profile-status-grid">
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon success"><Icons.CheckCircle /></span>
                <div><strong>{paymentSummary.pagado}</strong><small>Pagado</small></div>
              </div>
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon warning"><Icons.Clock /></span>
                <div><strong>{paymentSummary.pendiente}</strong><small>Pendiente</small></div>
              </div>
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon violet"><Icons.AlertCircle /></span>
                <div><strong>{paymentSummary.parcial}</strong><small>Parcial</small></div>
              </div>
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon danger"><Icons.X /></span>
                <div><strong>{paymentSummary.credito_pendiente}</strong><small>Credito</small></div>
              </div>
            </div>
          </article>

          <article className="pq-profile-analytics-card wide">
            <div className="pq-profile-card-heading">
              <div>
                <span className="pq-profile-kicker">Tendencia</span>
                <h4>Registros de ordenes</h4>
              </div>
              <div className="pq-profile-trend-tabs" role="tablist" aria-label="Rango de tendencia">
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
              <div className="pq-profile-chart-shell">
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

          <article className="pq-profile-analytics-card">
            <div className="pq-profile-card-heading">
              <div>
                <span className="pq-profile-kicker">Clientes</span>
                <h4>Mas frecuentes</h4>
              </div>
              <Icons.Users />
            </div>
            <ProgressList items={analytics.top_clients || []} emptyLabel="Sin clientes frecuentes" />
          </article>

          <article className="pq-profile-analytics-card full pq-profile-status-summary-card">
            <div className="pq-profile-card-heading">
              <div>
                <span className="pq-profile-kicker">Resumen</span>
                <h4>Estados de ordenes</h4>
              </div>
              <Icons.BarChart />
            </div>
            <div className="pq-profile-status-grid">
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon info"><Icons.Clock /></span>
                <div><strong>{metrics.active_orders || 0}</strong><small>Activas</small></div>
              </div>
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon success"><Icons.CheckCircle /></span>
                <div><strong>{metrics.completed_orders || 0}</strong><small>Completadas</small></div>
              </div>
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon warning"><Icons.Clipboard /></span>
                <div><strong>{metrics.total_orders || 0}</strong><small>Total</small></div>
              </div>
              <div className="pq-profile-status-card">
                <span className="pq-profile-metric-icon danger"><Icons.X /></span>
                <div><strong>{metrics.cancelled_orders || 0}</strong><small>Canceladas</small></div>
              </div>
            </div>
            <div className="pq-profile-chart-shell mini">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { label: "Activas", value: metrics.active_orders || 0 },
                    { label: "Completadas", value: metrics.completed_orders || 0 },
                    { label: "Pagadas", value: metrics.paid_orders || 0 },
                    { label: "Canceladas", value: metrics.cancelled_orders || 0 },
                  ]}
                  margin={{ top: 6, right: 6, left: -24, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <Tooltip content={<AnalyticsTooltip />} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#1d4ed8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
