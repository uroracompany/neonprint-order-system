import { useCallback, useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-production.css";
import Sidebar from "../components/Sidebar";
import NotificationCenter from "../components/NotificationCenter";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import { Icons } from "../utils/icons";
import { StatusBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import {
  ORDER_STATUS,
  PAYMENT_COLORS,
  PRODUCTION_TRACKING_STATUS_OPTIONS,
  PRODUCTION_FILE_STATUS,
  getProductionAreaForRole,
  getProductionAreaLabel,
  getOrderStatusConfig,
  isOrderStatus,
  formatDate,
  ARCHIVE_MODULES,
} from "../utils/constants";
import { loadClients, orderMatchesClientFilter } from "../utils/clients";
import { getReferenceImages } from "../utils/orderAssets";
import {
  filterProductionOrdersByArchiveState,
  filterProductionFilesForRole,
  getNextProductionFileStatus,
  getProductionFileStatusLabel,
  getProductionSummary,
} from "../utils/production";
import {
  canArchiveOrder,
  canRestoreOrder,
  archiveOrder,
  restoreOrder,
} from "../utils/archive";
import { openOrderAssetUrl } from "../utils/fileAccess";
import { isR2OrderAssetUrl } from "../utils/uploadOrderAsset";

const METRIC_ACCENTS = [
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#0284C7", bg: "#E0F2FE", glow: "#E0F2FE" },
  { color: "#059669", bg: "#ECFDF5", glow: "#ECFDF5" },
  { color: "#14532D", bg: "#DCFCE7", glow: "#DCFCE7" },
];

function MetricCard({ icon, label, value, accentIdx = 0 }) {
  const acc = METRIC_ACCENTS[accentIdx];
  return (
    <div
      className="pp-metric-card"
      onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
      onMouseLeave={e => e.currentTarget.style.borderColor = ""}
    >
      <div className="pp-metric-glow" style={{ background: acc.glow }} />
      <div className="pp-metric-icon" style={{ background: acc.bg, color: acc.color }}>
        {icon}
      </div>
      <div className="pp-metric-info">
        <span className="pp-metric-value">{value}</span>
        <span className="pp-metric-label">{label}</span>
      </div>
    </div>
  );
}

function getProductionTeamStatusLabel(status) {
  if (status === PRODUCTION_FILE_STATUS.COMPLETED) return "Completado";
  if (status === PRODUCTION_FILE_STATUS.IN_TERMINATION) return "En terminacion";
  if (status === PRODUCTION_FILE_STATUS.IN_PRODUCTION) return "En progreso";
  return "Pendiente";
}

export function OrderDetailModal({ onClose, order, producerRole, onUpdateStatus, teamRefreshKey = 0 }) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [showLastFileConfirm, setShowLastFileConfirm] = useState(false);
  const [pendingLastFile, setPendingLastFile] = useState(null);
  const [designerName, setDesignerName] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [teamProgress, setTeamProgress] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");

  const executeFileUpdate = async (fileId, nextStatus) => {
    setUpdating(true);
    setUpdateError("");
    try {
      const { error } = await supabase
        .rpc("update_production_file_status", { p_file_id: fileId, p_next_status: nextStatus });

      if (error) throw error;

      setUpdateSuccess(true);
      setTimeout(() => {
        setUpdateSuccess(false);
        onUpdateStatus?.();
        onClose();
      }, 1500);
    } catch (err) {
      console.error("Error updating status:", err);
      setUpdateError("No se pudo actualizar el estado del archivo. Intenta nuevamente.");
    }
    setUpdating(false);
  };

  const handleUpdateFileStatus = async (fileId, nextStatus) => {
    if (nextStatus !== PRODUCTION_FILE_STATUS.COMPLETED) {
      executeFileUpdate(fileId, nextStatus);
      return;
    }

    setUpdating(true);
    setUpdateError("");
    try {
      const { data: willCompleteOrder, error } = await supabase
        .rpc("will_complete_production_order", { p_file_id: fileId });

      if (error) throw error;

      if (willCompleteOrder) {
        setPendingLastFile({ fileId, nextStatus });
        setShowLastFileConfirm(true);
        setUpdating(false);
        return;
      }
      setUpdating(false);
      executeFileUpdate(fileId, nextStatus);
    } catch (err) {
      console.error("Error checking last pending file:", err);
      setUpdateError("No se pudo verificar si este es el ultimo archivo pendiente. Intenta nuevamente.");
      setUpdating(false);
    }
  };

  const handleConfirmLastFile = () => {
    if (!pendingLastFile) return;
    setShowLastFileConfirm(false);
    executeFileUpdate(pendingLastFile.fileId, pendingLastFile.nextStatus);
  };
  const handleUpdateStatus = () => {};
  const onCompleteOrder = null;

  useEffect(() => {
    if (!order?.designer_id) {
      setDesignerName("");
      return;
    }
    supabase
      .from("profiles")
      .select("name")
      .eq("id", order.designer_id)
      .single()
      .then(({ data }) => {
        setDesignerName(data?.name || "");
      });
  }, [order?.designer_id]);

  useEffect(() => {
    const quoteId = order?.quote_id || order?.quotation_id || order?.quote_user_id;
    if (!quoteId) {
      setQuoteName("");
      return;
    }
    supabase
      .from("profiles")
      .select("name")
      .eq("id", quoteId)
      .single()
      .then(({ data }) => {
        setQuoteName(data?.name || "");
      });
  }, [order?.quote_id, order?.quotation_id, order?.quote_user_id]);

  useEffect(() => {
    if (order?.seller_name) {
      setSellerName(order.seller_name);
      return;
    }
    const sellerId = order?.seller_id || order?.created_by;
    if (!sellerId) {
      setSellerName("");
      return;
    }
    supabase
      .from("profiles")
      .select("name")
      .eq("id", sellerId)
      .single()
      .then(({ data }) => {
        setSellerName(data?.name || "");
      });
  }, [order?.seller_name, order?.seller_id, order?.created_by]);

  useEffect(() => {
    if (!order?.id) {
      setTeamProgress([]);
      setTeamError("");
      return;
    }

    let active = true;
    setTeamLoading(true);
    setTeamError("");

    supabase
      .rpc("get_production_order_team", { p_order_id: order.id })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Error loading production team:", error);
          setTeamProgress([]);
          setTeamError("No se pudo cargar el progreso del equipo.");
        } else {
          const raw = Array.isArray(data) ? data : [];
          setTeamProgress(raw.filter((m) => (m.total_files || 0) > 0));
        }
      })
      .finally(() => {
        if (active) setTeamLoading(false);
      });

    return () => {
      active = false;
    };
  }, [order?.id, order?.updated_at, teamRefreshKey]);

  if (!order) return null;

  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const statusCfg = getOrderStatusConfig(order.status);
  const isInProduction = false;
  const isInTermination = false;

  const isExternal = order?.order_design_type === "EXTERNAL_DESING";
  const areaCode = getProductionAreaForRole(producerRole);
  const areaFiles = filterProductionFilesForRole(order, producerRole);
  const areaSummary = getProductionSummary(areaFiles);
  const referenceImageUrls = getReferenceImages(order);
  const hasAreaFiles = areaFiles.length > 0;
  const teamCompleted = teamProgress.filter((item) => item.summary_status === PRODUCTION_FILE_STATUS.COMPLETED).length;

  return (<>
    <div className="pp-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-modal">
        <div className="pp-modal-stripe" />
        <div className="pp-modal-header">
          <div>
            <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
            <span className="pp-modal-subtitle">Detalles para producción</span>
          </div>
          <button className="pp-modal-close" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>

        <div className="pp-modal-body">
          {updateSuccess && (
            <div className="pp-modal-alert pp-alert-success">
              <Icons.Check />
              Estado actualizado correctamente
            </div>
          )}
          {updateError && (
            <div className="pp-modal-alert pp-alert-error">
              <Icons.Close />
              {updateError}
            </div>
          )}

          <div className="pp-modal-grid">
            <div>
              <div className="pp-modal-card">
                <div className="pp-modal-card-title">
                  <Icons.User />
                  <h4>Información del Cliente</h4>
                </div>
                <div className="pp-modal-card-body">
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.User /></span>
                    <div>
                      <p className="pp-modal-row-label">Cliente</p>
                      <p className="pp-modal-row-value">{order.client_name || "No especificado"}</p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Users /></span>
                    <div>
                      <p className="pp-modal-row-label">Vendedor</p>
                      <p className="pp-modal-row-value">{sellerName || "No especificado"}</p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Package /></span>
                    <div>
                      <p className="pp-modal-row-label">Tipo de Orden</p>
                      <p className="pp-modal-row-value">
                        {order.order_type === "orden 911" ? (
                          <span className="pp-badge-911">911 - Urgente</span>
                        ) : (
                          <span className="pp-badge-normal">Normal</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Clock /></span>
                    <div>
                      <p className="pp-modal-row-label">Fecha de Creación</p>
                      <p className="pp-modal-row-value">{created}</p>
                    </div>
                  </div>
                </div>
                <p style={{ marginTop: 10, fontSize: 12, color: "var(--pp-text-muted)" }}>
                  Area {getProductionAreaLabel(areaCode)}: {areaSummary.completed}/{areaSummary.total} completados
                </p>
              </div>

              <div className="pp-modal-card" style={{ marginTop: 16 }}>
                <div className="pp-modal-card-title">
                  <Icons.FileText />
                  <h4>Detalles del Trabajo</h4>
                </div>
                <div className="pp-modal-card-body">
                  <div>
                    <p className="pp-modal-row-label">Descripción</p>
                    <p className="pp-modal-description">{order.description || "Sin descripción"}</p>
                  </div>
                  <div className="pp-modal-row" style={{ marginTop: 10 }}>
                    <span className="pp-modal-row-icon"><Icons.Package /></span>
                    <div>
                      <p className="pp-modal-row-label">Material</p>
                      <p className="pp-modal-row-value">{order.material || "No especificado"}</p>
                    </div>
                  </div>
                  {order.width && order.height && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Clipboard /></span>
                      <div>
                        <p className="pp-modal-row-label">Dimensiones</p>
                        <p className="pp-modal-row-value">{order.width} x {order.height} cm</p>
                      </div>
                    </div>
                  )}
                  {order.quantity && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Clipboard /></span>
                      <div>
                        <p className="pp-modal-row-label">Cantidad</p>
                        <p className="pp-modal-row-value">{order.quantity} unidades</p>
                      </div>
                    </div>
                  )}
                  {order.termination_type && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Check /></span>
                      <div>
                        <p className="pp-modal-row-label">Terminación</p>
                        <p className="pp-modal-row-value">{order.termination_type}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="pp-modal-status-card">
                <div className="pp-modal-status-glow" style={{ background: statusCfg?.bg || "transparent" }} />
                <p className="pp-modal-status-title">Estado</p>
                <div className="pp-modal-status-grid">
                  <div className="pp-modal-status-section">
                    <span className="pp-modal-status-label">Estado Actual</span>
                    <StatusBadge status={order.status} className="pp-badge" bordered />
                  </div>
                  {order.price && (
                    <div className="pp-price-box">
                      <p className="pp-price-box-label">PRECIO</p>
                      <p className="pp-price-box-value">RD$ {Number(order.price).toLocaleString("es-DO")}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="pp-modal-card" style={{ marginTop: 16 }}>
                <div className="pp-modal-card-title">
                  <Icons.Key />
                  <h4>Información del Sistema</h4>
                </div>
                <div className="pp-modal-card-body">
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Key /></span>
                    <div>
                      <p className="pp-modal-row-label">ID Orden</p>
                      <p className="pp-modal-row-value">{order.id?.slice(0, 8) || "---"}</p>
                    </div>
                    <span className="pp-modal-row-value-right" style={{ fontFamily: "monospace", fontSize: 11, color: "var(--pp-text-muted)" }}>
                      {order.id?.slice(8, 13) || ""}
                    </span>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Clock /></span>
                    <div>
                      <p className="pp-modal-row-label">Creada</p>
                      <p className="pp-modal-row-value">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                  {order.updated_at && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Refresh /></span>
                      <div>
                        <p className="pp-modal-row-label">Actualizada</p>
                        <p className="pp-modal-row-value">{formatDate(order.updated_at)}</p>
                      </div>
                    </div>
                  )}
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Edit /></span>
                    <div>
                      <p className="pp-modal-row-label">Diseñador</p>
                      <p className="pp-modal-row-value">
                        {isExternal ? "La orden es externa" : (designerName || "No asignado")}
                      </p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.User /></span>
                    <div>
                      <p className="pp-modal-row-label">Responsable de caja</p>
                      <p className="pp-modal-row-value">{quoteName || "No asignado"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pp-modal-card pp-team-progress-card" style={{ marginTop: 18 }}>
            <div className="pp-modal-card-title">
              <Icons.Users />
              <h4>Progreso del equipo</h4>
            </div>
            {teamLoading ? (
              <div className="pp-team-progress-empty">Cargando progreso del equipo...</div>
            ) : teamError ? (
              <div className="pp-team-progress-empty">{teamError}</div>
            ) : teamProgress.length === 0 ? (
              <div className="pp-team-progress-empty">No hay responsables de produccion asignados.</div>
            ) : (
              <>
                <div className="pp-team-progress-summary">
                  {teamCompleted}/{teamProgress.length} areas completadas
                </div>
                <div className="pp-team-progress-grid">
                  {teamProgress.map((member) => {
                    const isCurrentArea = member.production_area_code === areaCode;
                    return (
                      <div className={`pp-team-progress-item ${isCurrentArea ? "current" : ""}`} key={member.production_area_code}>
                        <div className="pp-team-progress-head">
                          <div>
                            <strong>{member.production_area_label || getProductionAreaLabel(member.production_area_code)}</strong>
                            <span>{member.assigned_name || "Usuario de produccion"}</span>
                          </div>
                          {isCurrentArea && <em>Tu area</em>}
                        </div>
                        <div className={`pp-team-progress-status ${member.summary_status || "pending"}`}>
                          {getProductionTeamStatusLabel(member.summary_status)}
                        </div>
                        <div className="pp-team-progress-counts">
                          <span>{member.completed_count || 0}/{member.total_files || 0} completados</span>
                          <span>{member.in_termination_count || 0} en terminacion</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {hasAreaFiles ? (
            <div className="pp-files-section" style={{ marginTop: 18 }}>
              <div className="pp-files-title">
                <Icons.File />
                Archivos Adjuntos
              </div>
              <div style={{ display: "grid", gridTemplateColumns: order.preview_image && areaFiles.length > 0 ? "1fr 1fr" : "1fr", gap: 16, marginTop: 12 }}>
                {order.preview_image && (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <Icons.Eye /> Orden de Trabajo
                    </p>
                    <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <img
                        src={order.preview_image}
                        alt="preview"
                        style={{
                          width: "100%",
                          borderRadius: "var(--pp-radius-md)",
                          border: "1px solid var(--pp-border)",
                          cursor: "pointer",
                          transition: "transform 0.2s, box-shadow 0.2s",
                        }}
                        onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                        onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                      />
                    </a>
                  </div>
                )}
                {areaFiles.length > 0 && (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <Icons.Brush /> Diseño del cliente
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {areaFiles.map((file) => {
                        const nextStatus = getNextProductionFileStatus(file.status);
                        return (
                        <div key={file.id} className="pp-file-item" style={{ margin: 0 }}>
                          <div className="pp-file-icon">
                            <Icons.File />
                          </div>
                          <div className="pp-file-info">
                            <span className="pp-file-name">{file.filename}</span>
                            <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{getProductionFileStatusLabel(file.status)}</span>
                          </div>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pp-file-download"
                            title="Descargar"
                            onClick={(event) => {
                              if (!isR2OrderAssetUrl(file.url)) return;
                              event.preventDefault();
                              openOrderAssetUrl({ url: file.url, fileName: file.filename, download: true });
                            }}
                          >
                            <Icons.Download />
                          </a>
                          {nextStatus && (
                            <button
                              className="pp-file-download"
                              onClick={() => handleUpdateFileStatus(file.id, nextStatus)}
                              disabled={updating}
                              title={nextStatus === PRODUCTION_FILE_STATUS.COMPLETED ? "Marcar completado" : "Marcar en terminacion"}
                            >
                              {nextStatus === PRODUCTION_FILE_STATUS.COMPLETED ? <Icons.Check /> : <Icons.Play />}
                            </button>
                          )}
                        </div>
                      );})}
                    </div>
                  </div>
                )}
              </div>
              {referenceImageUrls.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Image /> Imágenes de referencia
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {referenceImageUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flex: "0 0 auto" }}>
                        <img
                          src={url}
                          alt={`Ref ${i + 1}`}
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                            borderRadius: "var(--pp-radius-md)",
                            border: "1px solid var(--pp-border)",
                            cursor: "pointer",
                            transition: "transform 0.2s, box-shadow 0.2s",
                          }}
                          onMouseEnter={e => { e.target.style.transform = "scale(1.05)"; e.target.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)"; }}
                          onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pp-modal-card" style={{ marginTop: 18 }}>
              Esta orden no contiene archivos relacionados con tu area. No se requiere tu participacion en este proceso.
            </div>
          )}
        </div>

        <div className="pp-modal-footer">
          <button className="pp-btn pp-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          {isInProduction && (
            <button
              className="pp-btn pp-btn-primary"
              onClick={() => handleUpdateStatus(ORDER_STATUS.IN_TERMINATION)}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pp-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icons.Play />
                  Marcar en terminación
                </>
              )}
            </button>
          )}
          {isInTermination && (
            // Solo mostrar botón de completado si ya está en terminación
            <button
              className="pp-btn pp-btn-success"
              onClick={() => onCompleteOrder?.(order)}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pp-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icons.Check />
                  Marcar como completado
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
    {showLastFileConfirm && (
      <div className="pp-modal-overlay" onClick={() => setShowLastFileConfirm(false)} style={{ zIndex: 1100 }}>
        <div className="pp-modal pp-modal-compact" onClick={(e) => e.stopPropagation()}>
          <div className="pp-modal-stripe" />
          <div className="pp-modal-header">
            <div>
              <div className="pp-modal-title"><h3>Finalizar orden de producción</h3></div>
              <div className="pp-modal-subtitle">Confirmación requerida</div>
            </div>
            <button className="pp-modal-close" onClick={() => setShowLastFileConfirm(false)}><Icons.Close /></button>
          </div>
          <div className="pp-modal-body">
            <div className="pp-confirm-body">
              <div className="pp-confirm-icon"><Icons.CheckCircle size={28} /></div>
              <p className="pp-confirm-text-em">
                Estás a punto de completar el <strong>último archivo pendiente</strong> de esta orden.
              </p>
              <div className="pp-confirm-alert-box">
                <Icons.AlertCircle size={16} />
                <p className="pp-confirm-alert-text">
                  Al marcar este archivo como completado, la orden de producción cambiará automáticamente a estado <strong>Completada</strong>.
                </p>
              </div>
              <p className="pp-confirm-text">
                ¿Deseas continuar?
              </p>
            </div>
          </div>
          <div className="pp-modal-footer">
            <button className="pp-btn pp-btn-secondary" onClick={() => setShowLastFileConfirm(false)}>
              Cancelar
            </button>
            <button className="pp-btn pp-btn-success" onClick={handleConfirmLastFile} disabled={updating}>
              {updating ? (
                <><span className="pp-btn-spinner" /> Completando...</>
              ) : (
                "Confirmar y completar orden"
              )}
            </button>
          </div>
        </div>
      </div>
    )}
  </>);
}

export default function PageProduction() {
  const navigate = useNavigate();
  const { user: authUser, profile: authProfile, signOut } = useAuth();
  const [user, setUser] = useState(null);
  const [profileRole, setProfileRole] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;
  const [viewMode, setViewMode] = useState("table");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [teamRefreshKey, setTeamRefreshKey] = useState(0);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [filterArchive, setFilterArchive] = useState("active");
  const [clients, setClients] = useState([]);
  const notif = useNotifications(user?.id);

  const refreshOrders = useCallback(async (silent = false) => {
    if (!user?.id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_production_files(*), order_production_assignments(*), order_production_user_archives(*)")
      .in("status", PRODUCTION_TRACKING_STATUS_OPTIONS)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    if (!silent) setLoading(false);
  }, [user?.id]);

  const handleArchiveOrder = (order) => {
    if (!canArchiveOrder(order, ARCHIVE_MODULES.PRODUCTION, user?.id)) return;
    setArchivingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivingOrder) return;
    setArchiveLoading(true);
    const { error } = await archiveOrder(archivingOrder, ARCHIVE_MODULES.PRODUCTION);
    setArchiveLoading(false);
    if (!error) {
      notif.showActionNotification({
        type: "order_archived",
        label: "Orden archivada",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "La orden fue archivada correctamente.",
      });
      setArchivingOrder(null);
      await refreshOrders();
    } else {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al archivar",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo archivar la orden.",
      });
    }
  };

  const handleRestoreOrder = async (order) => {
    if (!order?.id) return;
    setArchiveLoading(true);
    const { error } = await restoreOrder(order, ARCHIVE_MODULES.PRODUCTION);
    setArchiveLoading(false);
    if (error) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al restaurar",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo restaurar la orden.",
      });
    } else {
      await refreshOrders();
    }
  };

  useEffect(() => {
    setUser(authUser || null);
    setProfileRole(authProfile?.role || "");
  }, [authProfile?.role, authUser]);

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

  useEffect(() => {
    if (!user?.id || !profileRole) return;
    refreshOrders();
  }, [user?.id, profileRole, refreshOrders]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`production-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => refreshOrders(true)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_production_files" },
        () => {
          setTeamRefreshKey((value) => value + 1);
          refreshOrders(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_production_assignments" },
        () => {
          setTeamRefreshKey((value) => value + 1);
          refreshOrders(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_production_user_archives" },
        () => refreshOrders(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refreshOrders]);

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const activeOrders = filterProductionOrdersByArchiveState(orders, user?.id, "active");
  const archiveScopedOrders = filterProductionOrdersByArchiveState(orders, user?.id, filterArchive);

  const filteredOrders = archiveScopedOrders.filter(order => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      order.client_name?.toLowerCase().includes(q) ||
      order.id?.toLowerCase().includes(q) ||
      order.description?.toLowerCase().includes(q);

    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesPayment = filterPayment === "all" || order.payment_status === filterPayment;
    const matchesClient = orderMatchesClientFilter(order, filterClient);

    return matchesSearch && matchesStatus && matchesPayment && matchesClient;
  });

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const metrics = [
    { icon: <Icons.Package />, label: "Producción", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_PRODUCTION)).length, accentIdx: 0 },
    { icon: <Icons.Package />, label: "Terminación", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_TERMINATION)).length, accentIdx: 1 },
    { icon: <Icons.Truck />, label: "Entregadas", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)).length, accentIdx: 2 },
    { icon: <Icons.Check />, label: "Completadas", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_COMPLETED)).length, accentIdx: 3 },
  ];

  const handleViewOrder = (order) => {
    setSelectedOrder(order);
  };



  const canAdvance = (order) => {
    void order;
    return false;
  };

  const getAdvanceIcon = (order) => {
    if (isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)) return <Icons.Play />;
    if (isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION)) return <Icons.Check />;
    return null;
  };

  const getAdvanceLabel = (order) => {
    if (isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)) return "Terminación";
    if (isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION)) return "Completado";
    return "";
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="pp-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={user?.user_metadata?.display_name || user?.email}
        role="Producción"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
          { id: "orders", label: "Órdenes", icon: <Icons.Orders /> }
        ]}
        onLogout={handleLogout}
      />

      <main className="pp-main">
        <header className="pp-header">
          <button className="pp-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
          </button>
          <div className="pp-header-title">
            <h2>{activeTab === "dashboard" ? "Dashboard" : "Órdenes de Producción"}</h2>
          </div>
          <span className="pp-header-date">{dateStr}</span>
          <NotificationCenter
            notifications={notif.notifications}
            unreadCount={notif.unreadCount}
            toasts={notif.toasts}
            onMarkAsRead={notif.markAsRead}
            onMarkAllAsRead={notif.markAllAsRead}
            onArchive={notif.archive}
            onDelete={notif.deleteNotification}
            onDismissToast={notif.dismissToast}
          />
          <button className="pp-refresh-btn" onClick={refreshOrders} title="Actualizar">
            <Icons.Refresh />
          </button>
        </header>

        <div className="pp-content">
          {activeTab === "dashboard" && (
            <>
              <div className="pp-greeting">
                <h2>Buen día, <span>{user?.displayName || "Operador"}</span> 👋</h2>
                <p>Aquí tienes el resumen de las órdenes en producción.</p>
              </div>

              <div className="pp-metrics">
                {metrics.map((m, i) => (
                  <MetricCard key={i} {...m} />
                ))}
              </div>

              <div className="pp-panel">
                <div className="pp-panel-stripe" />
                <div className="pp-panel-header">
                  <div>
                    <div className="pp-panel-title">Órdenes Recientes</div>
                    <div className="pp-panel-sub">Las últimas 5 órdenes en el flujo de producción</div>
                  </div>
                  <button className="pp-link-btn" onClick={() => setActiveTab("orders")}>
                    Ver todas <Icons.ArrowRight />
                  </button>
                </div>
                <div className="pp-table-wrap">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Descripción</th>
                        <th>Material</th>
                        <th>Estado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="pp-table-empty">Cargando órdenes...</td>
                        </tr>
                      ) : activeOrders.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="pp-table-empty">No hay órdenes para producción</td>
                        </tr>
                      ) : (
                        activeOrders.slice(0, 5).map(order => (
                          <tr key={order.id} className="row-hover" onClick={() => handleViewOrder(order)}>
                            <td className="td-pad td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                            <td className="td-pad td-client">{order.client_name}</td>
                            <td className="td-pad td-desc">{order.description}</td>
                            <td className="td-pad td-material">{order.material}</td>
                            <td className="td-pad"><StatusBadge status={order.status} className="pp-badge" bordered /></td>
                            <td className="td-pad td-actions">
                              <div className="table-actions">
                                <button className="table-action-btn view" onClick={e => { e.stopPropagation(); handleViewOrder(order); }} title="Ver detalles">
                                  <Icons.Eye />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === "orders" && (
            <>
              <div className="pp-filters">
                <div className="pp-search-wrap">
                  <span className="pp-search-icon"><Icons.Search /></span>
                  <input
                    className="pp-input with-icon"
                    placeholder="Buscar por cliente, descripción o ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="pp-select-wrap">
                    <select className="pp-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                      <option value="all">Todos los estados</option>
                      <option value={ORDER_STATUS.IN_PRODUCTION}>Producción</option>
                      <option value={ORDER_STATUS.IN_TERMINATION}>Terminación</option>
                      <option value={ORDER_STATUS.IN_DELIVERED}>Entregadas</option>
                      <option value={ORDER_STATUS.IN_COMPLETED}>Completadas</option>
                    </select>
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="pp-select-wrap">
                    <select className="pp-input" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                      <option value="all">Pago: Todos</option>
                      {Object.entries(PAYMENT_COLORS).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="pp-select-wrap">
                    <ClientFilterSelect
                      clients={clients}
                      value={filterClient}
                      onChange={setFilterClient}
                      className="pp-input"
                      allLabel="Todos los clientes"
                    />
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="pp-select-wrap">
                    <select className="pp-input" value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                      <option value="active">Activas</option>
                      <option value="archived">Archivadas</option>
                    </select>
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setViewMode("table")}
                      className={`pp-view-toggle ${viewMode === "table" ? "active" : ""}`}
                      title="Vista de tabla"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </button>
                    <button
                      onClick={() => setViewMode("cards")}
                      className={`pp-view-toggle ${viewMode === "cards" ? "active" : ""}`}
                      title="Vista de tarjetas"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    </button>
                  </div>
                </div>
                <span className="pp-filters-count">{filteredOrders.length} resultado{filteredOrders.length !== 1 ? "s" : ""}</span>
              </div>

              {loading ? (
                <div className="pp-loading">Cargando órdenes...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="pp-loading">No hay órdenes que coincidan</div>
              ) : viewMode === "table" ? (
                <div className="pp-panel">
                  <div className="pp-panel-stripe" />
                  <div className="pp-table-wrap">
                    <table className="pp-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Cliente</th>
                          <th>Descripción</th>
                          <th>Material</th>
                          <th>Cant.</th>
                          <th>Estado</th>
                          <th>Pago</th>
                          <th>Tipo</th>
                          <th>Fecha</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOrders.map(order => (
                          <tr key={order.id} className="row-hover">
                            <td className="td-pad td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                            <td className="td-pad td-client">{order.client_name}</td>
                            <td className="td-pad td-desc">{order.description?.substring(0, 40)}</td>
                            <td className="td-pad td-material">{order.material}</td>
                            <td className="td-pad td-qty">{order.quantity || "-"}</td>
                            <td className="td-pad"><StatusBadge status={order.status} className="pp-badge" bordered /></td>
                            <td className="td-pad">
                              {order.order_type === "orden 911" ? (
                                <span className="pp-badge-911">911</span>
                              ) : (
                                <span className="pp-badge-normal">Normal</span>
                              )}
                            </td>
                            <td className="td-pad td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                            <td className="td-pad td-actions">
                              <div className="table-actions">
                                <button className="table-action-btn view" onClick={() => handleViewOrder(order)} title="Ver detalles">
                                  <Icons.Eye />
                                </button>
                                {canAdvance(order) && (
                                  <button
                                    className={`table-action-btn play ${isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION) ? "completed" : ""}`}
                                    onClick={() => handleViewOrder(order)}
                                    title={`Avanzar a ${getAdvanceLabel(order)}`}
                                  >
                                    {getAdvanceIcon(order)}
                                  </button>
                                )}
                                {canArchiveOrder(order, ARCHIVE_MODULES.PRODUCTION, user?.id) && (
                                  <button
                                    className="table-action-btn archive"
                                    onClick={(e) => { e.stopPropagation(); handleArchiveOrder(order); }}
                                    title="Archivar orden"
                                  >
                                    <Icons.Archive />
                                  </button>
                                )}
                                {filterArchive === "archived" && canRestoreOrder(order, ARCHIVE_MODULES.PRODUCTION, user?.id) && (
                                  <button
                                    className="table-action-btn unarchive"
                                    onClick={(e) => { e.stopPropagation(); handleRestoreOrder(order); }}
                                    disabled={archiveLoading}
                                    title="Restaurar orden"
                                  >
                                    <Icons.Refresh />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="pp-panel">
                  <div className="pp-panel-stripe" />
                  <div className="pp-cards-grid">
                    {paginatedOrders.map(order => (
                      <div key={order.id} className="pp-order-card" onClick={() => handleViewOrder(order)}>
                        <div className="pp-order-card-header">
                          <span className="pp-order-card-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                          <div className="pp-order-card-badges">
                            <StatusBadge status={order.status} className="pp-badge" bordered />
                          </div>
                        </div>
                        <div className="pp-order-card-client">{order.client_name}</div>
                        <div className="pp-order-card-desc">{order.description || "Sin descripción"}</div>
                        <div className="pp-order-card-meta">
                          <span className="pp-order-card-material">{order.material}</span>
                        </div>
                        <div className="pp-order-card-footer">
                          <span className="pp-order-card-date">
                            {new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                          <div className="pp-order-card-actions">
                            <button className="table-action-btn view" onClick={e => { e.stopPropagation(); handleViewOrder(order); }} title="Ver detalles">
                              <Icons.Eye />
                            </button>
                            {canAdvance(order) && (
                              <button
                                className={`table-action-btn play ${isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION) ? "completed" : ""}`}
                                onClick={e => { e.stopPropagation(); handleViewOrder(order); }}
                                title={`Avanzar a ${getAdvanceLabel(order)}`}
                              >
                                {getAdvanceIcon(order)}
                              </button>
                            )}
                            {canArchiveOrder(order, ARCHIVE_MODULES.PRODUCTION, user?.id) && (
                              <button
                                className="table-action-btn archive"
                                onClick={e => { e.stopPropagation(); handleArchiveOrder(order); }}
                                title="Archivar orden"
                              >
                                <Icons.Archive />
                              </button>
                            )}
                            {filterArchive === "archived" && canRestoreOrder(order, ARCHIVE_MODULES.PRODUCTION, user?.id) && (
                              <button
                                className="table-action-btn unarchive"
                                onClick={e => { e.stopPropagation(); handleRestoreOrder(order); }}
                                disabled={archiveLoading}
                                title="Restaurar orden"
                              >
                                <Icons.Refresh />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </main>

      <OrderDetailModal
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        producerRole={profileRole}
        onUpdateStatus={refreshOrders}
        teamRefreshKey={teamRefreshKey}
      />

      <ArchiveOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchiveOrder}
        order={archivingOrder}
        loading={archiveLoading}
      />
    </div>
  );
}


