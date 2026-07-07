import { useState, useEffect, useCallback, useRef } from "react";
import "../../css-components/page-admin.css";

const SLIDES = [
  {
    id: "welcome",
    kicker: "Bienvenido",
    title: "Gestiona tu negocio con NeonPrint",
    description: "Supervisa órdenes, clientes, producción y créditos desde un solo lugar.",
    accent: "#091127",
    accentBg: "#E8EDF8",
    variant: "welcome",
    cta: { label: "Ver órdenes", tab: "orders" },
  },
  {
    id: "summary",
    kicker: "Resumen del negocio",
    title: "Estado actual de tus operaciones",
    description: "Mira un vistazo rápido del rendimiento de tu equipo y pedidos.",
    accent: "#091127",
    accentBg: "#E8EDF8",
    variant: "summary",
    cta: { label: "Ver detalles", tab: "orders" },
  },
  {
    id: "actions",
    kicker: "Acciones rápidas",
    title: "¿Qué necesitas hacer hoy?",
    description: "Accede directamente a las funciones más utilizadas del sistema.",
    accent: "#F43F5E",
    accentBg: "#FFE4EA",
    variant: "actions",
  },
  {
    id: "reminders",
    kicker: "Pendientes",
    title: "Recordatorios importantes",
    description: "Revisa las alertas que requieren tu atención.",
    accent: "#F59E0B",
    accentBg: "#FEF3C7",
    variant: "reminders",
    cta: { label: "Revisar créditos", tab: "credits" },
  },
];

function SlideIcon({ variant, accent, accentBg }) {
  return (
    <div className="pa-carousel-icon" style={{ background: accentBg, color: accent }}>
      {variant === "welcome" && (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
      )}
      {variant === "summary" && (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>
      )}
      {variant === "actions" && (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
      )}
      {variant === "reminders" && (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      )}
    </div>
  );
}

