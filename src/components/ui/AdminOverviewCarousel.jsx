import { useState, useEffect, useCallback, useRef } from "react";
import "../../css-components/page-admin.css";

const SLIDES = [
  {
    id: "operations",
    kicker: "Resumen operativo",
    title: "Accesos rápidos a tus operaciones clave.",
    variant: "operations",
  },
  {
    id: "commercial",
    kicker: "Salud comercial",
    title: "Clientes, créditos y equipo en una sola lectura.",
    variant: "commercial",
  },
  {
    id: "actions",
    kicker: "Acciones rápidas",
    title: "Mueve el trabajo administrativo sin perder contexto.",
    variant: "actions",
  },
  {
    id: "reminders",
    kicker: "Pendientes",
    title: "Alertas que requieren seguimiento.",
    variant: "reminders",
  },
];

const ICONS = {
  orders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>,
  money: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></svg>,
  file: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5" /></svg>,
  brush: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.37 2.63 14 7l3 3 4.37-4.37a2.12 2.12 0 1 0-3-3Z" /><path d="M9 12a5 5 0 0 0-5 5v3h3a5 5 0 0 0 5-5Z" /><path d="m14 7-5 5" /></svg>,
  truck: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17H6V5h11v4h3l2 3v5h-2" /><path d="M14 17h-4" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>,
  lightning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h8l-1 8 11-13h-8l1-7Z" /></svg>,
};

const QUICK_ACTIONS = [
  { label: "Órdenes", tab: "orders", color: "#0f1e40", icon: ICONS.orders },
  { label: "Créditos", tab: "credits", color: "#F59E0B", icon: ICONS.money },
  { label: "Clientes", tab: "clients", color: "#06B6D4", icon: ICONS.users },
  { label: "Materiales", tab: "materials", color: "#8B5CF6", icon: ICONS.file },
  { label: "Empleados", tab: "users", color: "#F97316", icon: ICONS.users },
];

function IconBubble({ icon, color }) {
  return (
    <span className="pa-carousel-compact-icon" style={{ "--item-color": color }}>
      {icon}
    </span>
  );
}

