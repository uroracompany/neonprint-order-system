import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-designer.css";
import Sidebar from "../components/Sidebar";
import { Icons } from "../utils/icons";
import { AssignModal } from "../components/ui/AssignModal";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import FileUploadZone from "../components/ui/FileUploadZone";
import {
  canArchiveOrder,
  archiveOrder,
} from "../utils/archive";
import { ORDER_STATUS, PRODUCTION_AREAS, isOrderStatus, isOrderStatusIn, ARCHIVE_MODULES } from "../utils/constants";
import { StatusBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import NotificationCenter from "../components/NotificationCenter";
import FileCard from "../components/FileCard";
import { formatFileSize, getOrderAssetLimit, uploadOrderAsset, validateOrderAssetSize } from "../utils/uploadOrderAsset";
import { loadClients, orderMatchesClientFilter } from "../utils/clients";
import { getReferenceImages } from "../utils/orderAssets";
import { buildProductionFileRows } from "../utils/production";

const EDITED_ORDERS_STORAGE_KEY = "pd_edited_orders";
const PER_PAGE = 15;
const DESIGNER_ORDER_SELECT = [
  "id",
  "client_name",
  "client_contact",
  "order_type",
  "created_at",
  "description",
  "material",
  "status",
  "return_reason",
  "returned_to_designer_at",
  "order_file_url",
  "preview_image",
  "designer_id",
  "seller_id",
  "created_by",
  "is_archived_designer",
  "quote_id",
  "quantity",
].join(", ");
const TRACKED_ORDER_FIELDS = [
  "client_name",
  "client_contact",
  "order_type",
  "created_at",
  "description",
  "material",
];

const normalizeTrackedValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const hasTrackedOrderChanges = (previousOrder, nextOrder) => {
  return TRACKED_ORDER_FIELDS.some(field => (
    normalizeTrackedValue(previousOrder?.[field]) !== normalizeTrackedValue(nextOrder?.[field])
  ));
};

const isReturnedOrder = (order) => (
  isOrderStatus(order?.status, ORDER_STATUS.IN_DESIGN) &&
  String(order?.return_reason || "").trim().length > 0
);

const hasReturnUpdate = (previousOrder, nextOrder) => {
  if (!isReturnedOrder(nextOrder)) return false;

  return (
    !isReturnedOrder(previousOrder) ||
    normalizeTrackedValue(previousOrder?.return_reason) !== normalizeTrackedValue(nextOrder?.return_reason) ||
    normalizeTrackedValue(previousOrder?.returned_to_designer_at) !== normalizeTrackedValue(nextOrder?.returned_to_designer_at)
  );
};

function ReturnedBadge({ compact = false }) {
  return (
    <span className={`pd-returned-badge${compact ? " compact" : ""}`} title="Orden devuelta por caja">
      Devuelta
    </span>
  );
}



const getFilesCountFromDB = (order) => {
  if (!order?.order_file_url) return 0;
  try {
    const urls = JSON.parse(order.order_file_url);
    return Array.isArray(urls) ? urls.length : 1;
  } catch {
    return 1;
  }
};

const hasFiles = (order, orderFiles) => {
  const storageFiles = orderFiles?.[order?.id]?.length || 0;
  const dbFiles = getFilesCountFromDB(order);
  return storageFiles > 0 || dbFiles > 0;
};

function AttachmentIndicator({ compact = false }) {
  return (
    <span
      className={`pd-attachment-indicator${compact ? " compact" : ""}`}
      title="Esta orden tiene archivos adjuntos"
      aria-label="Esta orden tiene archivos adjuntos"
    >
      <Icons.File />
      {!compact && <span>Adjuntos</span>}
    </span>
  );
}

const parseOrderFileUrls = (value) => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values
      .map((item) => (typeof item === "string" ? item : item?.url))
      .filter(Boolean);
  } catch {
    return String(value)
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const buildDesignerAssetPath = (orderId, folder, file, prefix = "") => {
  const safeName = String(file?.name || "archivo")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "") || "archivo";
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return `orders/${orderId}/${folder}/${prefix}${suffix}-${safeName}`;
};

const DESIGNER_FILES_BUCKET = "order-docs";
const DESIGNER_PREVIEW_BUCKET = "order-previews";

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#0EA5E9", bg: "#E0F2FE", glow: "#E0F2FE" },
  { color: "#EF4444", bg: "#FEE2E2", glow: "#FEE2E2" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
];

function MetricCard({ icon, label, value, sub, accentIdx = 0 }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="pd-metric-card"
      onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
      onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
      <div className="pd-metric-glow" style={{ background: acc.glow }} />
      <div className="pd-metric-icon" style={{ background: acc.bg, color: acc.color }}>
        {icon}
      </div>
      <div className="pd-metric-value">{value}</div>
      <div className="pd-metric-label">{label}</div>
      {sub && <div className="pd-metric-sub" style={{ color: acc.color }}>{sub}</div>}
    </div>
  );
}

