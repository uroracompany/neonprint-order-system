import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { FlowTrackClient } from "../components/FlowTrackClient";
import useFlowTrackerRealtime from "../hooks/useFlowTrackerRealtime";
import NeonLogo from "../assets/images/logo-neonprint.jpg";
import {
  getOrderStatusConfig,
  PAYMENT_COLORS,
  formatDate,
} from "../utils/constants";
import "../css-components/flowtrack-client.css";

const PAGE_TITLE = "FlowTrack - NeonPrint";

export default function PageTracking() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const retryDelayRef = useRef(60_000);

  const fetchData = useCallback(async () => {
    if (!token || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (!hasLoadedRef.current) setLoading(true);
      setError(null);
      const response = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) {
          setError("ORDEN_NO_ENCONTRADA");
          return;
        }
        throw new Error(body?.error || "No se pudo obtener el seguimiento.");
      }
      const orderItem = body?.order;
      if (!orderItem) {
        setError("ORDEN_NO_ENCONTRADA");
        return;
      }
      setOrder(orderItem);
      setEvents(Array.isArray(body?.events) ? body.events : []);
      retryDelayRef.current = 60_000;
    } catch (err) {
      console.error("FlowTrack error:", err);
      setError("ERROR");
      retryDelayRef.current = Math.min(retryDelayRef.current * 2, 5 * 60_000);
    } finally {
      setLoading(false);
      hasLoadedRef.current = true;
      inFlightRef.current = false;
    }
  }, [token]);

  useFlowTrackerRealtime({ token, onChange: fetchData });

  useEffect(() => {
    hasLoadedRef.current = false;
    retryDelayRef.current = 60_000;
    setOrder(null);
    setEvents([]);
    setError(null);
    setLoading(true);
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    document.title = order ? "FlowTrack - Tu pedido" : PAGE_TITLE;
  }, [order]);

  useEffect(() => {
    let timeout;
    const schedule = () => {
      timeout = window.setTimeout(async () => {
        if (!document.hidden) await fetchData();
        schedule();
      }, retryDelayRef.current);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) void fetchData();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchData]);

  if (loading && !order) {
    return (
      <div className="ft-page">
        <div className="ft-container">
          <div className="ft-loading">
            <div className="ft-loading-spinner" />
            <p>Cargando seguimiento...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error === "ORDEN_NO_ENCONTRADA") {
    return (
      <div className="ft-page">
        <div className="ft-container">
          <div className="ft-error-card">
            <div className="ft-error-icon">🔍</div>
            <h2>Orden no encontrada</h2>
            <p>El enlace de seguimiento no es válido o la orden ya no está disponible.</p>
            <p className="ft-error-hint">Verifica el enlace o contacta al vendedor.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ft-page">
        <div className="ft-container">
          <div className="ft-error-card">
            <div className="ft-error-icon">⚠️</div>
            <h2>Error al cargar</h2>
            <p>No pudimos obtener la información de tu orden.</p>
            <button className="ft-btn-retry" onClick={fetchData}>
              Intentar de nuevo
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const statusConfig = getOrderStatusConfig(order.status);
  const paymentConfig = PAYMENT_COLORS[order.payment_status] || PAYMENT_COLORS.Pending_Payment;
  const shortId = order.id?.slice(0, 8).toUpperCase();
  const isExternalDesign = order.order_design_type === "EXTERNAL_DESING";

  return (
    <div className="ft-page">
      <div className="ft-gradient-stripe" />
      <div className="ft-container">
        <header className="ft-header">
          {/* Logo del apartado */}
          <div className="ft-brand">
            <span className="ft-brand-icon">
              <img src={NeonLogo} alt="NeonPrint" className="ft-brand-logo" />
            </span>
            <div className="ft-brand-text">
              <div className="ft-brand-title">
                Neon<span className="ft-brand-accent">Print</span>
              </div>
              <div className="ft-brand-sub">
                <span className="ft-brand-sub-pink"> Impresión Digital</span> · RD
              </div>
            </div>
          </div>
          <span className="ft-brand-flow">Seguimiento</span>
        </header>

        <div className="ft-main">
          <div className="ft-card ft-order-info">
            <div className="ft-order-header">
              <div className="ft-order-id-wrap">
                <span className="ft-order-label">Orden</span>
                <span className="ft-order-id">#{shortId}</span>
              </div>
              <div className="ft-order-badges">
                {order.order_type === "orden 911" && (
                  <span className="ft-badge ft-badge-911">911</span>
                )}
                <span
                  className="ft-badge ft-badge-status"
                  style={{
                    background: statusConfig.bg,
                    color: statusConfig.color,
                    borderColor: statusConfig.dot,
                  }}
                >
                  <span
                    className="ft-badge-dot"
                    style={{ background: statusConfig.dot }}
                  />
                  {statusConfig.label}
                </span>
                <span
                  className="ft-badge ft-badge-payment"
                  style={{
                    background: paymentConfig.bg,
                    color: paymentConfig.color,
                  }}
                >
                  {paymentConfig.label}
                </span>
                {isExternalDesign && (
                  <span className="ft-badge ft-badge-external">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    Diseño externo
                  </span>
                )}
              </div>
            </div>

            <div className="ft-order-client">
              <div className="ft-client-avatar">
                P
              </div>
              <div>
                <span className="ft-client-name">Tu pedido</span>
                <span className="ft-client-label">Seguimiento privado</span>
              </div>
            </div>
          </div>

          <div className="ft-card ft-progress-card">
            <h3 className="ft-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              Progreso de tu orden
            </h3>
            <FlowTrackClient
              status={order.status}
              events={events}
              order={order}
              designType={order.order_design_type}
              productionFiles={order.production_files}
            />
          </div>

          <div className="ft-card ft-details-card">
            <h3 className="ft-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              Detalles de la orden
            </h3>
            <div className="ft-details-grid">
              {order.delivery_date && (
                <div className="ft-detail-item">
                  <span className="ft-detail-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    Fecha estimada de entrega
                  </span>
                  <span className="ft-detail-value ft-date-value">
                    {formatDate(order.delivery_date)}
                  </span>
                </div>
              )}
              <div className="ft-detail-item">
                <span className="ft-detail-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>
                  Tipo de orden
                </span>
                <span className="ft-detail-value">{order.order_type || "Sin definir"}</span>
              </div>
              <div className="ft-detail-item">
                <span className="ft-detail-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h7" /></svg>
                  Diseño
                </span>
                <span className="ft-detail-value">{isExternalDesign ? "Externo" : "Interno"}</span>
              </div>
              <div className="ft-detail-item">
                <span className="ft-detail-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  Última actualización
                </span>
                <span className="ft-detail-value ft-date-value">
                  {formatDate(order.updated_at || order.created_at)}
                </span>
              </div>
              <div className="ft-detail-item">
                <span className="ft-detail-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  Creada
                </span>
                <span className="ft-detail-value">{formatDate(order.created_at)}</span>
              </div>
              {order.cancellation_reason && (
                <div className="ft-detail-item full">
                  <span className="ft-detail-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    Motivo de cancelación
                  </span>
                  <span className="ft-detail-value">{order.cancellation_reason}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="ft-footer">
          <button className="ft-refresh-btn" onClick={fetchData} disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "ft-spin" : ""}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Actualizar
          </button>
          <p className="ft-footer-text">Seguimiento de tu Pedido | NeonPrint</p>
        </footer>
      </div>
    </div>
  );
}