function QuickActionsToolbar({ onNavigate }) {
  return (
    <div className="pa-carousel-quick-actions" aria-label="Acciones rápidas">
      {QUICK_ACTIONS.map(action => (
        <button
          key={action.tab}
          type="button"
          className="pa-carousel-quick-action-btn"
          onClick={() => onNavigate(action.tab)}
          title={`Ir a ${action.label}`}
        >
          <IconBubble icon={action.icon} color={action.color} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function OperationsSlide({ statusItems, loading }) {
  return (
    <div className="pa-carousel-status-strip">
      {statusItems.map(item => (
        <article key={item.label} className="pa-carousel-status-item">
          <IconBubble icon={item.icon} color={item.color} />
          <div>
            <strong>{loading ? "..." : item.value}</strong>
            <span>{item.label}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function CommercialSlide({ clients, profiles, creditPendingInvoicesCount }) {
  const items = [
    { label: "Créditos pendientes", value: creditPendingInvoicesCount, color: "#0f1e40", icon: ICONS.money },
    { label: "Clientes registrados", value: clients.length, color: "#06B6D4", icon: ICONS.users },
    { label: "Empleados", value: profiles.length, color: "#F97316", icon: ICONS.users },
  ];

  return (
    <div className="pa-carousel-commercial-strip">
      {items.map(item => (
        <article key={item.label} className="pa-carousel-commercial-item">
          <IconBubble icon={item.icon} color={item.color} />
          <div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        </article>
      ))}
    </div>
  );
}

function QuickActionsSlide({ onNavigate }) {
  return (
    <div className="pa-carousel-actions-strip">
      {QUICK_ACTIONS.map(action => (
        <button key={action.tab} type="button" className="pa-carousel-action-pill" onClick={() => onNavigate(action.tab)}>
          <IconBubble icon={action.icon} color={action.color} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function RemindersSlide({ orders, creditPendingInvoicesCount, creditPendingClientCount }) {
  const blockedCount = orders.filter(order => order.operational_status === "blocked").length;
  const reviewCount = orders.filter(order => order.commercial_review_required).length;
  const items = [
    { label: "Facturas a crédito", value: creditPendingInvoicesCount, color: "#F59E0B", icon: ICONS.money },
    { label: "Clientes por seguimiento", value: creditPendingClientCount, color: "#06B6D4", icon: ICONS.users },
    { label: "Órdenes bloqueadas", value: blockedCount, color: "#EF4444", icon: ICONS.alert },
    { label: "Revisión comercial", value: reviewCount, color: "#8B5CF6", icon: ICONS.file },
  ];

  return (
    <div className="pa-carousel-reminder-strip">
      {items.map(item => (
        <article key={item.label} className="pa-carousel-reminder-compact">
          <IconBubble icon={item.icon} color={item.color} />
          <div>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        </article>
      ))}
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
  const activeSlide = SLIDES[current];

  const statusItems = [
    { label: "Pendientes", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.PENDING)).length, color: "#F59E0B", icon: ICONS.orders },
    { label: "Caja", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.IN_QUOTE)).length, color: "#06B6D4", icon: ICONS.money },
    { label: "Diseño", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.IN_DESIGN)).length, color: "#8B5CF6", icon: ICONS.file },
    { label: "Producción", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.IN_PRODUCTION)).length, color: "#EF4444", icon: ICONS.brush },
    { label: "Terminación", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.IN_TERMINATION)).length, color: "#EC4899", icon: ICONS.brush },
    { label: "Entrega", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.IN_DELIVERED)).length, color: "#6366F1", icon: ICONS.truck },
    { label: "Completadas", value: orders.filter(order => isOrderStatus?.(order.status, ORDER_STATUS?.IN_COMPLETED)).length, color: "#10B981", icon: ICONS.check },
  ];

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

  const renderSlide = (slide) => {
    if (slide.variant === "operations") {
      return <OperationsSlide statusItems={statusItems} loading={loading} />;
    }
    if (slide.variant === "commercial") {
      return (
        <CommercialSlide
          clients={clients}
          profiles={profiles}
          creditPendingInvoicesCount={creditPendingInvoicesCount}
        />
      );
    }
    if (slide.variant === "actions") {
      return <QuickActionsSlide onNavigate={handleAction} />;
    }
    return (
      <RemindersSlide
        orders={orders}
        creditPendingInvoicesCount={creditPendingInvoicesCount}
        creditPendingClientCount={creditPendingClientCount}
      />
    );
  };

  return (
    <div
      className="pa-overview-carousel pa-overview-carousel-compact"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-label="Resumen operativo"
    >
      <div className="pa-carousel-summary-copy">
        <div className="pa-carousel-summary-text">
          <span className="pa-carousel-kicker">{activeSlide.kicker}</span>
          <h3 className="pa-carousel-title">{activeSlide.title}</h3>
        </div>
        <QuickActionsToolbar onNavigate={handleAction} />
      </div>

      <button type="button" className="pa-carousel-arrow pa-carousel-arrow-left" onClick={goPrev} aria-label="Anterior">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
      </button>

      <div className="pa-carousel-viewport">
        <div className="pa-carousel-slide" data-variant={activeSlide.variant}>
          <div className="pa-carousel-slide-body">
            {renderSlide(activeSlide)}
          </div>
        </div>
      </div>

      <button type="button" className="pa-carousel-arrow pa-carousel-arrow-right" onClick={goNext} aria-label="Siguiente">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </button>

      <div className="pa-carousel-dots" role="tablist">
        {SLIDES.map((slide, idx) => (
          <button
            key={slide.id}
            type="button"
            className={`pa-carousel-dot ${idx === current ? "active" : ""}`}
            onClick={() => goTo(idx)}
            role="tab"
            aria-selected={idx === current}
            aria-label={`Diapositiva ${idx + 1}: ${slide.kicker}`}
          />
        ))}
      </div>
    </div>
  );
}
