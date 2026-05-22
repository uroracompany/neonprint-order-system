import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { FlowTrackClient } from "../components/FlowTrackClient";
import {
  getOrderStatusConfig,
  getOrderStatusLabel,
  PAYMENT_COLORS,
  formatDate,
  ORDER_STATUS,
} from "../utils/constants";
import "../css-components/flowtrack-client.css";

const PAGE_TITLE = "FlowTrack - NeonPrint";

export default function PageTracking() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: orderData, error: orderErr } = await supabase.rpc(
        "get_order_tracking",
        { p_token: token }
      );
      if (orderErr) throw orderErr;
      if (!orderData || orderData.length === 0) {
        setError("ORDEN_NO_ENCONTRADA");
        return;
      }
      setOrder(orderData[0]);

      const { data: eventData, error: eventErr } = await supabase.rpc(
        "get_order_tracking_events",
        { p_token: token }
      );
      if (!eventErr && eventData) setEvents(eventData);
    } catch (err) {
      console.error("FlowTrack error:", err);
      setError("ERROR");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    document.title = order
      ? `FlowTrack - ${order.client_name}`
      : PAGE_TITLE;
  }, [order]);

  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) fetchData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
            <p>El enlace de seguimiento no es válido o la orden ha sido eliminada.</p>
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
  const isCancelled = order.status === ORDER_STATUS.CANCELLED;

  return (
    <div className="ft-page">
      <div className="ft-container">
        <header className="ft-header">
          <div className="ft-brand">
            <span className="ft-brand-icon">🏪</span>
            <span className="ft-brand-name">NeonPrint</span>
          </div>
          <span className="ft-brand-flow">FlowTrack</span>
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
              </div>
            </div>

            <div className="ft-order-client">
              <div className="ft-client-avatar">
                {(order.client_name || "C")[0].toUpperCase()}
              </div>
              <div>
                <span className="ft-client-name">{order.client_name || "Cliente"}</span>
                <span className="ft-client-label">Cliente</span>
              </div>
            </div>
          </div>

          <div className="ft-card ft-progress-card">
            <h3 className="ft-section-title">Progreso de tu orden</h3>
            <FlowTrackClient status={order.status} events={events} order={order} />
          </div>

          <div className="ft-card ft-details-card">
            <h3 className="ft-section-title">Detalles de la orden</h3>
            <div className="ft-details-grid">
              {order.description && (
                <div className="ft-detail-item full">
                  <span className="ft-detail-label">Descripción</span>
                  <span className="ft-detail-value">{order.description}</span>
                </div>
              )}
              {order.material && (
                <div className="ft-detail-item">
                  <span className="ft-detail-label">Material</span>
                  <span className="ft-detail-value">{order.material}</span>
                </div>
              )}
              {order.termination_type && (
                <div className="ft-detail-item">
                  <span className="ft-detail-label">Tipo de terminación</span>
                  <span className="ft-detail-value">{order.termination_type}</span>
                </div>
              )}
              {order.delivery_date && (
                <div className="ft-detail-item">
                  <span className="ft-detail-label">Fecha estimada de entrega</span>
                  <span className="ft-detail-value ft-date-value">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    {formatDate(order.delivery_date)}
                  </span>
                </div>
              )}
              <div className="ft-detail-item">
                <span className="ft-detail-label">Última actualización</span>
                <span className="ft-detail-value ft-date-value">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {formatDate(order.updated_at || order.created_at)}
                </span>
              </div>
              <div className="ft-detail-item">
                <span className="ft-detail-label">Creada</span>
                <span className="ft-detail-value">{formatDate(order.created_at)}</span>
              </div>
            </div>
          </div>

          {order.preview_image && (
            <div className="ft-card ft-preview-card">
              <h3 className="ft-section-title">Vista previa</h3>
              <div className="ft-preview-wrap">
                <img
                  src={order.preview_image}
                  alt="Vista previa de la orden"
                  className="ft-preview-img"
                  loading="lazy"
                />
              </div>
            </div>
          )}
        </div>

        <footer className="ft-footer">
          <button className="ft-refresh-btn" onClick={fetchData} disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "ft-spin" : ""}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Actualizar
          </button>
          <p className="ft-footer-text">FlowTrack by NeonPrint</p>
        </footer>
      </div>
    </div>
  );
}
