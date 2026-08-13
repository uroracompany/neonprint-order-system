import { useCallback, useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Icons } from "../../utils/icons";
import { adminApiFetch } from "../../utils/adminApi";
import useOrdersRealtimeSync from "../../hooks/useOrdersRealtimeSync";
import ProfilePeriodControl from "../profile/ProfilePeriodControl";
import AdminProfileActivityModal from "./AdminProfileActivityModal";
import "./AdminProfileModule.css";

const EMPTY_METRICS = {
  actions_registered: 0,
  orders_intervened: 0,
  orders_created: 0,
  last_activity_at: null,
};

const EMPTY_ANALYTICS = { trend: [], action_types: [], recent_activity: [] };

const formatDate = (value, options = {}) => {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(date);
};

const getDisplayName = (profile, authUser) => (
  profile?.name
  || authUser?.user_metadata?.display_name
  || authUser?.user_metadata?.full_name
  || authUser?.user_metadata?.name
  || authUser?.email?.split("@")[0]
  || "Administrador"
);

const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

function ActivityTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="apm-chart-tooltip"><strong>{label}</strong><span>{payload[0].value} acciones</span></div>;
}

function ProfileMetric({ icon, label, value, detail, tone = "info" }) {
  return (
    <article className="apm-metric-card">
      <span className={`apm-metric-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

export default function AdminProfileModule({ authUser, profile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("all");
  const [selectedActivity, setSelectedActivity] = useState(null);
  const requestIdRef = useRef(0);
  const blockingRequestIdRef = useRef(null);

  const loadProfile = useCallback(async ({ silent = false } = {}) => {
    if (silent && blockingRequestIdRef.current !== null) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!silent) {
      blockingRequestIdRef.current = requestId;
      setLoading(true);
    }
    setError("");

    try {
      const { response, result } = await adminApiFetch("/api/admin-profile", { period });
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(result?.error || "No se pudo cargar Mi Perfil.");
      if (
        !result?.metrics ||
        !Array.isArray(result?.analytics?.trend) ||
        !Array.isArray(result?.analytics?.action_types) ||
        !Array.isArray(result?.analytics?.recent_activity)
      ) {
        throw new Error("El servidor devolvio una actividad administrativa incompleta.");
      }
      setData(result);
    } catch (requestError) {
      if (requestId === requestIdRef.current) setError(requestError?.message || "No se pudo cargar Mi Perfil.");
    } finally {
      if (!silent && blockingRequestIdRef.current === requestId) {
        blockingRequestIdRef.current = null;
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }
  }, [period]);

  useEffect(() => {
    void loadProfile();
    return () => { requestIdRef.current += 1; };
  }, [loadProfile]);

  useOrdersRealtimeSync({
    userId: authUser?.id,
    scope: "admin-profile",
    refreshOrders: () => loadProfile({ silent: true }),
    tables: ["orders", "order_events"],
  });

  const account = data?.profile || profile || null;
  const metrics = data?.metrics || EMPTY_METRICS;
  const analytics = data?.analytics || EMPTY_ANALYTICS;
  const displayName = getDisplayName(account, authUser);
  const email = account?.email || authUser?.email || "Sin correo registrado";
  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || "";
  const isActive = account?.employment_status !== false && !account?.deleted_at;
  const hasActivity = analytics.trend.some((item) => item.count > 0);

  if (loading) {
    return (
      <section className="apm-profile" aria-labelledby="admin-profile-title">
        <div className="apm-loading"><span className="kpi-spinner" />Cargando Mi Perfil...</div>
      </section>
    );
  }

  if (!data && error) {
    return (
      <section className="apm-profile" aria-labelledby="admin-profile-title">
        <div className="apm-error" role="alert">
          <Icons.AlertCircle />
          <div><strong>No pudimos cargar tu actividad.</strong><span>{error}</span></div>
          <button className="pa-btn secondary apm-retry" onClick={() => loadProfile()}><Icons.Refresh /> Reintentar</button>
        </div>
      </section>
    );
  }

  return (
    <section className="apm-profile" aria-labelledby="admin-profile-title">
      {error && <div className="apm-error compact" role="alert"><Icons.AlertCircle /><span>{error}</span><button className="apm-text-btn" onClick={() => loadProfile()}>Reintentar</button></div>}

      <header className="apm-hero acm-heading">
        <div className="apm-identity">
          {avatarUrl ? <img className="acm-avatar acm-avatar-large apm-avatar" src={avatarUrl} alt={`Foto de ${displayName}`} /> : <span className="acm-avatar acm-avatar-large apm-avatar">{getInitials(displayName)}</span>}
          <div className="apm-identity-copy">
            <div className="apm-name-line"><h2 id="admin-profile-title">{displayName}</h2><span className="ps-badge info apm-role-badge">Administrador</span></div>
            <div className="apm-contact"><span><Icons.Mail /> {email}</span><span><Icons.Calendar /> Registrado el {formatDate(account?.created_at || authUser?.created_at)}</span></div>
            <div className="apm-status-line">
              <span className={`acm-profile-status apm-status ${isActive ? "active" : "inactive"}`}><span />{isActive ? "Usuario activo" : "Usuario inactivo"}</span>
              <small>Periodo: {data?.period?.label || "Todo el historial"}</small>
              <ProfilePeriodControl value={period} onChange={setPeriod} />
            </div>
          </div>
        </div>
      </header>

      <div className="apm-metrics-grid">
        <ProfileMetric icon={<Icons.Clipboard />} label="Acciones registradas" value={metrics.actions_registered} detail="Cambios auditados en órdenes" tone="info" />
        <ProfileMetric icon={<Icons.Orders />} label="Órdenes intervenidas" value={metrics.orders_intervened} detail="Órdenes con actividad propia" tone="violet" />
        <ProfileMetric icon={<Icons.FileText />} label="Órdenes creadas" value={metrics.orders_created} detail="Registradas desde Administración" tone="success" />
        <ProfileMetric icon={<Icons.Clock />} label="Última actividad" value={formatDate(metrics.last_activity_at, { day: "2-digit", month: "short" })} detail={metrics.last_activity_at ? "Acción más reciente" : "Sin actividad registrada"} tone="warning" />
      </div>

      <div className="apm-content-grid">
        <article className="apm-panel apm-panel-wide">
          <div className="apm-panel-head"><div><span>Actividad</span><h3>Acciones de los últimos 14 días</h3></div><Icons.TrendUp /></div>
          <div className="apm-chart">
            {hasActivity ? (
              <ResponsiveContainer width="100%" height="100%"><LineChart data={analytics.trend}><CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><Tooltip content={<ActivityTooltip />} /><Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer>
            ) : <div className="apm-empty"><Icons.TrendUp /><span>Sin actividad registrada en este periodo.</span></div>}
          </div>
        </article>

        <article className="apm-panel">
          <div className="apm-panel-head"><div><span>Distribución</span><h3>Acciones más frecuentes</h3></div><Icons.BarChart /></div>
          {analytics.action_types.length ? (
            <div className="apm-actions-list">{analytics.action_types.map((action) => <div key={action.key}><span>{action.label}</span><strong>{action.count}</strong></div>)}</div>
          ) : <div className="apm-empty compact"><Icons.BarChart /><span>Sin acciones en este periodo.</span></div>}
        </article>

        <article className="apm-panel apm-panel-full">
          <div className="apm-panel-head"><div><span>Historial</span><h3>Actividad administrativa reciente</h3></div><Icons.Clock /></div>
          {analytics.recent_activity.length ? (
            <div className="apm-timeline">{analytics.recent_activity.map((activity) => <button type="button" className="apm-timeline-item" key={activity.id} onClick={() => setSelectedActivity(activity)} aria-label={`Ver detalle: ${activity.label}`}><span className="apm-timeline-icon"><Icons.Clipboard /></span><span className="apm-timeline-copy"><strong>{activity.label}</strong><span>{activity.detail}</span><small>{activity.order_id ? `Orden #${String(activity.order_id).slice(0, 8).toUpperCase()} · ` : ""}{formatDate(activity.created_at, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><Icons.ChevronRight className="apm-timeline-chevron" /></button>)}</div>
          ) : <div className="apm-empty"><Icons.Clock /><span>Aún no hay acciones administrativas para mostrar.</span></div>}
        </article>
      </div>

      <AdminProfileActivityModal activity={selectedActivity} open={Boolean(selectedActivity)} onClose={() => setSelectedActivity(null)} />
    </section>
  );
}