function WelcomeSlide({ orders, clients, profiles, creditPendingInvoicesCount }) {
  const stats = [
    { label: "Órdenes", value: orders.length, accent: "#F97316", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg> },
    { label: "Clientes", value: clients.length, accent: "#10B981", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /></svg> },
    { label: "Empleados", value: profiles.length, accent: "#3B82F6", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
    { label: "Crédito pend.", value: creditPendingInvoicesCount, accent: "#8B5CF6", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg> },
  ];

  return (
    <div className="pa-carousel-welcome-stats">
      {stats.map(s => (
        <article key={s.label} className="pa-carousel-welcome-card" style={{ "--card-accent": s.accent }}>
          <div className="pa-carousel-welcome-card-header">
            <span className="pa-carousel-welcome-card-icon" style={{ background: s.accent + "15", color: s.accent }}>
              {s.icon}
            </span>
          </div>
          <span className="pa-carousel-welcome-card-value" style={{ color: s.accent }}>{s.value}</span>
          <span className="pa-carousel-welcome-card-label">{s.label}</span>
        </article>
      ))}
    </div>
  );
}

function SummarySlide({ orders, creditPendingInvoicesCount, loading, isOrderStatus, ORDER_STATUS }) {
  const stats = loading
    ? [
        { label: "Pendientes", value: "—", color: "#F59E0B" },
        { label: "En producción", value: "—", color: "#EF4444" },
        { label: "Completadas", value: "—", color: "#10B981" },
        { label: "Créditos", value: "—", color: "#091127" },
      ]
    : [
        { label: "Pendientes", value: orders.filter(o => isOrderStatus?.(o.status, ORDER_STATUS?.PENDING)).length, color: "#F59E0B" },
        { label: "En producción", value: orders.filter(o => isOrderStatus?.(o.status, ORDER_STATUS?.IN_PRODUCTION)).length, color: "#EF4444" },
        { label: "Completadas", value: orders.filter(o => isOrderStatus?.(o.status, ORDER_STATUS?.IN_COMPLETED)).length, color: "#10B981" },
        { label: "Créditos", value: creditPendingInvoicesCount, color: "#091127" },
      ];

  return (
    <div className="pa-carousel-stats-grid">
      {stats.map(stat => (
        <article key={stat.label} className="pa-carousel-stat" style={{ "--stat-accent": stat.color }}>
          <span className="pa-carousel-stat-value" style={{ color: stat.color }}>{stat.value}</span>
          <span className="pa-carousel-stat-label">{stat.label}</span>
        </article>
      ))}
    </div>
  );
}

function QuickActionsSlide({ onNavigate }) {
  const actions = [
    { label: "Nueva orden", tab: "orders", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>, accent: "#0f1e40" },
    { label: "Registrar cliente", tab: "clients", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>, accent: "#10B981" },
    { label: "Ver empleados", tab: "users", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>, accent: "#F97316" },
    { label: "Ver materiales", tab: "materials", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>, accent: "#8B5CF6" },
  ];

  return (
    <div className="pa-carousel-actions-grid">
      {actions.map(a => (
        <button key={a.tab} type="button" className="pa-carousel-action-btn" onClick={() => onNavigate(a.tab)}>
          <span className="pa-carousel-action-icon" style={{ background: a.accent + "10", color: a.accent }}>{a.icon}</span>
          <span className="pa-carousel-action-label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function RemindersSlide({ orders, creditPendingInvoicesCount, creditPendingClientCount }) {
  const items = [];
  if (creditPendingInvoicesCount > 0) {
    items.push({
      text: `${creditPendingInvoicesCount} factura${creditPendingInvoicesCount === 1 ? "" : "s"} a crédito pendiente`,
      color: "#F59E0B",
      severity: "Medio",
      severityColor: "#F59E0B",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>,
    });
  }
  if (creditPendingClientCount > 0) {
    items.push({
      text: `${creditPendingClientCount} cliente${creditPendingClientCount === 1 ? "" : "s"} requiere seguimiento`,
      color: "#06B6D4",
      severity: "Medio",
      severityColor: "#06B6D4",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
    });
  }
  const blockedCount = orders.filter(o => o.operational_status === "blocked").length;
  if (blockedCount > 0) {
    items.push({
      text: `${blockedCount} orden${blockedCount === 1 ? "" : "es"} bloqueada${blockedCount === 1 ? "" : "s"}`,
      color: "#EF4444",
      severity: "Alto",
      severityColor: "#EF4444",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>,
    });
  }
  const reviewCount = orders.filter(o => o.commercial_review_required).length;
  if (reviewCount > 0) {
    items.push({
      text: `${reviewCount} orden${reviewCount === 1 ? "" : "es"} en revisión comercial`,
      color: "#8B5CF6",
      severity: "Bajo",
      severityColor: "#8B5CF6",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
    });
  }

  return (
    <div className="pa-carousel-reminders">
      {items.length === 0 ? (
        <div className="pa-carousel-reminder-empty">
          <div className="pa-carousel-reminder-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          </div>
          <div>
            <div className="pa-carousel-reminder-empty-text">Todo está al día</div>
            <div className="pa-carousel-reminder-empty-sub">No hay pendientes por ahora</div>
          </div>
        </div>
      ) : (
        <>
          <div className="pa-carousel-reminders-header">
            <span className="pa-carousel-reminders-count">
              <strong>{items.length}</strong> {items.length === 1 ? "pendiente" : "pendientes"}
            </span>
          </div>
          {items.map((item, i) => (
            <div key={i} className="pa-carousel-reminder-item" style={{ borderLeftColor: item.color }}>
              <span className="pa-carousel-reminder-icon" style={{ background: item.color + "15", color: item.color }}>
                {item.icon}
              </span>
              <div className="pa-carousel-reminder-content">
                <span className="pa-carousel-reminder-text">{item.text}</span>
                <span className="pa-carousel-reminder-severity" style={{ background: item.severityColor + "15", color: item.severityColor }}>
                  {item.severity}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function AdminOverviewCarousel({
  onNavigate,
  orders = [],
  creditPendingInvoicesCount = 0,
  creditPendingClientCount = 0,
  loading = false,
  isOrderStatus,
  ORDER_STATUS,
  profiles = [],
  clients = [],
}) {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef(null);
  const total = SLIDES.length;

  const goNext = useCallback(() => {
    setCurrent(prev => (prev + 1) % total);
  }, [total]);

  const goPrev = useCallback(() => {
    setCurrent(prev => (prev - 1 + total) % total);
  }, [total]);

  const goTo = useCallback((idx) => {
    setCurrent(idx);
  }, []);

  useEffect(() => {
    if (isPaused) {
      clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(goNext, 6000);
    return () => clearInterval(intervalRef.current);
  }, [isPaused, goNext]);

  const handleAction = (tab) => {
    if (tab && onNavigate) onNavigate(tab);
  };

  return (
    <div
      className="pa-overview-carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-label="Panel informativo"
    >
      <div className="pa-carousel-viewport">
        <div className="pa-carousel-track" style={{ transform: `translateX(-${current * 100}%)` }}>
          {SLIDES.map((s, idx) => (
            <div key={s.id} className="pa-carousel-slide" data-variant={s.variant} aria-hidden={idx !== current}>
              <div
                className="pa-carousel-slide-body"
                style={{
                  "--carousel-accent": s.accent,
                  "--carousel-accent-soft": s.accentBg,
                }}
              >
                <div className="pa-carousel-slide-header">
                  <SlideIcon variant={s.variant} accent={s.accent} accentBg={s.accentBg} />
                  <div className="pa-carousel-slide-text">
                    <span className="pa-carousel-kicker">{s.kicker}</span>
                    <h3 className="pa-carousel-title">{s.title}</h3>
                    <p className="pa-carousel-description">{s.description}</p>
                  </div>
                </div>

                <div className="pa-carousel-slide-body-content">
                  {s.variant === "welcome" && (
                    <WelcomeSlide
                      orders={orders}
                      clients={clients}
                      profiles={profiles}
                      creditPendingInvoicesCount={creditPendingInvoicesCount}
                    />
                  )}

                  {s.variant === "summary" && (
                    <SummarySlide
                      orders={orders}
                      creditPendingInvoicesCount={creditPendingInvoicesCount}
                      loading={loading}
                      isOrderStatus={isOrderStatus}
                      ORDER_STATUS={ORDER_STATUS}
                    />
                  )}

                  {s.variant === "actions" && (
                    <QuickActionsSlide onNavigate={handleAction} />
                  )}

                  {s.variant === "reminders" && (
                    <RemindersSlide
                      orders={orders}
                      creditPendingInvoicesCount={creditPendingInvoicesCount}
                      creditPendingClientCount={creditPendingClientCount}
                    />
                  )}

                  {s.cta && (
                    <button
                      type="button"
                      className="pa-carousel-cta"
                      onClick={() => handleAction(s.cta.tab)}
                      style={{ background: s.accent }}
                    >
                      {s.cta.label}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button type="button" className="pa-carousel-arrow pa-carousel-arrow-left" onClick={goPrev} aria-label="Anterior">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      <button type="button" className="pa-carousel-arrow pa-carousel-arrow-right" onClick={goNext} aria-label="Siguiente">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      <div className="pa-carousel-dots" role="tablist">
        {SLIDES.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            className={`pa-carousel-dot ${idx === current ? "active" : ""}`}
            onClick={() => goTo(idx)}
            role="tab"
            aria-selected={idx === current}
            aria-label={`Diapositiva ${idx + 1}: ${s.kicker}`}
          />
        ))}
      </div>
    </div>
  );
}