function ProductionAreaSelect({ value, onChange, isError }) {
  return (
    <select className={`pd-input${isError ? ' pd-input-error' : ''}`} value={value || ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">Tipo de produccion *</option>
      {PRODUCTION_AREAS.map((area) => (
        <option key={area.code} value={area.code}>{area.label}</option>
      ))}
    </select>
  );
}

function OrderDetailModal({ onClose, order, designerFiles, designerPreview, onRefresh, onSendToQuotation, quotationSending }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingFileAreas, setPendingFileAreas] = useState([]);
  const [pendingFileLabels, setPendingFileLabels] = useState([]);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [pendingPreviewName, setPendingPreviewName] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [missingAreaIndices, setMissingAreaIndices] = useState([]);
  const [missingLabelIndices, setMissingLabelIndices] = useState([]);
  const [sellerName, setSellerName] = useState("");
  const designerPreviewInputRef = useRef(null);
  const referenceImageUrls = getReferenceImages(order);
  const displayPreview = useMemo(() => (
    pendingPreview ? URL.createObjectURL(pendingPreview) : (designerPreview || order?.preview_image)
  ), [designerPreview, order?.preview_image, pendingPreview]);

  useEffect(() => () => {
    if (displayPreview?.startsWith("blob:")) URL.revokeObjectURL(displayPreview);
  }, [displayPreview]);

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

  if (!order) return null;
  
  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const canEditDesignerAssets = isOrderStatus(order.status, ORDER_STATUS.IN_DESIGN);
  const isCancelledReadonly = order.is_archived_designer && isOrderStatus(order.status, ORDER_STATUS.CANCELLED);
  const readonlyMessage =
    isCancelledReadonly
      ? "Esta orden está en modo lectura porque fue cancelada."
      : isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
        ? "Esta orden está en modo lectura mientras permanece en caja."
        : "Esta orden está en modo lectura según su estado actual.";
  const returnedReason = String(order.return_reason || "").trim();
  
  const handleFileSelect = (filesOrEvent, { showError } = {}) => {
    if (!canEditDesignerAssets) return;
    const files = Array.from(filesOrEvent?.target?.files || filesOrEvent || []);
    const acceptedFiles = [];
    const rejectedFiles = [];

    files.forEach((file) => {
      const sizeError = validateOrderAssetSize({ bucket: DESIGNER_FILES_BUCKET, file });
      if (sizeError) {
        rejectedFiles.push(sizeError);
      } else {
        acceptedFiles.push(file);
      }
    });

    if (acceptedFiles.length > 0) {
      setPendingFiles(prev => [...prev, ...acceptedFiles]);
      setPendingFileAreas(prev => [...prev, ...acceptedFiles.map(() => "")]);
      setPendingFileLabels(prev => [...prev, ...acceptedFiles.map(() => "")]);
    }

    if (rejectedFiles.length > 0) {
      const message = rejectedFiles.join(" ");
      if (showError) {
        showError(message);
      } else {
        setSaveError(message);
      }
    } else {
      setSaveError(null);
    }
    setSaveSuccess(false);
    setMissingAreaIndices([]);
    setMissingLabelIndices([]);
    if (rejectedFiles.length > 0) {
      requestAnimationFrame(() => {
        const el = document.querySelector(".pd-upload-area");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };
  
  const handlePreviewSelect = (filesOrEvent, { showError } = {}) => {
    if (!canEditDesignerAssets) return;
    const file = Array.from(filesOrEvent?.target?.files || filesOrEvent || [])[0];
    if (file) {
      const sizeError = validateOrderAssetSize({ bucket: DESIGNER_PREVIEW_BUCKET, file });

      if (sizeError) {
        if (showError) {
          showError(sizeError);
        } else {
          setSaveError(sizeError);
        }
        requestAnimationFrame(() => {
          const el = document.querySelector(".file-upload-zone, .pd-preview-container");
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        if (filesOrEvent?.target) filesOrEvent.target.value = "";
        return;
      }

      setPendingPreview(file);
      setPendingPreviewName(file.name);
      setSaveError(null);
      setSaveSuccess(false);
    }
    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };
  
  const removePendingFile = (index) => {
    if (!canEditDesignerAssets) return;
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
    setPendingFileAreas(prev => prev.filter((_, i) => i !== index));
    setPendingFileLabels(prev => prev.filter((_, i) => i !== index));
    setSaveSuccess(false);
    setMissingAreaIndices([]);
  };
  
  const handleSave = async () => {
    if (!canEditDesignerAssets) return;
    const missingAreas = pendingFiles
      .map((_, i) => (!pendingFileAreas[i] ? i : -1))
      .filter(i => i !== -1);
    const missingLabels = pendingFiles
      .map((_, i) => (!pendingFileLabels[i]?.trim() ? i : -1))
      .filter(i => i !== -1);

    setMissingAreaIndices(missingAreas);
    setMissingLabelIndices(missingLabels);

    if (missingAreas.length > 0 || missingLabels.length > 0) {
      setSaveError("missing-area");
      requestAnimationFrame(() => {
        const el = document.querySelector(".pd-file-missing");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    setMissingAreaIndices([]);
    setMissingLabelIndices([]);
    
    try {
      const updateData = {};
      
      if (pendingFiles.length > 0) {
        const fileUrls = [];
        for (let i = 0; i < pendingFiles.length; i++) {
          const file = pendingFiles[i];
          const publicUrl = await uploadOrderAsset({
            bucket: DESIGNER_FILES_BUCKET,
            path: buildDesignerAssetPath(order.id, "files", file),
            file,
          });

          if (!publicUrl) {
            throw new Error(`No se pudo obtener la URL pública de ${file.name}.`);
          }

          fileUrls.push(publicUrl);
        }
        
        if (fileUrls.length > 0) {
          const { data: orderData } = await supabase
            .from("orders")
            .select("order_file_url")
            .eq("id", order.id)
            .single();
          
          const existingUrls = parseOrderFileUrls(orderData?.order_file_url);

          const productionRows = buildProductionFileRows({
            orderId: order.id,
            urls: fileUrls,
            files: pendingFiles,
            areaCodes: pendingFileAreas,
            publicLabels: pendingFileLabels,
            userId: order.designer_id,
          });

          const { error: productionFilesError } = await supabase
            .from("order_production_files")
            .insert(productionRows);

          if (productionFilesError) {
            throw new Error("No se pudo guardar la clasificacion de produccion de los archivos.");
          }
          
          updateData.order_file_url = JSON.stringify([...existingUrls, ...fileUrls]);
        }
      }
      
      if (pendingPreview) {
        const publicUrl = await uploadOrderAsset({
          bucket: DESIGNER_PREVIEW_BUCKET,
          path: buildDesignerAssetPath(order.id, "preview", pendingPreview, "preview-"),
          file: pendingPreview,
        });

        if (!publicUrl) {
          throw new Error(`No se pudo obtener la URL pública de ${pendingPreview.name}.`);
        }

        updateData.preview_image = publicUrl;
      }
      
      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from("orders")
          .update(updateData)
          .eq("id", order.id);
        
        if (updateError) throw updateError;
      }
      
      if (onRefresh) await onRefresh();
      
      setPendingFiles([]);
      setPendingFileAreas([]);
      setPendingFileLabels([]);
      setPendingPreview(null);
      setPendingPreviewName(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving:", error);
      setSaveError(error?.message || "Error al guardar los archivos");
    } finally {
      setSaving(false);
    }
  };
  
  const handleClose = () => {
    setPendingFiles([]);
    setPendingFileAreas([]);
    setPendingFileLabels([]);
    setPendingPreview(null);
    setSaveSuccess(false);
    setSaveError(null);
    onClose();
  };
  
  const hasChanges = pendingFiles.length > 0 || pendingPreview !== null;
  
  const dbFiles = parseOrderFileUrls(order.order_file_url).map((url, i) => ({
    name: url.split('/').pop() || `archivo-${i + 1}`,
    url,
  }));
  
  const allFiles = [...(designerFiles || []), ...dbFiles];
  const uniqueFiles = allFiles.filter((f, i, arr) => arr.findIndex(x => x.url === f.url) === i);
  const hasPreview = !!displayPreview;
  const canSendToQuotation = canEditDesignerAssets && uniqueFiles.length > 0 && hasPreview && !hasChanges;
  
  return (
    <div className="pd-modal-overlay">
      <div className="pd-modal">
        <div className="pd-modal-stripe"></div>
        <div className="pd-modal-header">
          <div className="pd-modal-inner-header">
            <div className="pd-modal-title">
              <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
              <span className="pd-modal-subtitle">Detalles de la orden de trabajo</span>
            </div>
            <button className="pd-modal-close" onClick={handleClose}>
              <Icons.Close />
            </button>
          </div>
        </div>
        
        <div className="pd-modal-body">
          {saveSuccess && (
            <div className="pd-alert pd-alert-success">
              <Icons.Check />
              Archivos guardados correctamente
            </div>
          )}
          
          {saveError === "missing-area" && (
            <div className="pd-alert pd-alert-error">
              <Icons.X />
              <div>
                <div className="pd-file-error-title">Área de producción requerida</div>
                <div className="pd-file-error-desc">
                  No es posible guardar los cambios porque uno o más archivos adjuntos no tienen un área de producción asignada.
                  <br />
                  Por favor, selecciona un área de producción para cada archivo antes de continuar.
                </div>
              </div>
            </div>
          )}
          {saveError && saveError !== "missing-area" && (
            <div className="pd-alert pd-alert-error">
              <Icons.X />
              {saveError}
            </div>
          )}
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icons.User />
              <h4>Información del Cliente</h4>
            </div>
            <div className="pd-modal-grid">
              <div className="pd-modal-item">
                <span className="pd-modal-label">Cliente</span>
                <span className="pd-modal-value">{order.client_name || "No especificado"}</span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Vendedor</span>
                <span className="pd-modal-value highlight">{sellerName || "No especificado"}</span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Teléfono</span>
                {order.client_contact ? (
                  <a 
                    href={`https://wa.me/${order.client_contact.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pd-whatsapp-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    {order.client_contact}
                  </a>
                ) : <span className="pd-modal-value">No especificado</span>}
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Tipo de Orden</span>
                <span className="pd-modal-value">
                  {order.order_type === "orden 911" ? (
                    <span className="pd-badge-911">⚡ 911 - Urgente</span>
                  ) : (
                    <span className="pd-badge-normal">Normal</span>
                  )}
                </span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Fecha de Creación</span>
                <span className="pd-modal-value">{created}</span>
              </div>
            </div>
          </div>
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icons.Package />
              <h4>Detalles del Trabajo</h4>
              {isReturnedOrder(order) && <ReturnedBadge />}
            </div>
            <div className="pd-modal-grid">
              <div className="pd-modal-item full">
                <span className="pd-modal-label">Descripción</span>
                <p className="pd-modal-description">{order.description || "Sin descripción"}</p>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Material</span>
                <span className="pd-modal-value highlight">{order.material || "No especificado"}</span>
              </div>
              {order.width && order.height && (
                <div className="pd-modal-item">
                  <span className="pd-modal-label">Dimensiones</span>
                  <span className="pd-modal-value">{order.width} x {order.height} cm</span>
                </div>
              )}
              {order.quantity && (
                <div className="pd-modal-item">
                  <span className="pd-modal-label">Cantidad</span>
                  <span className="pd-modal-value">{order.quantity} unidades</span>
                </div>
              )}
            </div>
          </div>

          {isReturnedOrder(order) && (
            <div className="pd-modal-card">
              <div className="pd-modal-card-title">
                <Icons.X />
                <h4>Motivo de devolución</h4>
              </div>
              <div className="pd-return-note">
                <p>{returnedReason}</p>
              </div>
            </div>
          )}
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icons.File />
              <h4>Archivos del Diseño</h4>
              {hasChanges && <span className="pd-pending-badge">Cambios pendientes</span>}
            </div>

            {!canEditDesignerAssets && (
              <div className={`pd-readonly-note ${isCancelledReadonly ? "pd-readonly-note-cancelled" : ""}`}>
                <Icons.Check />
                {readonlyMessage}
              </div>
            )}
            
            {canEditDesignerAssets ? (
              <FileUploadZone
                mode="attachment"
                multiple
                buttonLabel="Agregar archivo"
                hint={`Archivos hasta ${formatFileSize(getOrderAssetLimit(DESIGNER_FILES_BUCKET))} se guardarán al hacer clic en "Guardar cambios"`}
                onFilesAccepted={handleFileSelect}
              />
            ) : (
              <div className="pd-upload-area pd-upload-area-disabled">
                <Icons.File />
                <span className="pd-upload-hint">Los archivos ya no se pueden modificar después de enviarse a caja.</span>
              </div>
            )}
            {/* Contenedor de para ver todos los arhivos seleccionados */}
            {pendingFiles.length > 0 && (
              <div className="pd-files-container">
                <span className="pd-files-label">Archivos pendientes ({pendingFiles.length})</span>
                {pendingFiles.map((file, i) => (
                  <div key={i} className={missingLabelIndices.includes(i) || missingAreaIndices.includes(i) ? 'pd-file-missing' : ''}>
                    <FileCard
                      name={file.name}
                      secondaryText={formatFileSize(file.size)}
                      onRemove={() => removePendingFile(i)}
                    >
                      <div className="production-file-meta pd-production-file-fields">
                        <label className="production-file-field">
                          <span className="production-file-field-label">Nombre visible en seguimiento</span>
                          <input
                            className={`pd-input${missingLabelIndices.includes(i) ? " pd-input-error" : ""}`}
                            value={pendingFileLabels[i] || ""}
                            onChange={(event) => {
                              setPendingFileLabels(pendingFileLabels.map((label, idx) => idx === i ? event.target.value : label));
                              setMissingLabelIndices([]);
                            }}
                            placeholder="Ej: Banner principal"
                            aria-label={`Nombre visible en seguimiento de ${file.name}`}
                          />
                        </label>
                        <label className="production-file-field">
                          <span className="production-file-field-label">Área de producción</span>
                          <ProductionAreaSelect
                            value={pendingFileAreas[i]}
                            isError={missingAreaIndices.includes(i)}
                            onChange={(value) => {
                              setPendingFileAreas(pendingFileAreas.map((area, idx) => idx === i ? value : area));
                              setMissingAreaIndices([]);
                            }}
                          />
                        </label>
                      </div>
                    </FileCard>
                  </div>
                ))}
              </div>
            )}
            
            {uniqueFiles.length > 0 && (
              <div className="pd-files-container" style={{ marginTop: pendingFiles.length > 0 ? '12px' : '0' }}>
                <span className="pd-files-label">Archivos guardados ({uniqueFiles.length})</span>
                {uniqueFiles.map((file, i) => (
                  <FileCard
                    key={i}
                    name={file.name}
                    url={file.url}
                  />
                ))}
              </div>
            )}
          </div>
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icons.Image />
              <h4>Vista Previa</h4>
            </div>
            
            <div className="pd-preview-container">
              {displayPreview ? (
                <>
                  <img src={displayPreview} alt="Preview" className="pd-preview-image" />
                  {pendingPreview && <span className="pd-preview-badge">Nuevo</span>}
                  {pendingPreviewName && <span className="pd-file-name-badge">{pendingPreviewName}</span>}
                  <div className="pd-preview-overlay">
                    <a href={displayPreview} target="_blank" rel="noopener noreferrer" className="pd-file-action" style={{ background: 'white', color: '#0f172a' }}>
                      <Icons.Eye />
                    </a>
                    {canEditDesignerAssets && (
                      <>
                        <FileUploadZone
                          mode="image"
                          replaceMode
                          className="file-upload-zone--hidden-picker"
                          inputRef={designerPreviewInputRef}
                          buttonLabel="Cambiar preview"
                          onFilesAccepted={handlePreviewSelect}
                        />
                        <button className="pd-file-action" style={{ background: 'white', color: '#0f172a' }} onClick={() => designerPreviewInputRef.current?.click()}>
                          <Icons.Edit />
                        </button>
                        <button className="pd-file-action remove" style={{ background: 'white' }} onClick={() => { setPendingPreview(null); setPendingPreviewName(null); setSaveSuccess(false); }}>
                          <Icons.Trash />
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                canEditDesignerAssets ? (
                  <FileUploadZone
                    mode="image"
                    replaceMode
                    buttonLabel="Subir orden de trabajo"
                    hint={`Max. ${formatFileSize(getOrderAssetLimit(DESIGNER_PREVIEW_BUCKET))}`}
                    onFilesAccepted={handlePreviewSelect}
                  />
                ) : (
                  <div className="pd-preview-empty pd-preview-empty-disabled">
                    <Icons.Image />
                    <span>La preview permanece disponible solo para consulta.</span>
                  </div>
                )
              )}
            </div>
          </div>

          {referenceImageUrls.length > 0 && (
            <div className="pd-modal-card">
              <div className="pd-modal-card-title">
                <Icons.Image />
                <h4>Imágenes de referencia</h4>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "4px 0" }}>
                {referenceImageUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flex: "0 0 auto" }}>
                    <img
                      src={url}
                      alt={`Ref ${i + 1}`}
                      style={{
                        width: 120,
                        height: 120,
                        objectFit: "cover",
                        borderRadius: "var(--pd-radius-md)",
                        border: "1px solid var(--pd-border)",
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
          
          {/* <div className="pd-status-bar">
            <div className="pd-status-item">
              <span className="pd-status-label">Estado</span>
              <StatusBadge status={order.status} className="pd-badge" />
            </div>
          </div> */}
        </div>
        {/* Footer Modal */}
        <div className="pd-modal-footer">
          {/* Boton para cerral el modal */}
          <button className="pd-btn pd-btn-secondary" onClick={handleClose}>
            Cerrar
          </button>
          {canSendToQuotation && (
            <button
              className="pd-btn pd-btn-quotation"
              onClick={() => onSendToQuotation?.(order)}
              disabled={quotationSending}
            >
              {quotationSending ? (
                <>
                  <span className="pd-btn-spinner"></span>
                  Enviando...
                </>
              ) : (
                <>
                  <Icons.Send />
                  Enviar a caja
                </>
              )}
            </button>
          )}
          {/* Boton para guardar cambios   */}
          <button 
            className="pd-btn pd-btn-primary" 
            onClick={handleSave}
            disabled={!canEditDesignerAssets || !hasChanges || saving}
          >
            {saving ? (
              <>
                <span className="pd-btn-spinner"></span>
                Guardando...
              </>
            ) : (
              <>
                <Icons.Check />
                Guardar cambios
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PageDesigner() {
  const navigate = useNavigate();
  const { user: authUser, signOut } = useAuth();
  const [nowTimestamp] = useState(() => Date.now());
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [clients, setClients] = useState([]);
  const [viewMode, setViewMode] = useState("cards");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [viewedOrders, setViewedOrders] = useState(() => {
    try {
      const saved = localStorage.getItem("pd_viewed_orders");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [editedOrders, setEditedOrders] = useState(() => {
    try {
      const saved = localStorage.getItem(EDITED_ORDERS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [orderFiles, setOrderFiles] = useState({});
  const [orderPreviews, setOrderPreviews] = useState({});
  const notif = useNotifications(user?.id);
  const [sendingToQuotation, setSendingToQuotation] = useState(null);
  const [originalQuoterId, setOriginalQuoterId] = useState(null);
  const [quotationSending, setQuotationSending] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  
  const ordersRef = useRef([]);
  const viewedOrdersRef = useRef({});
  const userRef = useRef(null);
  const knownOrderIdsRef = useRef(new Set());
  const previousOrdersRef = useRef({});
  const ordersInitializedRef = useRef(false);
  const mainScrollRef = useRef(null);

  const fetchOrders = async () => {
    if (!userRef.current) return;

    const { data, error } = await supabase
      .from("orders")
      .select(DESIGNER_ORDER_SELECT)
      .eq("designer_id", userRef.current.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const nextOrderIds = new Set(data.map(order => order.id));
      const previousOrders = previousOrdersRef.current;

      if (!ordersInitializedRef.current) {
        knownOrderIdsRef.current = nextOrderIds;
        previousOrdersRef.current = data.reduce((acc, order) => {
          acc[order.id] = order;
          return acc;
        }, {});
        ordersInitializedRef.current = true;
        ordersRef.current = data;
        setOrders(data);
        setLoading(false);
        return;
      }

      data.forEach(order => {
        const previousOrder = previousOrders[order.id];

        if (
          previousOrder &&
          !isOrderStatus(order.status, ORDER_STATUS.CANCELLED) &&
          !hasReturnUpdate(previousOrder, order) &&
          hasTrackedOrderChanges(previousOrder, order)
        ) {
          setEditedOrders(prev => ({ ...prev, [order.id]: Date.now() }));
        }
      });

      knownOrderIdsRef.current = nextOrderIds;
      previousOrdersRef.current = data.reduce((acc, order) => {
        acc[order.id] = order;
        return acc;
      }, {});
      ordersRef.current = data;
      setOrders(data);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

  useEffect(() => {
    localStorage.setItem("pd_viewed_orders", JSON.stringify(viewedOrders));
  }, [viewedOrders]);

  useEffect(() => {
    viewedOrdersRef.current = viewedOrders;
  }, [viewedOrders]);

  useEffect(() => {
    localStorage.setItem(EDITED_ORDERS_STORAGE_KEY, JSON.stringify(editedOrders));
  }, [editedOrders]);

  useEffect(() => {
    const mainNode = mainScrollRef.current;
    if (!mainNode) return;

    const resetHorizontalScroll = () => {
      mainNode.scrollLeft = 0;
    };

    resetHorizontalScroll();
    const frameId = window.requestAnimationFrame(resetHorizontalScroll);

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab]);



  const handleViewOrder = async (order) => {
    setEditedOrders(prev => {
      if (!prev[order.id]) return prev;
      const next = { ...prev };
      delete next[order.id];
      return next;
    });

    const { data } = await supabase
      .from("orders")
      .select(DESIGNER_ORDER_SELECT)
      .eq("id", order.id)
      .single();
    
    if (data) {
      setSelectedOrder(data);
    } else {
      setSelectedOrder(order);
    }
    
    setViewedOrders(prev => {
      if (prev[order.id]) return prev;
      return { ...prev, [order.id]: Date.now() };
    });
  };

  useEffect(() => {
    setUser(authUser || null);
    userRef.current = authUser || null;
  }, [authUser]);

  useEffect(() => {
    if (!user?.id) return;
    fetchOrders();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`designer-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => fetchOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    return () => {

    };
  }, []);

  const isNewOrder = (order) => {
    if (viewedOrders[order.id]) return false;
    const createdAt = new Date(order.created_at).getTime();
    const hoursAgo = (nowTimestamp - createdAt) < 24 * 60 * 60 * 1000;
    return hoursAgo;
  };

  const isEditedOrder = (order) => {
    return !!editedOrders[order.id];
  };

  const _canArchiveDesignerOrder = (order) => (
    canArchiveOrder(order, ARCHIVE_MODULES.DESIGNER, user?.id)
  );

  const displayName =
    user?.user_metadata?.display_name ||
    user?.displayName ||
    user?.email?.split("@")[0] ||
    "Disenador";

  const todayLabel = new Date().toLocaleDateString("es-DO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const activeOrdersCount = orders.filter(order => (
    !order.is_archived_designer &&
    !isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED])
  )).length;

  const returnedOrdersCount = orders.filter(o => isReturnedOrder(o)).length;

  const metrics = useMemo(() => [
    { label: "Órdenes activas", value: activeOrdersCount, sub: "Asignadas a tu bandeja", accentIdx: 0, icon: <Icons.Package /> },
    { label: "En caja", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_QUOTE)).length, sub: "Listas para seguir flujo", accentIdx: 1, icon: <Icons.Send /> },
    { label: "Devueltas", value: returnedOrdersCount, sub: "Requieren corrección", accentIdx: 2, icon: <Icons.X /> },
    { label: "En producción", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_PRODUCTION)).length, sub: "Siendo producidas", accentIdx: 3, icon: <Icons.Package /> },
  ], [activeOrdersCount, returnedOrdersCount, orders]);

  const filteredOrders = orders.filter((order) => {
    const query = search.trim().toLowerCase();
    const searchableValues = [
      order.client_name,
      order.description,
      order.id,
      order.material,
    ];

    const matchesSearch = !query || searchableValues.some((value) =>
      String(value || "").toLowerCase().includes(query)
    );

    const matchesType = filterType === "all" || (
      filterType === "911"
        ? order.order_type === "orden 911"
        : order.order_type !== "orden 911"
    );

    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesClient = orderMatchesClientFilter(order, filterClient);

    const matchesArchive =
      filterArchive === "all" ||
      (filterArchive === "active" && !order.is_archived_designer) ||
      (filterArchive === "archived" && order.is_archived_designer);

    const createdAt = new Date(order.created_at);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const matchesDate =
      filterDate === "all" ||
      (filterDate === "today" && createdAt >= startOfToday) ||
      (filterDate === "yesterday" && createdAt >= startOfYesterday && createdAt < startOfToday) ||
      (filterDate === "3days" && createdAt >= threeDaysAgo) ||
      (filterDate === "7days" && createdAt >= sevenDaysAgo) ||
      (filterDate === "month" && createdAt >= startOfMonth);

    return matchesSearch && matchesType && matchesStatus && matchesClient && matchesDate && matchesArchive;
  });

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const shouldEnableOrdersScroll = filteredOrders.length > 7;

  const fetchOrderFiles = async (orderId) => {
    try {
      const { data, error } = await supabase.storage
        .from("order-docs")
        .list(`orders/${orderId}/files/`);

      if (!error && data) {
        const files = data.map(f => ({
          name: f.name,
          url: supabase.storage.from("order-docs").getPublicUrl(`orders/${orderId}/files/${f.name}`).data.publicUrl
        }));
        setOrderFiles(prev => ({ ...prev, [orderId]: files }));
      }
    } catch (err) {
      console.error("Error fetching files:", err);
    }
  };

  const fetchOrderPreview = async (orderId) => {
    try {
      const { data, error } = await supabase.storage
        .from("order-previews")
        .list(`orders/${orderId}/preview/`);

      if (!error && data && data.length > 0) {
        const latest = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        const url = supabase.storage.from("order-previews").getPublicUrl(`orders/${orderId}/preview/${latest.name}`).data.publicUrl;
        setOrderPreviews(prev => ({ ...prev, [orderId]: url }));
      }
    } catch (err) {
      console.error("Error fetching preview:", err);
    }
  };

  useEffect(() => {
    orders.forEach(order => {
      fetchOrderFiles(order.id);
      fetchOrderPreview(order.id);
    });
  }, [orders]);

  const refreshOrderFromDB = async (orderId) => {
    const { data } = await supabase.from("orders").select(DESIGNER_ORDER_SELECT).eq("id", orderId).single();
    if (data) {
      setOrders(prev => prev.map(o => o.id === orderId ? data : o));
      setSelectedOrder(data);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const handleOpenSendToQuotation = (order) => {
    const wasReturned = isReturnedOrder(order);
    const originalQuoterId = wasReturned ? (order.quote_id || "") : null;
    setSendingToQuotation(order);
    if (wasReturned && originalQuoterId) {
      setOriginalQuoterId(originalQuoterId);
    }
  };

  const handleOpenArchiveOrder = (order) => {
    if (!canArchiveOrder(order, ARCHIVE_MODULES.DESIGNER, user?.id)) return;
    setArchivingOrder(order);
  };

  const handleConfirmArchiveDesignerOrder = async () => {
    if (!archivingOrder) return;
    setArchiveLoading(true);
    const { error } = await archiveOrder(archivingOrder, ARCHIVE_MODULES.DESIGNER);
    setArchiveLoading(false);
    if (error) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al archivar",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo archivar la orden.",
      });
      return;
    }
    setOrders(prev => prev.map(order => (
      order.id === archivingOrder.id
        ? { ...order, is_archived_designer: true }
        : order
    )));
    if (selectedOrder?.id === archivingOrder.id) {
      setSelectedOrder(prev => prev ? { ...prev, is_archived_designer: true } : prev);
    }
    setArchivingOrder(null);
  };

  const handleConfirmSendToQuotation = async (quoteUserId) => {
    if (!sendingToQuotation) return;

    setQuotationSending(true);

    const assignmentPayloads = [
      { status: ORDER_STATUS.IN_QUOTE, quote_id: quoteUserId, return_reason: null, returned_to_designer_at: null },
    ];

    let updateError = null;

    for (const payload of assignmentPayloads) {
      const { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", sendingToQuotation.id);

      if (!error) {
        updateError = null;
        break;
      }

      updateError = error;
    }

    setQuotationSending(false);

    if (updateError) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al enviar",
        orderTitle: sendingToQuotation.client_name || sendingToQuotation.description || `Orden #${sendingToQuotation.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo enviar la orden a caja. Verifica la asignación o el estado.",
      });
      return;
    }

    const updatedOrder = {
      ...sendingToQuotation,
      status: ORDER_STATUS.IN_QUOTE,
      return_reason: null,
      returned_to_designer_at: null,
    };

    setOrders(prev => prev.map(order => (
      order.id === sendingToQuotation.id
        ? { ...order, status: ORDER_STATUS.IN_QUOTE, return_reason: null, returned_to_designer_at: null }
        : order
    )));
    setSelectedOrder(updatedOrder);
    setSendingToQuotation(null);

  };

  return (
    <div className="pd-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={displayName}
        role="Diseñador"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
          { id: "orders", label: "Mis Órdenes", icon: <Icons.Orders />, badge: activeOrdersCount }
        ]}
        onLogout={handleLogout}
      />

      

      <div className="pd-main-wrap">
        <header className="pd-topbar">
          <div className="pd-topbar-left">
            {/* Boton para abril y cerral slidebar */}
            <button className="ps-icon-btn" onClick={() => setSidebarOpen(p => !p)}>
              {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
            </button>
            <div>
              <div className="pd-page-title">{activeTab === "dashboard" ? "Dashboard Diseñador" : "Gestión de órdenes"}</div>
              <div className="pd-page-date">{todayLabel}</div>
            </div>
          </div>

          <div className="pd-topbar-right">
            {/* Notificaciones */}
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

            {/* Botón para cambiar entre dashboard y órdenes */}
            <button
              className="pd-topbar-switch"
              onClick={() => setActiveTab(activeTab === "dashboard" ? "orders" : "dashboard")}
            >
              <div className="pd-topbar-switch-inner">
                {activeTab === "dashboard" ? <Icons.Orders /> : <Icons.Dashboard />}
                {activeTab === "dashboard" ? "Ver órdenes" : "Ver tablero"}
              </div>
              <div className="pd-topbar-switch-stripe" />
            </button>
          </div>
        </header>
        {/* Contenedor con Contenido principal */}
        <main className="pd-main-content" ref={mainScrollRef}>
          {activeTab === "dashboard" && (
            <>
              <div className="pd-greeting">
                <h2>Buen día, <span className="pd-user-name">{displayName}</span></h2>
                <p>Aqui tienes el resumen de tu actividad de hoy.</p>
              </div>
              
              <div className="pd-metrics">
                {metrics.map((m, i) => (
                  <MetricCard key={i} {...m} />
                ))}
              </div>
              
            <section className="pd-panel pd-recent-section">
              <div className="pd-panel-stripe" />
                <div className="pd-panel-header">
                  <div>
                    <div className="pd-panel-title">Órdenes recientes</div>
                    <div className="pd-panel-sub">Las últimas asignaciones del área de diseño.</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="pd-recent-count">{orders.length} orden{orders.length !== 1 ? "es" : ""}</span>
                    <button className="pd-link-btn" onClick={() => setActiveTab("orders")}>
                      Ver todas <Icons.ArrowRight />
                    </button>
                  </div>
                </div>
                {loading ? (
                  <div className="pd-loading">Cargando órdenes...</div>
                ) : orders.length === 0 ? (
                  <div className="pd-empty">No tienes órdenes asignadas.</div>
                ) : (
                  <div className="pd-table-wrap" style={{ padding: "12px 16px 16px" }}>
                    <table className="pd-table" style={{ border: "none", background: "none" }}>
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Descripción</th>
                          <th>Estado</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.slice(0, 5).map(order => (
                          <tr key={order.id} className="row-hover" onClick={() => handleViewOrder(order)}>
                            <td className="pd-td-pad pd-td-client">
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontSize: 10, color: "var(--pd-text-muted)", letterSpacing: "0.06em", fontFamily: "'SF Mono','Monaco',monospace" }}>#{order.id?.slice(0, 8).toUpperCase()}</span>
                                <span style={{ fontWeight: 600, color: "var(--pd-text)", fontSize: 13 }}>{order.client_name}</span>
                              </div>
                            </td>
                            <td className="pd-td-pad" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--pd-text-sub)", fontSize: 13 }}>
                              {order.description?.length > 20 ? order.description.substring(0, 20) + "..." : order.description || "Sin descripción"}
                            </td>
                            <td className="pd-td-pad">
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                {isReturnedOrder(order) && <ReturnedBadge compact />}
                                {hasFiles(order, orderFiles) && <AttachmentIndicator compact />}
                                {isNewOrder(order) && <span className="pd-badge-new">Nuevo</span>}
                                {isEditedOrder(order) && <span className="pd-badge-edited">Editada</span>}
                                <StatusBadge status={order.status} className="pd-badge" bordered />
                              </div>
                            </td>
                            <td className="pd-td-pad">
                              <button className="pd-table-action-btn view" title="Ver detalle" onClick={(event) => { event.stopPropagation(); handleViewOrder(order); }}>
                                <Icons.Eye />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === "orders" && (
            <>
              {/* Componetes cabezero del apartado de diseñador */}
              <div className="pd-section-heading">
                <div>
                  <h2>Gestión de órdenes</h2>
                </div>
              </div>

              <section className="pd-panel">
                <div className="pd-panel-stripe" />
                <div className="pd-panel-header">
                  <div>
                    <div className="pd-panel-sub">Todo tu flujo de trabajo en un solo lugar.</div>
                  </div>
                  <div className="pd-card-actions">
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => setViewMode("cards")} className={`pd-view-toggle ${viewMode === "cards" ? "active" : ""}`} title="Vista de tarjetas">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                      </button>
                      <button onClick={() => setViewMode("table")} className={`pd-view-toggle ${viewMode === "table" ? "active" : ""}`} title="Vista de tabla">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                      </button>
                    </div>
                    <span className="pd-recent-count">{filteredOrders.length} visible{filteredOrders.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>

                <div className="pd-filters">
                  <div className="pd-search-wrap">
                    <span className="pd-search-icon"><Icons.Search /></span>
                    <input 
                      className="pd-input" 
                      placeholder="Buscar por cliente, ID o descripción..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="pd-select-wrap">
                    <select className="pd-input" value={filterType} onChange={e => setFilterType(e.target.value)}>
                      <option value="all">Todos los tipos</option>
                      <option value="normal">Normal</option>
                      <option value="911">911 - Urgente</option>
                    </select>
                  </div>
                  <div className="pd-select-wrap">
                    <select className="pd-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                      <option value="all">Todos los estados</option>
                      <option value={ORDER_STATUS.IN_DESIGN}>En Diseño</option>
                      <option value={ORDER_STATUS.IN_QUOTE}>Caja</option>
                      <option value={ORDER_STATUS.IN_PRODUCTION}>Producción</option>
                      <option value={ORDER_STATUS.IN_COMPLETED}>Completada</option>
                    </select>
                  </div>
                  <div className="pd-select-wrap">
                    <select className="pd-input" value={filterDate} onChange={e => setFilterDate(e.target.value)}>
                      <option value="all">Todas las fechas</option>
                      <option value="today">Hoy</option>
                      <option value="yesterday">Ayer</option>
                      <option value="3days">Últimos 3 días</option>
                      <option value="7days">Últimos 7 días</option>
                      <option value="month">Este mes</option>
                    </select>
                  </div>
                  <div className="pd-select-wrap">
                    <ClientFilterSelect
                      clients={clients}
                      value={filterClient}
                      onChange={setFilterClient}
                      className="pd-input"
                      allLabel="Todos los clientes"
                    />
                  </div>
                  <div className="pd-select-wrap">
                    <select className="pd-input" value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                      <option value="active">Activas</option>
                      <option value="archived">Archivadas</option>
                      <option value="all">Todas</option>
                    </select>
                  </div>
                </div>

                {loading ? (
                  <div className="pd-loading">Cargando órdenes...</div>
                ) : filteredOrders.length === 0 ? (
                  <div className="pd-empty">No hay órdenes que coincidan con los filtros.</div>
                ) : viewMode === "table" ? (
                  <div className={`pd-table-wrap ${shouldEnableOrdersScroll ? "pd-orders-scroll" : ""}`}>
                    <table className="pd-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Cliente</th>
                          <th>Descripción</th>
                          <th>Material</th>
                          <th>Tipo</th>
                          <th>Estado</th>
                          <th>Fecha</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOrders.map(order => (
                          <tr key={order.id} className="row-hover">
                            <td className="pd-td-pad pd-td-id">
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <span>#{order.id?.slice(0, 8).toUpperCase()}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                  {isReturnedOrder(order) && <ReturnedBadge compact />}
                                  {hasFiles(order, orderFiles) && <AttachmentIndicator compact />}
                                  {isNewOrder(order) && <span className="pd-badge-new">Nuevo</span>}
                                  {isEditedOrder(order) && <span className="pd-badge-edited">Editada</span>}
                                </div>
                              </div>
                            </td>
                            <td className="pd-td-pad pd-td-client">{order.client_name}</td>
                            <td className="pd-td-pad pd-td-desc">{order.description}</td>
                            <td className="pd-td-pad pd-td-material">{order.material}</td>
                            <td className="pd-td-pad pd-td-type">
                              {order.order_type === "orden 911" ? <span className="pd-card-911">911</span> : <span className="pd-badge-normal-table">Normal</span>}
                            </td>
                            <td className="pd-td-pad"><StatusBadge status={order.status} className="pd-badge" bordered /></td>
                            <td className="pd-td-pad pd-td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                            <td className="pd-td-pad pd-td-actions">
                              <div className="pd-table-actions">
                                <button className="pd-table-action-btn view" title="Ver detalle" onClick={() => handleViewOrder(order)}>
                                  <Icons.Eye />
                                </button>
                                {_canArchiveDesignerOrder(order) ? (
                                  <button className="pd-table-action-btn archive" title="Archivar" onClick={() => handleOpenArchiveOrder(order)}>
                                    <Icons.Archived />
                                  </button>
                                ) : order.is_archived_designer ? (
                                  <button className="pd-table-action-btn archive" disabled title="Orden archivada">
                                    <Icons.Check />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={`pd-cards-grid ${shouldEnableOrdersScroll ? "pd-orders-scroll" : ""}`}>
                    {paginatedOrders.map(order => (
                      <div key={order.id} className="pd-order-card" onClick={() => handleViewOrder(order)}>
                        <div className="pd-card-header">
                          <span className="pd-card-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                          <div className="pd-card-badges">
                            {isReturnedOrder(order) && <ReturnedBadge compact />}
                            {hasFiles(order, orderFiles) && <AttachmentIndicator compact />}
                            {isNewOrder(order) && <span className="pd-badge-new">Nuevo</span>}
                            {isEditedOrder(order) && <span className="pd-badge-edited">Editada</span>}
                            <StatusBadge status={order.status} className="pd-badge" bordered />
                          </div>
                        </div>
                        <div className="pd-card-client">{order.client_name}</div>
                        <div className="pd-card-desc">{order.description}</div>
                        <div className="pd-card-meta">
                          <span className="pd-card-material">{order.material}</span>
                        </div>
                        <div className="pd-card-footer">
                          <span className="pd-card-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}</span>
                          {order.order_type === "orden 911"
                            ? <span className="pd-badge" style={{ background: "#FEF2F2", color: "#991B1B", borderRadius: "4px", fontSize: "10px", padding: "3px 8px" }}>911</span>
                            : <span className="pd-badge" style={{ background: "#E8EDF8", color: "#0f1e40", borderRadius: "4px", fontSize: "10px", padding: "3px 8px" }}>Normal</span>
                          }
                        </div>
                        <div className="pd-card-actions-bar">
                          <button className="pd-card-action-btn view" onClick={(event) => { event.stopPropagation(); handleViewOrder(order); }} title="Ver detalles">
                            <Icons.Eye />
                          </button>
                          {_canArchiveDesignerOrder(order) ? (
                            <button className="pd-card-action-btn archive" onClick={(event) => { event.stopPropagation(); handleOpenArchiveOrder(order); }} title="Archivar">
                              <Icons.Archived />
                            </button>
                          ) : order.is_archived_designer ? (
                            <button className="pd-card-action-btn archive" disabled title="Orden archivada" style={{ opacity: 0.5, cursor: "not-allowed" }}>
                              <Icons.Check />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
              </section>
            </>
          )}
        </main>
      </div>


      <OrderDetailModal 
        open={!!selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        order={selectedOrder}
        designerFiles={selectedOrder ? orderFiles[selectedOrder.id] : []}
        designerPreview={selectedOrder ? orderPreviews[selectedOrder.id] : null}
        onSendToQuotation={handleOpenSendToQuotation}
        quotationSending={quotationSending}
        onRefresh={() => {
          if (selectedOrder) {
            fetchOrderFiles(selectedOrder.id);
            refreshOrderFromDB(selectedOrder.id);
          }
        }}
      />
      <AssignModal
        open={!!sendingToQuotation}
        onClose={() => { setSendingToQuotation(null); setOriginalQuoterId(null); }}
        onConfirm={handleConfirmSendToQuotation}
        order={sendingToQuotation}
        loading={quotationSending}
        role="quote"
        defaultUserId={originalQuoterId || ""}
        description="Confirma que agregaste los archivos correctos antes de enviar esta orden al proceso de caja."
      />
      <ArchiveOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchiveDesignerOrder}
        order={archivingOrder}
        loading={archiveLoading}
      />
    </div>
  );
}
