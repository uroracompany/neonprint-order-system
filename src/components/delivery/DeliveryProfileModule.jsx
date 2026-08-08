import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Icons } from "../../utils/icons";
import { adminApiFetch } from "../../utils/adminApi";
import useOrdersRealtimeSync from "../../hooks/useOrdersRealtimeSync";
import PaginatedProgressList from "../profile/PaginatedProgressList";
import ProfilePeriodControl from "../profile/ProfilePeriodControl";
import "./DeliveryProfileModule.css";

const EMPTY_ANALYTICS = { status_summary: {}, top_clients: [], trends: [] };
const STATUS_CARDS = [
  { key: "assigned", label: "Asignadas", color: "#2563eb", icon: <Icons.Package /> },
  { key: "pending", label: "Pendientes", color: "#f59e0b", icon: <Icons.Clock /> },
  { key: "delivered", label: "Entregadas", color: "#16a34a", icon: <Icons.CheckCircle /> },
  { key: "overdue", label: "Atrasadas", color: "#dc2626", icon: <Icons.AlertCircle /> },
  { key: "cancelled", label: "Canceladas", color: "#7c3aed", icon: <Icons.X /> },
];

const getInitials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const getDisplayName = (profile, authUser) => profile?.name || authUser?.user_metadata?.display_name || authUser?.email || "Entrega";

function TooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="dlv-profile-tooltip"><strong>{label}</strong><span>{payload[0].value} ordenes</span></div>;
}

export default function DeliveryProfileModule({ authUser, fallbackProfile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("all");
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
      const { response, result } = await adminApiFetch("/api/delivery-profile", { period });
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(result?.error || "No se pudo cargar Mi Perfil.");
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

  useOrdersRealtimeSync({ userId: authUser?.id, scope: "delivery-profile", refreshOrders: () => loadProfile({ silent: true }) });

  const profile = data?.profile || fallbackProfile;
  const analytics = data?.analytics || EMPTY_ANALYTICS;
  const displayName = getDisplayName(profile, authUser);
  const profileEmail = profile?.email || authUser?.email || "Usuario de entrega";
  const isActive = profile?.employment_status !== false;
  const statusCards = STATUS_CARDS.map((card) => ({ ...card, value: analytics.status_summary?.[card.key] || 0 }));

  if (loading) return <section className="dlv-profile"><div className="dlv-profile-loading"><span className="kpi-spinner" />Cargando Mi Perfil...</div></section>;

  return (
    <section className="dlv-profile" aria-labelledby="delivery-profile-title">
      {error && <div className="dlv-profile-error" role="alert"><Icons.AlertCircle />{error}</div>}
      <header className="dlv-profile-hero">
        <div className="dlv-profile-identity">
          <span className="acm-avatar acm-avatar-large">{getInitials(displayName)}</span>
          <div className="dlv-profile-copy">
            <span className="dlv-profile-kicker">Perfil de entrega</span>
            <h2 id="delivery-profile-title">{displayName}</h2>
            <div className="dlv-profile-contact"><Icons.Mail />{profileEmail}</div>
            <div className="dlv-profile-status-line">
              <span className={isActive ? "active" : "inactive"}>{isActive ? "Usuario activo" : "Usuario inactivo"}</span>
              <small>Periodo: {data?.period?.label || "Todo el historial"}</small>
            </div>
          </div>
        </div>
        <ProfilePeriodControl value={period} onChange={setPeriod} />
      </header>

      <div className="dlv-profile-grid">
        <article className="dlv-profile-card wide">
          <div className="dlv-profile-card-heading"><div><span className="dlv-profile-kicker">Estado actual</span><h3>Resumen de ordenes</h3></div><Icons.BarChart /></div>
          <div className="dlv-profile-statuses">{statusCards.map((card) => <div key={card.key} style={{ "--status-color": card.color }}><span>{card.icon}</span><strong>{card.value}</strong><small>{card.label}</small></div>)}</div>
          <div className="dlv-profile-chart">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={statusCards}><CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><Tooltip content={<TooltipContent />} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{statusCards.map((card) => <Cell key={card.key} fill={card.color} />)}</Bar></BarChart></ResponsiveContainer>
          </div>
        </article>
        <article className="dlv-profile-card"><div className="dlv-profile-card-heading"><div><span className="dlv-profile-kicker">Clientes</span><h3>Mas frecuentes</h3></div><Icons.Users /></div><PaginatedProgressList items={analytics.top_clients} emptyLabel="Sin clientes registrados" accent="#0f766e" /></article>
        <article className="dlv-profile-card full"><div className="dlv-profile-card-heading"><div><span className="dlv-profile-kicker">Historial</span><h3>Ordenes asignadas en los ultimos 14 dias</h3></div><Icons.TrendUp /></div><div className="dlv-profile-chart trend">{analytics.trends?.some((row) => row.count > 0) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={analytics.trends}><CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><Tooltip content={<TooltipContent />} /><Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer> : <div className="dlv-profile-empty">Sin actividad en este periodo</div>}</div></article>
      </div>
    </section>
  );
}
