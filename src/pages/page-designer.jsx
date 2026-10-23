import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-seller.css";
import "../components/clients/AdminClientsModule.css";
import "../css-components/page-designer.css";
import "../css-components/page-production.css";
import Sidebar from "../components/Sidebar";
import { Icons } from "../utils/icons";
import { AssignModal } from "../components/ui/AssignModal";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import FileUploadZone from "../components/ui/FileUploadZone";
import OrderReviewCard from "../components/orders/OrderReviewCard";
import OrderReviewBadge from "../components/orders/OrderReviewBadge";
import NewOrderBadge from "../components/orders/NewOrderBadge";
import {
  canArchiveOrder,
  archiveOrder,
} from "../utils/archive";
import { ORDER_STATUS, FLOW_STEPS, FLOW_STEPS_EXTERNAL, isOrderStatus, isOrderStatusIn, isPaymentProductionEligible, ARCHIVE_MODULES, getFileNameFromUrl } from "../utils/constants";
import { isOrderOverdue } from "../utils/orderDeadline";
import { isProductionFileDetailsComplete } from "../utils/production";
import { StatusBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import { FilterSelect } from "../components/ui/FilterSelect";
import CreateClientModal from "../components/ui/CreateClientModal";
import MaterialFormModal from "../components/materials/MaterialFormModal";
import "../components/ui/FilterSelect.css";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import useOrderEventReviews from "../hooks/useOrderEventReviews";
import useOrderReturnHandoffs from "../hooks/useOrderReturnHandoffs";
import useNewOrderAssignments from "../hooks/useNewOrderAssignments";
import useOrdersRealtimeSync from "../hooks/useOrdersRealtimeSync";
import NotificationCenter from "../components/NotificationCenter";
import FileCard from "../components/FileCard";
import { buildStorageSafeFileName, formatFileSize, getOrderAssetLimit, uploadOrderAsset, validateOrderAssetSize } from "../utils/uploadOrderAsset";
import { resolveOrderAssetUrl } from "../utils/fileAccess";
import { loadClients, orderMatchesClientFilter, searchClients, formatPhone } from "../utils/clients";
import { getOrderFiles, getPreviewImage, getReferenceImages } from "../utils/orderAssets";
import { canDecodeAsImage, compressImage, REF_IMAGE_CONFIG, validateReferenceImages } from "../utils/imageValidation";
import { buildProductionFileRows } from "../utils/production";
import { buildProductionCatalogs } from "../utils/production";
import SharedCreateOrderModal, { ProductionFileDetailsModal } from "../components/orders/CreateOrderModal";
import ProductionAssignmentModal from "../components/orders/ProductionAssignmentModal";
import DesignerProfileModule from "../components/designer/DesignerProfileModule";
import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule";
import ReturnToCashierModal from "../components/orders/ReturnToCashierModal";
import ReturnToDesignerModal from "../components/orders/ReturnToDesignerModal";
import { OrderReturnHandoffPanel } from "../components/orders/OrderReturnHandoff";
import { isReturnedDesignerOrder, shouldMarkDesignerOrderEdited } from "../utils/designerOrderEdits";
import { FlowTracker } from "../components/FlowTracker";
import OrderTrackingLink from "../components/orders/OrderTrackingLink";
import { OrderParticipationTimelineContent } from "../components/orders/OrderParticipationTimeline";
import { useOrderParticipation } from "../hooks/useOrderParticipation";
import { applyOrdersSnapshot } from "../utils/orderRealtime";

const EDITED_ORDERS_STORAGE_KEY = "pd_edited_orders";
const PER_PAGE = 15;
const DESIGNER_CARD_PAGE_SIZE = 10;
const getPendingReferenceFileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;
const DESIGNER_ORDER_SELECT = [
  "id",
  "client_name",
  "client_contact",
  "order_type",
  "created_at",
  "updated_at",
  "updated_by",
  "description",
  "material",
  "status",
  "payment_status",
  "order_design_type",
  "production_authorized_at",
  "production_authorized_by",
  "operational_status",
  "return_reason",
  "returned_to_designer_at",
  "order_file_url",
  "preview_image",
  "reference_images",
  "designer_id",
  "seller_id",
  "created_by",
  "tracking_token",
  "is_archived_designer",
  "quote_id",
  "quantity",
  "order_production_files(id, order_id, url, filename, public_label, production_area_code, material_names, termination_name)",
  "order_files(id, provider, bucket, object_key, original_filename, content_type, category, status, deleted_at, uploaded_by)",
].join(", ");
const isReturnedOrder = isReturnedDesignerOrder;

const canDesignerRouteInternalOrderToProduction = (order, actorId) => {
  const productionFiles = Array.isArray(order?.order_production_files) ? order.order_production_files : [];
  const filesReady = productionFiles.length > 0 && productionFiles.every((file) => (
    Boolean(file?.production_area_code)
    && (Array.isArray(file?.material_names) ? file.material_names.length > 0 : Boolean(file?.material_names))
    && Boolean(String(file?.termination_name || "").trim())
  ));

  const canRouteDesign = order?.order_design_type === "INTERNAL_DESING"
    || (order?.order_design_type === "EXTERNAL_DESING" && order?.created_by === actorId);

  return Boolean(
    actorId
    && canRouteDesign
    && order?.designer_id === actorId
    && isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE)
    && isPaymentProductionEligible(order?.payment_status)
    && Boolean(order?.production_authorized_at && order?.production_authorized_by)
    && !order?.is_archived_designer
    && order?.operational_status !== "blocked"
    && filesReady
  );
};

const canDesignerSendInternalOrderToQuote = (order, actorId) => {
  const files = Array.isArray(order?.order_production_files) ? order.order_production_files : [];
  const filesReady = files.length > 0 && files.every((file) => (
    Boolean(file?.production_area_code)
    && (Array.isArray(file?.material_names) ? file.material_names.length > 0 : Boolean(file?.material_names))
    && Boolean(String(file?.termination_name || "").trim())
  ));
  const canSendDesign = order?.order_design_type === "INTERNAL_DESING"
    || (order?.order_design_type === "EXTERNAL_DESING" && order?.created_by === actorId);

  return Boolean(
    actorId
    && canSendDesign
    && order?.designer_id === actorId
    && isOrderStatus(order?.status, ORDER_STATUS.IN_DESIGN)
    && !order?.is_archived_designer
    && order?.operational_status !== "blocked"
    && filesReady
  );
};

const canDesignerReturnInternalOrderToSales = (order, actorId) => Boolean(
  actorId && order?.created_by !== actorId && order?.order_design_type === "INTERNAL_DESING" && order?.designer_id === actorId
  && isOrderStatus(order?.status, ORDER_STATUS.IN_DESIGN) && !order?.is_archived_designer
  && order?.operational_status !== "blocked"
);

function ReturnedBadge({ compact = false }) {
  return (
    <span className={`ps-returned-badge${compact ? " compact" : ""}`} title="Orden devuelta por caja">
      Devuelta
    </span>
  );
}



const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

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

const getOrderFileAssetRef = (file) => {
  if (!file?.provider || !file?.bucket || !file?.object_key) return "";
  return `${file.provider === "r2" ? "r2" : "supabase"}://${file.bucket}/${file.object_key}`;
};

const DESIGNER_FILES_BUCKET = "order-docs";
const DESIGNER_PREVIEW_BUCKET = "order-previews";
const EMPTY_REFERENCE_MANIFEST = [];
const getDesignerFileStableKey = (file) => [
  file?.url || getOrderFileAssetRef(file),
  file?.filename || file?.public_label || file?.original_filename,
  file?.id,
].map((value) => String(value || "").trim()).join("\u0000");
const sortDesignerFilesByStableKey = (files) => (
  [...files].sort((left, right) => (
    getDesignerFileStableKey(left).localeCompare(getDesignerFileStableKey(right))
  ))
);

const getDesignerFilesFromOrder = (order) => {
  const seenUrls = new Set();
  const files = [];
  const addFile = (url, name) => {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) return;

    seenUrls.add(normalizedUrl);
    files.push({
      name: String(name || "").trim() || getFileNameFromUrl(normalizedUrl),
      url: normalizedUrl,
    });
  };

  getOrderFiles(order).forEach((url) => addFile(url, getFileNameFromUrl(url)));

  sortDesignerFilesByStableKey(order?.order_production_files || [])
    .filter((file) => file?.order_id === order?.id && file?.url)
    .forEach((file) => addFile(file.url, file.filename || file.public_label || getFileNameFromUrl(file.url)));

  sortDesignerFilesByStableKey(order?.order_files || [])
    .filter((file) => (
      file?.status === "uploaded"
      && !file.deleted_at
      && ["design", "production"].includes(file.category)
      && file.bucket !== "payment-invoice"
    ))
    .forEach((file) => {
      const assetRef = getOrderFileAssetRef(file);
      addFile(assetRef, file.original_filename || getFileNameFromUrl(assetRef));
    });

  return files;
};

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#F1F5F9", glow: "#F1F5F9" },
  { color: "#1E40AF", bg: "#dbeafe", glow: "#dbeafe" },
  { color: "#EF4444", bg: "#FEE2E2", glow: "#FEE2E2" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
];

function MetricCard({ icon, label, value, sub, accentIdx = 0 }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="pd-metric-card">
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

function DesignerSkeletonLine({ className = "" }) {
  return <span className={`pd-skeleton-shape ${className}`} aria-hidden="true" />;
}

function DesignerOrderTableSkeleton({ rows, columns }) {
  return (
    <>
      <tr className="pd-sr-only"><td colSpan={columns}><span role="status" aria-live="polite">Cargando órdenes...</span></td></tr>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr className="pd-skeleton-row" aria-hidden="true" key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex}>
              {columnIndex === 0 ? <div className="pd-skeleton-client"><DesignerSkeletonLine className="pd-skeleton-avatar" /><DesignerSkeletonLine className="pd-skeleton-line pd-skeleton-line--client" /></div> :
                columnIndex === columns - 1
                  ? <DesignerSkeletonLine className="pd-skeleton-action" />
                  : <DesignerSkeletonLine className={`pd-skeleton-line pd-skeleton-line--cell-${columnIndex}`} />}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function DesignerOrderCardsSkeleton() {
  return (
    <div className="ps-cards-grid pd-skeleton-region" aria-busy="true" aria-label="Cargando órdenes">
      <span className="pd-sr-only" role="status" aria-live="polite">Cargando órdenes...</span>
      {Array.from({ length: DESIGNER_CARD_PAGE_SIZE }, (_, index) => (
        <article className="ps-order-card pd-order-card-skeleton" aria-hidden="true" key={index}>
          <div className="ps-order-card-client"><DesignerSkeletonLine className="pd-skeleton-avatar" /><div className="ps-order-card-client-main"><DesignerSkeletonLine className="pd-skeleton-line pd-skeleton-line--client" /><div className="ps-order-card-client-badges"><DesignerSkeletonLine className="pd-skeleton-pill" /></div></div></div>
          <div className="ps-order-card-fields">{[0, 1, 2, 3].map((field) => <div className="ps-order-card-field" key={field}><DesignerSkeletonLine className="pd-skeleton-line pd-skeleton-line--label" /><DesignerSkeletonLine className="pd-skeleton-line pd-skeleton-line--value" /></div>)}</div>
          <div className="ps-order-card-footer"><DesignerSkeletonLine className="pd-skeleton-line pd-skeleton-line--date" /><div className="ps-order-card-actions"><DesignerSkeletonLine className="pd-skeleton-action" /><DesignerSkeletonLine className="pd-skeleton-action" /></div></div>
        </article>
      ))}
    </div>
  );
}

function OrdersLoadError({ onRetry }) {
  return <div className="pd-orders-load-error" role="alert"><span>No se pudieron cargar las órdenes.</span><button type="button" onClick={onRetry}>Reintentar</button></div>;
}

function DesignerHistorySkeleton() {
  return (
    <section className="order-detail-section designer-order-modal__history pd-history-skeleton" aria-busy="true" aria-label="Historial de participación" style={{ background: "var(--surface)", padding: 16, marginBottom: 18 }}>
      <p><Icons.Clock /> Historial de Participación</p>
      <span className="pd-sr-only" role="status" aria-live="polite">Cargando historial...</span>
      {[0, 1, 2].map((item) => <div className="pd-history-skeleton-row" aria-hidden="true" key={item}><DesignerSkeletonLine className="pd-history-skeleton-icon" /><div><DesignerSkeletonLine className="pd-skeleton-line pd-history-skeleton-name" /><DesignerSkeletonLine className="pd-skeleton-line pd-history-skeleton-description" /><DesignerSkeletonLine className="pd-skeleton-line pd-history-skeleton-date" /></div></div>)}
    </section>
  );
}

export function OrderDetailModal({
  onClose,
  order,
  designerFiles,
  designerPreview,
  onRefresh,
  onSendToQuotation,
  quotationSending,
  pendingReview,
  onAcknowledgeReview,
  reviewAcknowledging,
  reviewError,
  returnHandoff,
  returnHistory,
  onReturnToCashier,
  currentUserId,
  onOpenProductionAssignment,
  productionActionLoading = false,
}) {
  const participation = useOrderParticipation(order?.id);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingFileAreas, setPendingFileAreas] = useState([]);
  const [pendingFileLabels, setPendingFileLabels] = useState([]);
  const [pendingFileMaterials, setPendingFileMaterials] = useState([]);
  const [pendingFileTerminations, setPendingFileTerminations] = useState([]);
  const [pendingDetailsIndices, setPendingDetailsIndices] = useState([]);
  const [productionCatalog, setProductionCatalog] = useState({});
  const [fileDetailsTarget, setFileDetailsTarget] = useState(null);
  const [fileDetailsSaving, setFileDetailsSaving] = useState(false);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState(order?.updated_at || null);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [pendingPreviewName, setPendingPreviewName] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removingFileId, setRemovingFileId] = useState(null);
  const [removingPreview, setRemovingPreview] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
  const [saveError, setSaveError] = useState(null);
  const [missingAreaIndices, setMissingAreaIndices] = useState([]);
  const [missingLabelIndices, setMissingLabelIndices] = useState([]);
  const [missingSpecificationIndices, setMissingSpecificationIndices] = useState([]);
  const [sellerName, setSellerName] = useState("");
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState("");
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [pendingReferenceFiles, setPendingReferenceFiles] = useState([]);
  const [pendingReferencePreviews, setPendingReferencePreviews] = useState([]);
  const pendingReferenceUrlsRef = useRef(new Map());
  const [referenceStates, setReferenceStates] = useState({});
  const [referenceSaving, setReferenceSaving] = useState(false);
  const [replacingReferenceId, setReplacingReferenceId] = useState(null);
  const designerPreviewInputRef = useRef(null);
  const designerReplacementReferenceInputRef = useRef(null);

  const isDesignerCreatedOrder = Boolean(
    order?.seller_id == null
    && order?.designer_id
    && order?.created_by === order.designer_id
  );
  const trackerSteps = isDesignerCreatedOrder
    ? FLOW_STEPS.filter((step) => step.key !== ORDER_STATUS.PENDING)
    : order?.order_design_type === "EXTERNAL_DESING"
      ? FLOW_STEPS_EXTERNAL
      : FLOW_STEPS;
  const participationTimeline = useMemo(() => {
    if (!isDesignerCreatedOrder || !Array.isArray(participation.timeline)) {
      return participation.timeline;
    }

    return participation.timeline.map((entry) => (
      entry?.action === "Creó la orden" && entry.user_id === order.created_by
        ? { ...entry, role: "design", role_label: "Diseñador" }
        : entry
    ));
  }, [isDesignerCreatedOrder, order?.created_by, participation.timeline]);

  useEffect(() => {
    const activeUrls = pendingReferenceUrlsRef.current;
    const pendingKeys = new Set(pendingReferenceFiles.map(getPendingReferenceFileKey));

    activeUrls.forEach((url, key) => {
      if (pendingKeys.has(key)) return;
      activeUrls.delete(key);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Continue syncing the remaining preview URLs if one URL is already invalid.
      }
    });

    const previews = pendingReferenceFiles.map((file) => {
      const key = getPendingReferenceFileKey(file);
      if (!activeUrls.has(key)) {
        try {
          activeUrls.set(key, URL.createObjectURL(file));
        } catch {
          return { file, url: "" };
        }
      }
      return { file, url: activeUrls.get(key) || "" };
    });
    setPendingReferencePreviews(previews);
  }, [pendingReferenceFiles]);

  useEffect(() => () => {
    const activeUrls = pendingReferenceUrlsRef.current;
    activeUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Continue clearing other URLs if one browser URL is already invalid.
      }
    });
    activeUrls.clear();
  }, []);

  const referenceImageUrls = getReferenceImages(order);
  const referenceImageKey = referenceImageUrls.join("\u0000");
  const referenceManifest = order?.order_files || EMPTY_REFERENCE_MANIFEST;
  const persistedPreviewRef = designerPreview || order?.preview_image || "";
  const displayPreview = removingPreview ? "" : (pendingPreviewUrl || resolvedPreviewUrl);
  const referenceAssets = useMemo(() => {
    const manifestByRef = new Map(
      referenceManifest
        .filter((file) => file?.category === "reference" && file.status === "uploaded" && !file.deleted_at)
        .map((file) => [getOrderFileAssetRef(file), file]),
    );

    return (referenceImageKey ? referenceImageKey.split("\u0000") : []).map((assetRef, index) => {
      const file = manifestByRef.get(assetRef);
      return {
        assetRef,
        fileId: file?.id || null,
        filename: file?.original_filename || getFileNameFromUrl(assetRef) || `Referencia ${index + 1}`,
        canManage: Boolean(file?.id && file.uploaded_by === currentUserId),
      };
    });
  }, [currentUserId, referenceImageKey, referenceManifest]);
  const pendingReferencePreviewByKey = new Map(
    pendingReferencePreviews.map(({ file, url }) => [getPendingReferenceFileKey(file), url]),
  );

  useEffect(() => {
    setOrderUpdatedAt(order?.updated_at || null);
  }, [order?.id, order?.updated_at]);

  const activeProductionCatalog = productionCatalog;

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      supabase.from("materials").select("name,production_area_code").not("production_area_code", "is", null),
      supabase.from("production_terminations").select("name,production_area_code"),
    ]).then(([materialsResult, terminationsResult]) => {
      if (cancelled || materialsResult.error || terminationsResult.error) return;
      setProductionCatalog(buildProductionCatalogs(materialsResult.data || [], terminationsResult.data || []));
    }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pendingPreview) {
      setPendingPreviewUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(pendingPreview);
    setPendingPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pendingPreview]);

  useEffect(() => {
    let cancelled = false;

    if (!persistedPreviewRef || pendingPreview) {
      setResolvedPreviewUrl("");
      setPreviewLoading(false);
      setPreviewError("");
      return () => { cancelled = true; };
    }

    setPreviewLoading(true);
    setPreviewError("");
    setResolvedPreviewUrl("");
    resolveOrderAssetUrl(persistedPreviewRef)
      .then((url) => {
        if (!url) throw new Error("No se pudo generar el enlace temporal de la imagen.");
        if (!cancelled) setResolvedPreviewUrl(url);
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewError(error?.message || "No se pudo cargar la imagen guardada.");
          setPreviewLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [pendingPreview, persistedPreviewRef]);

  useEffect(() => {
    let cancelled = false;
    const assets = referenceAssets;
    const initial = Object.fromEntries(assets.map(({ assetRef }) => [assetRef, { status: "loading", url: "", error: "" }]));
    setReferenceStates(initial);

    Promise.all(assets.map(async ({ assetRef }) => {
      try {
        const url = await resolveOrderAssetUrl(assetRef);
        return [assetRef, { status: url ? "loading" : "error", url, error: url ? "" : "No se pudo cargar la imagen." }];
      } catch (error) {
        console.error("Error resolving design reference image:", error);
        return [assetRef, { status: "error", url: "", error: "Ocurrió un problema. Inténtalo nuevamente en unos minutos." }];
      }
    })).then((entries) => {
      if (!cancelled) setReferenceStates(Object.fromEntries(entries));
    });

    return () => { cancelled = true; };
  }, [referenceAssets]);

  useEffect(() => {
    if (order?.seller_name) {
      setSellerName(order.seller_name);
      return;
    }
    const sellerId = order?.seller_id;
    const fallbackId = order?.created_by;
    const idToLookup = sellerId || fallbackId;
    if (!idToLookup) {
      setSellerName("");
      return;
    }
    supabase
      .from("profiles")
      .select("name")
      .eq("id", idToLookup)
      .single()
      .then(({ data }) => {
        if (data?.name) {
          setSellerName(data.name);
          return;
        }
        if (sellerId && fallbackId && fallbackId !== sellerId) {
          return supabase
            .from("profiles")
            .select("name")
            .eq("id", fallbackId)
            .single()
            .then(({ data: fb }) => {
              setSellerName(fb?.name || "");
            });
        }
        setSellerName("");
      })
      .catch(() => setSellerName(""));
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
  const productionFiles = Array.isArray(order.order_production_files) ? order.order_production_files : [];
  const productionFilesReady = productionFiles.length > 0 && productionFiles.every((file) => (
    Boolean(file?.production_area_code)
    && (Array.isArray(file?.material_names) ? file.material_names.length > 0 : Boolean(file?.material_names))
    && Boolean(String(file?.termination_name || "").trim())
  ));
  const canRouteToProduction = Boolean(
    onOpenProductionAssignment
    && currentUserId
    && order.order_design_type === "INTERNAL_DESING"
    && order.designer_id === currentUserId
    && isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
    && isPaymentProductionEligible(order.payment_status)
    && Boolean(order.production_authorized_at && order.production_authorized_by)
    && !order.is_archived_designer
    && order.operational_status !== "blocked"
    && productionFilesReady
  );
  
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
      const firstNewFileIndex = pendingFiles.length;
      setPendingFiles(prev => [...prev, ...acceptedFiles]);
      setPendingFileAreas(prev => [...prev, ...acceptedFiles.map(() => "")]);
      setPendingFileLabels(prev => [...prev, ...acceptedFiles.map(() => "")]);
      setPendingFileMaterials(prev => [...prev, ...acceptedFiles.map(() => [])]);
      setPendingFileTerminations(prev => [...prev, ...acceptedFiles.map(() => "")]);
      setPendingDetailsIndices(prev => [
        ...prev,
        ...acceptedFiles.slice(1).map((_, offset) => firstNewFileIndex + offset + 1),
      ]);
      setFileDetailsTarget({ type: "pending", index: firstNewFileIndex, file: acceptedFiles[0] });
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
    setMissingSpecificationIndices([]);
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
    setPendingFileMaterials(prev => prev.filter((_, i) => i !== index));
    setPendingFileTerminations(prev => prev.filter((_, i) => i !== index));
    setPendingDetailsIndices(prev => prev
      .filter((pendingIndex) => pendingIndex !== index)
      .map((pendingIndex) => (pendingIndex > index ? pendingIndex - 1 : pendingIndex)));
    setSaveSuccess(false);
    setMissingAreaIndices([]);
    setMissingSpecificationIndices([]);
  };

  const handleRemovePersistedFile = async (file) => {
    if (!canEditDesignerAssets || !file?.productionFile?.id || removingFileId) return;

    setRemovingFileId(file.productionFile.id);
    setSaveError(null);
    setSaveSuccess(false);
    setSaveSuccessMessage("");

    try {
      const { error } = await supabase.rpc("designer_remove_order_file", {
        p_order_id: order.id,
        p_file_id: file.productionFile.id,
        p_expected_updated_at: orderUpdatedAt || order.updated_at,
      });
      if (error) throw error;

      await onRefresh?.();
      setSaveSuccessMessage("Archivo eliminado de la orden correctamente.");
      setSaveSuccess(true);
    } catch (error) {
      console.error("Error removing design file:", error);
      setSaveError(
        error?.message === "ORDER_STALE"
          ? "La orden cambió mientras la revisabas. Actualízala antes de volver a intentarlo."
          : error?.message || "No se pudo eliminar el archivo. Inténtalo nuevamente.",
      );
    } finally {
      setRemovingFileId(null);
    }
  };

  const selectedFileDetails = fileDetailsTarget?.type === "pending"
    ? {
      publicLabel: pendingFileLabels[fileDetailsTarget.index] || "",
      areaCode: pendingFileAreas[fileDetailsTarget.index] || "",
      materialNames: pendingFileMaterials[fileDetailsTarget.index] || [],
      terminationName: pendingFileTerminations[fileDetailsTarget.index] || "",
    }
    : fileDetailsTarget?.file?.productionFile
      ? {
        publicLabel: fileDetailsTarget.file.productionFile.public_label || "",
        areaCode: fileDetailsTarget.file.productionFile.production_area_code || "",
        materialNames: fileDetailsTarget.file.productionFile.material_names || [],
        terminationName: fileDetailsTarget.file.productionFile.termination_name || "",
      }
      : null;

  const handleSaveFileDetails = async (details) => {
    if (!fileDetailsTarget) return;

    if (fileDetailsTarget.type === "pending") {
      const index = fileDetailsTarget.index;
      setPendingFileLabels((current) => current.map((label, currentIndex) => currentIndex === index ? details.publicLabel : label));
      setPendingFileAreas((current) => current.map((area, currentIndex) => currentIndex === index ? details.areaCode : area));
      setPendingFileMaterials((current) => current.map((materials, currentIndex) => currentIndex === index ? details.materialNames : materials));
      setPendingFileTerminations((current) => current.map((termination, currentIndex) => currentIndex === index ? details.terminationName : termination));
      setMissingAreaIndices([]);
      setMissingLabelIndices([]);
      setMissingSpecificationIndices([]);
      return;
    }

    const productionFile = fileDetailsTarget.file?.productionFile;
    if (!productionFile?.url) throw new Error("No se encontraron los datos de producción del archivo.");

    setFileDetailsSaving(true);
    try {
      const { data, error } = await supabase.rpc("save_order_production_file_specifications", {
        p_order_id: order.id,
        p_expected_updated_at: orderUpdatedAt || order.updated_at,
        p_specifications: [{
          url: productionFile.url,
          public_label: details.publicLabel,
          production_area_code: details.areaCode,
          material_names: details.materialNames,
          termination_name: details.terminationName,
        }],
      });
      if (error) throw error;
      setOrderUpdatedAt(data?.updated_at || orderUpdatedAt);
      await onRefresh?.();
    } finally {
      setFileDetailsSaving(false);
    }
  };

  const handleRemovePersistedPreview = async () => {
    if (!canEditDesignerAssets || !persistedPreviewRef || removingPreview || removingFileId) return;

    setRemovingPreview(true);
    setSaveError(null);
    setSaveSuccess(false);
    setSaveSuccessMessage("");

    try {
      const { error } = await supabase.rpc("designer_remove_order_preview", {
        p_order_id: order.id,
        p_expected_updated_at: orderUpdatedAt || order.updated_at,
      });
      if (error) throw error;

      await onRefresh?.();
      setSaveSuccessMessage("Imagen de orden de trabajo eliminada correctamente.");
      setSaveSuccess(true);
    } catch (error) {
      console.error("Error removing design preview:", error);
      setSaveError(
        error?.message === "ORDER_STALE"
          ? "La orden cambió mientras la revisabas. Actualízala antes de volver a intentarlo."
          : error?.message || "No se pudo eliminar la imagen de orden de trabajo. Inténtalo nuevamente.",
      );
    } finally {
      setRemovingPreview(false);
    }
  };

  const validateDesignerReferenceFiles = async (filesOrEvent, { showError } = {}) => {
    if (!canEditDesignerAssets) return [];
    const files = Array.from(filesOrEvent?.target?.files || filesOrEvent || []);
    const decoded = await Promise.all(files.map((file) => canDecodeAsImage(file)));
    const validFiles = files.filter((_, index) => decoded[index]?.valid);
    const errors = decoded.filter((result) => !result.valid).map((result) => result.error).filter(Boolean);
    const validation = validateReferenceImages(validFiles);
    if (errors.length || !validation.valid) {
      const message = [...errors, ...validation.errors].join(" ");
      if (showError) showError(message); else setSaveError(message);
      return [];
    }
    return validFiles;
  };

  const uploadDesignerReferenceFiles = async (files) => {
    const uploadedRefs = [];
    for (const rawFile of files) {
      const file = await compressImage(rawFile);
      const path = `orders/${order.id}/ref-images/${buildStorageSafeFileName(file, "ref-")}`;
      const assetRef = await uploadOrderAsset({ bucket: DESIGNER_FILES_BUCKET, path, file });
      if (!assetRef) throw new Error(`No se pudo registrar la imagen ${file.name}.`);
      uploadedRefs.push(assetRef);
    }
    return uploadedRefs;
  };

  const persistReferenceMutation = async ({ additions = [], removeFileIds = [] }) => {
    const { error } = await supabase.rpc("designer_manage_reference_images", {
      p_order_id: order.id,
      p_expected_updated_at: orderUpdatedAt || order.updated_at,
      p_additions: additions,
      p_remove_file_ids: removeFileIds,
    });
    if (error) throw error;
    await onRefresh?.();
  };

  const handleReferenceFiles = async (filesOrEvent, context) => {
    const files = await validateDesignerReferenceFiles(filesOrEvent, context);
    if (!files.length) return;
    const combined = [...pendingReferenceFiles, ...files].filter((file, index, list) => (
      list.findIndex((candidate) => getPendingReferenceFileKey(candidate) === getPendingReferenceFileKey(file)) === index
    ));
    const available = REF_IMAGE_CONFIG.MAX_COUNT - referenceAssets.length - pendingReferenceFiles.length;
    if (referenceAssets.length + combined.length > REF_IMAGE_CONFIG.MAX_COUNT) {
      const message = `Solo puedes agregar ${available} imagen${available === 1 ? "" : "es"} de referencia más.`;
      context?.showError?.(message);
      setSaveError(message);
      return;
    }
    setPendingReferenceFiles(combined);
    setSaveSuccess(false);
    setSaveError(null);
  };

  const revokePendingReferenceUrls = () => {
    const activeUrls = pendingReferenceUrlsRef.current;
    activeUrls.forEach((url, key) => {
      activeUrls.delete(key);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Continue clearing other preview URLs if one browser URL is already invalid.
      }
    });
    activeUrls.clear();
  };

  const handleRemovePendingReference = (file) => {
    if (referenceSaving) return;
    const key = getPendingReferenceFileKey(file);
    const activeUrls = pendingReferenceUrlsRef.current;
    const url = activeUrls.get(key);
    if (url) {
      activeUrls.delete(key);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // The selected file can still be removed if its preview URL is invalid.
      }
    }
    setPendingReferenceFiles((current) => current.filter((candidate) => getPendingReferenceFileKey(candidate) !== key));
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleSaveReferenceFiles = async () => {
    if (!pendingReferenceFiles.length || referenceSaving) return;
    setReferenceSaving(true);
    setSaveError(null);
    try {
      const additions = await uploadDesignerReferenceFiles(pendingReferenceFiles);
      await persistReferenceMutation({ additions });
      revokePendingReferenceUrls();
      setPendingReferenceFiles([]);
      setSaveSuccessMessage("Imágenes de referencia guardadas correctamente.");
      setSaveSuccess(true);
    } catch (error) {
      console.error("Error saving design reference images:", error);
      setSaveError(error?.message === "ORDER_STALE"
        ? "La orden cambió mientras la revisabas. Actualízala antes de volver a intentarlo."
        : error?.message || "No se pudieron guardar las imágenes de referencia.");
    } finally {
      setReferenceSaving(false);
    }
  };

  const handleRemoveReference = async (asset) => {
    if (!asset?.canManage || referenceSaving) return;
    setReferenceSaving(true);
    setSaveError(null);
    try {
      await persistReferenceMutation({ removeFileIds: [asset.fileId] });
      setSaveSuccessMessage("Imagen de referencia eliminada correctamente.");
      setSaveSuccess(true);
    } catch (error) {
      console.error("Error removing design reference image:", error);
      setSaveError(error?.message || "No se pudo eliminar la imagen de referencia.");
    } finally {
      setReferenceSaving(false);
    }
  };

  const handleReplaceReference = async (filesOrEvent, context) => {
    const asset = referenceAssets.find((item) => item.fileId === replacingReferenceId);
    const files = await validateDesignerReferenceFiles(filesOrEvent, context);
    setReplacingReferenceId(null);
    if (!asset?.canManage || !files.length || referenceSaving) return;
    setReferenceSaving(true);
    setSaveError(null);
    try {
      const additions = await uploadDesignerReferenceFiles([files[0]]);
      await persistReferenceMutation({ additions, removeFileIds: [asset.fileId] });
      setSaveSuccessMessage("Imagen de referencia reemplazada correctamente.");
      setSaveSuccess(true);
    } catch (error) {
      console.error("Error replacing design reference image:", error);
      setSaveError(error?.message || "No se pudo reemplazar la imagen de referencia.");
    } finally {
      setReferenceSaving(false);
    }
  };
  
  const handleSave = async () => {
    if (!canEditDesignerAssets) return;
    const missingAreas = pendingFiles
      .map((_, i) => (!pendingFileAreas[i] ? i : -1))
      .filter(i => i !== -1);
    const missingLabels = pendingFiles
      .map((_, i) => (!pendingFileLabels[i]?.trim() ? i : -1))
      .filter(i => i !== -1);
    const missingSpecifications = pendingFiles
      .map((_, i) => (!pendingFileMaterials[i]?.some((name) => String(name || "").trim()) || !pendingFileTerminations[i]?.trim() ? i : -1))
      .filter(i => i !== -1);

    setMissingAreaIndices(missingAreas);
    setMissingLabelIndices(missingLabels);
    setMissingSpecificationIndices(missingSpecifications);

    if (missingAreas.length > 0 || missingLabels.length > 0 || missingSpecifications.length > 0) {
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
    setMissingSpecificationIndices([]);
    
    try {
      const updateData = {};
      let productionRows = [];
      
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
          const existingUrls = parseOrderFileUrls(order.order_file_url);

          productionRows = buildProductionFileRows({
            orderId: order.id,
            urls: fileUrls,
            files: pendingFiles,
            areaCodes: pendingFileAreas,
            publicLabels: pendingFileLabels,
            materialNames: pendingFileMaterials,
            terminationNames: pendingFileTerminations,
            userId: order.designer_id,
          });

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
      
      if (Object.keys(updateData).length > 0 || productionRows.length > 0) {
        const { error: updateError } = await supabase.rpc("designer_update_order_with_file_specifications", {
          p_order_id: order.id,
          p_expected_updated_at: orderUpdatedAt || order.updated_at,
          p_changes: updateData,
          p_new_production_files: productionRows,
        });
        if (updateError) throw updateError;
      }
      
      if (onRefresh) await onRefresh();
      
      setPendingFiles([]);
      setPendingFileAreas([]);
      setPendingFileLabels([]);
      setPendingFileMaterials([]);
      setPendingFileTerminations([]);
      setPendingDetailsIndices([]);
      setPendingPreview(null);
      setPendingPreviewName(null);
      setSaveSuccessMessage("Archivos guardados correctamente.");
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
    if (referenceSaving) return;
    setPendingFiles([]);
    setPendingFileAreas([]);
    setPendingFileLabels([]);
    setPendingFileMaterials([]);
    setPendingFileTerminations([]);
    setPendingDetailsIndices([]);
    setPendingPreview(null);
    revokePendingReferenceUrls();
    setPendingReferenceFiles([]);
    setPendingReferencePreviews([]);
    setSaveSuccess(false);
    setSaveSuccessMessage("");
    setSaveError(null);
    setFileDetailsTarget(null);
    onClose();
  };
  
  const hasChanges = pendingFiles.length > 0 || pendingPreview !== null;
  
  const dbFiles = parseOrderFileUrls(order.order_file_url).map((url, i) => ({
    name: url.split('/').pop() || `archivo-${i + 1}`,
    url,
  }));
  
  const productionFilesByUrl = new Map(
    (order.order_production_files || [])
      .filter((file) => file?.id && file?.order_id === order.id && file?.url)
      .map((file) => [file.url, file]),
  );
  const allFiles = [...(designerFiles || []), ...dbFiles];
  const uniqueFiles = allFiles
    .filter((file, index, files) => files.findIndex((item) => item.url === file.url) === index)
    .map((file) => ({ ...file, productionFile: productionFilesByUrl.get(file.url) }));
  const effectivePersistedFiles = uniqueFiles.filter((file) => file.productionFile?.id !== removingFileId);
  const hasPersistedPreview = Boolean(persistedPreviewRef) && !removingPreview;
  const hasPreview = Boolean(pendingPreview || hasPersistedPreview);
  const hasRequiredAssets = effectivePersistedFiles.length + pendingFiles.length > 0 && hasPreview;
  const hasPersistedRequiredAssets = effectivePersistedFiles.length > 0 && hasPersistedPreview;
  const persistedFilesAreConfigured = effectivePersistedFiles.length > 0 && effectivePersistedFiles.every((file) => (
    Boolean(file.productionFile?.public_label?.trim())
    && Boolean(file.productionFile?.production_area_code)
    && file.productionFile?.material_names?.some((name) => String(name || "").trim())
    && Boolean(file.productionFile?.termination_name?.trim())
  ));
  const pendingFilesAreConfigured = pendingFiles.every((_, index) => (
    Boolean(pendingFileAreas[index])
    && Boolean(pendingFileLabels[index]?.trim())
    && pendingFileMaterials[index]?.length > 0
    && Boolean(pendingFileTerminations[index]?.trim())
  ));
  const canSaveChanges = canEditDesignerAssets
    && hasChanges
    && hasRequiredAssets
    && pendingFilesAreConfigured
    && !saving
    && !removingFileId
    && !removingPreview;
  const canSendToQuotation = canEditDesignerAssets
    && hasPersistedRequiredAssets
    && persistedFilesAreConfigured
    && !hasChanges
    && !removingFileId
    && !removingPreview;
  const sendToQuotationBlockReason = !canEditDesignerAssets
    ? readonlyMessage
    : effectivePersistedFiles.length === 0
      ? "Guarda al menos un archivo de diseño antes de enviar a Caja."
      : !hasPersistedPreview
        ? "Guarda la orden de trabajo antes de enviar a Caja."
        : hasChanges
          ? "Guarda los cambios pendientes de los archivos y de la imagen de orden de trabajo antes de enviar a Caja."
          : !persistedFilesAreConfigured
            ? "Completa y guarda los detalles de cada archivo antes de enviar a Caja."
            : removingFileId || removingPreview
              ? "Espera a que termine la actualización de archivos antes de enviar a Caja."
              : "";
  const workSummary = hasChanges
    ? { label: "Pendiente", icon: <Icons.Clock />, tone: "is-warning" }
    : canSendToQuotation
      ? { label: "Completado", icon: <Icons.Check />, tone: "is-ready" }
      : canEditDesignerAssets
        ? { label: "Editable", icon: <Icons.Edit />, tone: "is-editable" }
        : isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
          ? { label: "En revisión", icon: <Icons.Search />, tone: "is-review" }
          : { label: "Completado", icon: <Icons.Check />, tone: "is-ready" };
  const footerNote = canSendToQuotation
    ? "La orden tiene archivos e imagen de orden de trabajo guardados. Lista para enviar a Caja."
    : sendToQuotationBlockReason || "Agrega archivos e imagen de orden de trabajo para completar el trabajo de diseño.";
  const footerNoteClass = "designer-order-modal__footer-note";

  return (
    <div className="designer-order-modal-overlay">
      {/* Modal de orden de trabajo de diseñador*/}
      <div className="designer-order-modal">
        <div className="designer-order-modal__stripe"></div>
        {/* Header del modal de orden de trabajo de diseñador*/}
        <div className="designer-order-modal__header">
          <div className="designer-order-modal__inner-header">
            {/* Título del modal de orden de trabajo de diseñador*/}
            <div className="designer-order-modal__title">
              <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
              <span className="designer-order-modal__subtitle">Detalles de la orden de trabajo</span>
            </div>
            {/* Botón de cerrar el modal de orden de trabajo de diseñador*/}
            <button className="designer-order-modal__close" onClick={handleClose} disabled={referenceSaving} aria-label="Cerrar detalles de la orden">
              <Icons.Close />
            </button>
          </div>
        </div>
        {/* Body del modal de detalles de orden de diseñador */}
        <div className="designer-order-modal__body">
          {/* Sección de progreso de la orden de diseñador*/}
          <section className="designer-order-modal__flow-section" aria-label="Progreso de la orden">
            <div className="designer-order-modal__flow" tabIndex={0} aria-label="Etapas de la orden">
              <FlowTracker
                status={order.status}
                steps={trackerSteps}
                authorizationBadge={Boolean(order.production_authorized_at && order.production_authorized_by)}
              />
            </div>
          </section>

          {/* Sección de resumen de la orden de diseñador*/}
          <div className="designer-order-modal__summary" aria-label="Resumen de la orden">
            {/* Item de estado de la orden de diseñador*/}
            <div className="designer-order-modal__summary-item">
              <span><Icons.CheckCircle /> Estado</span>
              <StatusBadge status={order.status} className="designer-order-modal__summary-badge" bordered order={order} />
            </div>
            {/* Item de archivos de la orden de diseñador*/}
            <div className="designer-order-modal__summary-item">
              <span><Icons.Paperclip /> Archivos</span>
              <strong className="acm-badge info designer-order-modal__summary-badge designer-order-modal__summary-badge-files">
                {uniqueFiles.length.toLocaleString("es-DO")} Archivos
              </strong>
            </div>
            {/* Item de imagen de orden de trabajo de la orden de diseñador*/}
            <div className="designer-order-modal__summary-item">
              <span><Icons.Eye />Orden de trabajo</span>
              <strong className={`designer-order-modal__summary-badge designer-order-modal__summary-badge-preview ${hasPreview ? "is-ready" : "is-pending"}`}>
                {hasPreview ? "Cargada" : "Pendiente"}
              </strong>
            </div>
            {/* Item de trabajo de la orden de diseñador*/}
            <div className={`designer-order-modal__summary-item ${workSummary.tone}`}>
              <span><Icons.Package /> Trabajo</span>
              <strong className="designer-order-modal__work-status">
                {workSummary.icon}
                {workSummary.label}
              </strong>
            </div>
          </div>

          {/* Sección de seguimiento de la orden de diseñador*/}
          <section className="designer-order-modal__tracking" aria-label="Enlace para el cliente">
            <h4><Icons.ExternalLink /> Link de seguimiento</h4>
            <OrderTrackingLink orderId={order.id} trackingToken={order.tracking_token} />
          </section>

          {participation.loading ? <DesignerHistorySkeleton /> : (
            <OrderParticipationTimelineContent
              timeline={participationTimeline}
              loading={false}
              error={participation.error}
              sectionClassName="designer-order-modal__history"
            />
          )}

          {saveSuccess && (
            <div className="pd-alert pd-alert-success">
              <Icons.Check />
              {saveSuccessMessage || "Archivos guardados correctamente."}
            </div>
          )}
          
          {saveError === "missing-area" && (
            <div className="pd-alert pd-alert-error">
              <Icons.X />
              <div>
                <div className="pd-file-error-title">Datos de producción requeridos</div>
                <div className="pd-file-error-desc">
                  No es posible guardar los cambios porque uno o más archivos adjuntos no tienen su área, materiales o terminación asignados.
                  <br />
                  Completa todos los datos de producción para cada archivo antes de continuar.
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
          
          <div className="designer-order-modal__content-grid">
            <div className="designer-order-modal__card">
              <div className="designer-order-modal__card-title">
                <Icons.User />
                <h4>Información del Cliente</h4>
              </div>
              <div className="designer-order-modal__rows">
                <div className="designer-order-modal__info-row">
                  <Icons.User />
                  <div><span>Cliente</span><strong>{order.client_name || "No especificado"}</strong></div>
                </div>
                <div className="designer-order-modal__info-row">
                  <Icons.User />
                  <div><span>Vendedor</span><strong>{sellerName || "No especificado"}</strong></div>
                </div>
                <div className="designer-order-modal__info-row">
                  <Icons.Phone />
                  <div><span>Teléfono</span>
                    {order.client_contact ? (
                      <a
                        href={`https://wa.me/${order.client_contact.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pd-whatsapp-btn"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        {formatPhone(order.client_contact)}
                      </a>
                    ) : <strong>No especificado</strong>}
                  </div>
                </div>
                <div className="designer-order-modal__info-row">
                  <Icons.Package />
                  <div><span>Tipo de Orden</span><strong>
                    {order.order_type === "orden 911" ? "⚡ 911 - Urgente" : "Normal"}
                  </strong></div>
                </div>
                <div className="designer-order-modal__info-row">
                  <Icons.Calendar />
                  <div><span>Fecha de Creación</span><strong>{created}</strong></div>
                </div>
              </div>
            </div>

            <div className="designer-order-modal__card">
              <div className="designer-order-modal__card-title">
                <Icons.Clipboard />
                <h4>Detalles de la orden de trabajo</h4>
                {isReturnedOrder(order) && <ReturnedBadge />}
              </div>
              <div className="designer-order-modal__rows">
                <div className="designer-order-modal__info-row">
                  <Icons.FileText />
                  <div><span>Descripción</span><strong>{order.description || "Sin descripción"}</strong></div>
                </div>
                <div className="designer-order-modal__info-row">
                  <Icons.Package />
                  <div><span>Material</span><strong>{order.material || "No especificado"}</strong></div>
                </div>
                {order.width && order.height && (
                  <div className="designer-order-modal__info-row">
                    <Icons.Maximize />
                    <div><span>Dimensiones</span><strong>{order.width} x {order.height} cm</strong></div>
                  </div>
                )}
                {order.quantity && (
                  <div className="designer-order-modal__info-row">
                    <Icons.Hash />
                    <div><span>Cantidad</span><strong>{order.quantity} unidades</strong></div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <OrderReviewCard
            pendingReview={pendingReview}
            onAcknowledge={onAcknowledgeReview}
            acknowledging={reviewAcknowledging}
            error={reviewError}
          />

          {isReturnedOrder(order) && (
            <div className="designer-order-modal__card">
              <div className="designer-order-modal__card-title">
                <Icons.X />
                <h4>Motivo de devolución</h4>
              </div>
              <div className="pd-return-note">
                <p>{returnedReason}</p>
              </div>
            </div>
          )}
          <OrderReturnHandoffPanel incomingHandoff={returnHandoff} history={returnHistory} />
          
          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.File />
              <h4>Archivos del Diseño <span className="pd-asset-requirement">(Obligatorio)</span></h4>
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
                hint="Los cambios realizados se guardarán al hacer clic en «Guardar cambios»."
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
                {pendingFiles.map((file, i) => {
                  const isComplete = isProductionFileDetailsComplete({
                    publicLabel: pendingFileLabels[i],
                    areaCode: pendingFileAreas[i],
                    materialNames: pendingFileMaterials[i],
                    terminationName: pendingFileTerminations[i],
                  });
                  const actionLabel = isComplete ? "Editar" : "Detalles";
                  const actionName = `${actionLabel} detalles de ${file.name}`;
                  return <div key={i} className={missingLabelIndices.includes(i) || missingAreaIndices.includes(i) || missingSpecificationIndices.includes(i) ? 'pd-file-missing' : ''}>
                    <FileCard
                      name={file.name}
                      secondaryText={formatFileSize(file.size)}
                      onRemove={() => removePendingFile(i)}
                      detailText={pendingFileLabels[i] ? `Seguimiento: ${pendingFileLabels[i]}` : "Seguimiento pendiente"}
                      actions={[{
                        title: actionName,
                        label: actionLabel,
                        icon: <Icons.Edit />,
                        attention: pendingDetailsIndices.includes(i),
                        ariaLabel: actionName,
                        onClick: () => {
                          setPendingDetailsIndices(prev => prev.filter((pendingIndex) => pendingIndex !== i));
                          setFileDetailsTarget({ type: "pending", index: i, file });
                        },
                      }]}
                      removeIcon={<Icons.Trash />}
                      removeTitle={`Eliminar ${file.name}`}
                    />
                  </div>;
                })}
              </div>
            )}

            {uniqueFiles.length > 0 && (
              <div className="pd-files-container" style={{ marginTop: pendingFiles.length > 0 ? '12px' : '16px' }}>
                <span className="pd-files-label">Archivos guardados ({uniqueFiles.length})</span>
                {uniqueFiles.map((file, i) => {
                  const productionFile = file.productionFile;
                  const isComplete = isProductionFileDetailsComplete({
                    publicLabel: productionFile?.public_label,
                    areaCode: productionFile?.production_area_code,
                    materialNames: productionFile?.material_names,
                    terminationName: productionFile?.termination_name,
                  });
                  const actionLabel = isComplete ? "Editar" : "Detalles";
                  const actionName = `Ver detalles de ${file.name}`;
                  return <FileCard
                    key={i}
                    name={file.name}
                    url={file.url}
                    hideDownload
                    secondaryText={
                      canEditDesignerAssets && !file.productionFile
                        ? "Este archivo histórico no se puede eliminar desde Diseño."
                        : undefined
                    }
                    detailText={file.productionFile?.public_label ? `Seguimiento: ${file.productionFile.public_label}` : "Seguimiento pendiente"}
                    actions={canEditDesignerAssets && file.productionFile ? [
                      {
                        title: actionName,
                        label: actionLabel,
                        icon: <Icons.Edit />,
                        ariaLabel: actionName,
                        onClick: () => setFileDetailsTarget({ type: "saved", file }),
                      },
                      {
                        title: removingFileId === file.productionFile.id ? "Eliminando archivo" : "Eliminar archivo",
                        disabled: Boolean(removingFileId),
                        onClick: () => handleRemovePersistedFile(file),
                        icon: removingFileId === file.productionFile.id ? <Icons.Clock /> : <Icons.Trash />,
                        label: removingFileId === file.productionFile.id ? "Eliminando…" : undefined,
                      },
                    ] : []}
                  />;
                })}
              </div>
            )}
          </div>
          
          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.Image />
              <h4>Imagen de orden de trabajo <span className="pd-asset-requirement">(Obligatorio)</span></h4>
            </div>
            
            <div className="pd-preview-container">
              {displayPreview ? (
                <>
                  <img
                    src={displayPreview}
                    alt="Imagen de orden de trabajo"
                    className={`pd-preview-image${previewLoading ? " is-loading" : ""}`}
                    onLoad={() => {
                      setPreviewLoading(false);
                      setPreviewError("");
                    }}
                    onError={() => {
                      setResolvedPreviewUrl("");
                      setPreviewError("Ocurrió un problema. Inténtalo nuevamente en unos minutos.");
                      setPreviewLoading(false);
                    }}
                  />
                  {previewLoading && (
                    <div className="pd-preview-loading" role="status">
                      <span className="designer-order-modal__spinner" />
                      <span>Cargando imagen...</span>
                    </div>
                  )}
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
                          buttonLabel="Cambiar imagen de orden de trabajo"
                          onFilesAccepted={handlePreviewSelect}
                        />
                        <button className="pd-file-action" style={{ background: 'white', color: '#0f172a' }} onClick={() => designerPreviewInputRef.current?.click()}>
                          <Icons.Edit />
                        </button>
                        <button
                          className="pd-file-action remove"
                          style={{ background: 'white' }}
                          disabled={removingPreview || Boolean(removingFileId)}
                          title={pendingPreview ? "Quitar imagen de orden de trabajo pendiente" : "Eliminar imagen de orden de trabajo"}
                          onClick={() => {
                            if (pendingPreview) {
                              setPendingPreview(null);
                              setPendingPreviewName(null);
                              setSaveSuccess(false);
                              return;
                            }
                            handleRemovePersistedPreview();
                          }}
                        >
                          <Icons.Trash />
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : previewLoading ? (
                <div className="pd-preview-empty" role="status">
                  <Icons.Clock />
                  <span>Cargando imagen...</span>
                </div>
              ) : previewError ? (
                <>
                  <div className="pd-preview-empty pd-preview-empty-disabled" role="alert">
                    <Icons.AlertCircle />
                    <span>{previewError}</span>
                  </div>
                  {canEditDesignerAssets && (
                    <FileUploadZone
                      mode="image"
                      replaceMode
                      buttonLabel="Reemplazar imagen de orden de trabajo"
                      hint="La imagen guardada se conservará hasta que guardes el reemplazo."
                      onFilesAccepted={handlePreviewSelect}
                    />
                  )}
                </>
              ) : (
                canEditDesignerAssets ? (
                  <FileUploadZone
                    mode="image"
                    replaceMode
                    buttonLabel="Subir imagen de orden de trabajo"
                    hint={`Max. ${formatFileSize(getOrderAssetLimit(DESIGNER_PREVIEW_BUCKET))}`}
                    onFilesAccepted={handlePreviewSelect}
                  />
                ) : (
                  <div className="pd-preview-empty pd-preview-empty-disabled">
                    <Icons.Image />
                    <span>La imagen de orden de trabajo permanece disponible solo para consulta.</span>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.Image />
              <h4>Imágenes de referencia <span className="pd-asset-requirement">(Opcional)</span></h4>
              <span className="pd-reference-count">{referenceAssets.length + pendingReferenceFiles.length}/{REF_IMAGE_CONFIG.MAX_COUNT}</span>
            </div>
            {referenceAssets.length + pendingReferenceFiles.length > 0 ? (
              <div className="pd-reference-grid">
                {referenceAssets.map((asset, index) => {
                  const state = referenceStates[asset.assetRef] || { status: "loading" };
                  return (
                    <div key={asset.assetRef} className="pd-reference-card">
                      {state.status !== "error" && state.url ? (
                        <a href={state.url} target="_blank" rel="noopener noreferrer" className="pd-reference-link" aria-label={`Abrir ${asset.filename}`}>
                          <img
                            src={state.url}
                            alt={`Ref ${index + 1}`}
                            className={`pd-reference-thumb${state.status === "loading" ? " is-loading" : ""}`}
                            onLoad={() => setReferenceStates((previous) => ({ ...previous, [asset.assetRef]: { ...previous[asset.assetRef], status: "ready", error: "" } }))}
                            onError={() => setReferenceStates((previous) => ({ ...previous, [asset.assetRef]: { ...previous[asset.assetRef], status: "error", url: "", error: "No se pudo cargar la imagen." } }))}
                          />
                        </a>
                      ) : state.status === "error" ? (
                        <div className="pd-reference-state pd-reference-state--error" role="alert">
                          <Icons.AlertCircle />
                          <span>Ocurrió un problema. Inténtalo nuevamente en unos minutos.</span>
                        </div>
                      ) : (
                        <div className="pd-reference-state" role="status">
                          <span className="designer-order-modal__spinner" />
                          <span>Cargando imagen...</span>
                        </div>
                      )}
                      {state.status === "loading" && state.url && (
                        <div className="pd-reference-state pd-reference-state--overlay" role="status">
                          <span className="designer-order-modal__spinner" />
                          <span>Cargando imagen...</span>
                        </div>
                      )}
                      {asset.canManage && canEditDesignerAssets && (
                        <div className="pd-reference-actions">
                          <button
                            type="button"
                            className="pd-file-action"
                            title="Reemplazar imagen"
                            disabled={referenceSaving}
                            onClick={() => {
                              setReplacingReferenceId(asset.fileId);
                              designerReplacementReferenceInputRef.current?.click();
                            }}
                          ><Icons.Edit /></button>
                          <button type="button" className="pd-file-action remove" title="Eliminar imagen" disabled={referenceSaving} onClick={() => handleRemoveReference(asset)}><Icons.Trash /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {pendingReferenceFiles.map((file) => {
                  const previewUrl = pendingReferencePreviewByKey.get(getPendingReferenceFileKey(file)) || "";
                  return (
                    <div key={getPendingReferenceFileKey(file)} className="pd-reference-card pd-reference-pending-card">
                      {previewUrl ? <img src={previewUrl} alt={`Vista previa de ${file.name}`} className="pd-reference-thumb" /> : (
                        <div className="pd-reference-state" role="img" aria-label={`Vista previa no disponible de ${file.name}`}>
                          <span>Vista previa no disponible</span>
                        </div>
                      )}
                      <span className="pd-reference-pending-status">Pendiente</span>
                      <span className="pd-reference-pending-name" title={file.name}>{file.name}</span>
                      <div className="pd-reference-actions">
                        <button
                          type="button"
                          className="pd-file-action remove"
                          title={`Quitar ${file.name}`}
                          aria-label={`Quitar ${file.name}`}
                          disabled={referenceSaving}
                          onClick={() => handleRemovePendingReference(file)}
                        ><Icons.Trash /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {canEditDesignerAssets && (
              <div className="pd-reference-upload">
                {referenceAssets.length + pendingReferenceFiles.length < REF_IMAGE_CONFIG.MAX_COUNT && (
                  <FileUploadZone
                    mode="image"
                    multiple
                    variant="compact"
                    className="file-upload-zone--reference-optional"
                    maxFiles={REF_IMAGE_CONFIG.MAX_COUNT}
                    existingCount={referenceAssets.length + pendingReferenceFiles.length}
                    buttonLabel="Agregar imágenes de referencia"
                    onFilesAccepted={handleReferenceFiles}
                    disabled={referenceSaving}
                  />
                )}
                {pendingReferenceFiles.length > 0 && (
                  <>
                    <div className="pd-reference-pending">
                      <span>{pendingReferenceFiles.length} imagen{pendingReferenceFiles.length === 1 ? "" : "es"} pendiente{pendingReferenceFiles.length === 1 ? "" : "s"}</span>
                      <div className="pd-reference-pending-actions">
                        <button type="button" className="designer-order-modal__button designer-order-modal__button--secondary" disabled={referenceSaving} onClick={() => { revokePendingReferenceUrls(); setPendingReferenceFiles([]); }}>Cancelar</button>
                        <button type="button" className="designer-order-modal__button designer-order-modal__button--primary" disabled={referenceSaving} onClick={handleSaveReferenceFiles}>
                          {referenceSaving ? "Guardando..." : "Guardar imágenes"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <FileUploadZone
              mode="image"
              replaceMode
              className="file-upload-zone--hidden-picker"
              inputRef={designerReplacementReferenceInputRef}
              buttonLabel="Reemplazar referencia"
              onFilesAccepted={handleReplaceReference}
            />
          </div>
          
          {/* <div className="pd-status-bar">
            <div className="pd-status-item">
              <span className="pd-status-label">Estado</span>
              <StatusBadge status={order.status} className="pd-badge" order={order} />
            </div>
          </div> */}
        </div>
        {/* Footer Modal */}
        <div className="designer-order-modal__footer">
          <div className={footerNoteClass}>{footerNote}</div>
          {/* Boton para cerral el modal */}
          <button className="designer-order-modal__button designer-order-modal__button--secondary" onClick={handleClose} disabled={referenceSaving}>
            Cerrar
          </button>
          {canEditDesignerAssets && (
            <button
              className="designer-order-modal__button designer-order-modal__button--quotation"
              onClick={() => returnHandoff ? onReturnToCashier?.(returnHandoff) : onSendToQuotation?.(order)}
              disabled={!canSendToQuotation || quotationSending || Boolean(removingFileId)}
              title={canSendToQuotation ? undefined : sendToQuotationBlockReason}
              aria-describedby={canSendToQuotation ? undefined : "designer-send-to-cashier-requirements"}
            >
              {quotationSending ? (
                <>
                  <span className="designer-order-modal__spinner"></span>
                  Enviando...
                </>
              ) : (
                <>
                  <Icons.Send />
                  {returnHandoff ? "Regresar a Caja" : "Enviar a caja"}
                </>
              )}
            </button>
          )}
          {canRouteToProduction && (
            <button
              className="designer-order-modal__button designer-order-modal__button--production"
              type="button"
              onClick={() => onOpenProductionAssignment(order)}
              disabled={productionActionLoading}
            >
              <Icons.Package />
              {productionActionLoading ? "Preparando..." : "Enviar a Producción"}
            </button>
          )}
          {!canSendToQuotation && canEditDesignerAssets && (
            <p id="designer-send-to-cashier-requirements" className="sr-only">{sendToQuotationBlockReason}</p>
          )}
          {/* Boton para guardar cambios   */}
          <button 
            className="designer-order-modal__button designer-order-modal__button--primary"
            onClick={handleSave}
            disabled={!canSaveChanges}
          >
            {saving ? (
              <>
                <span className="designer-order-modal__spinner"></span>
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
      <ProductionFileDetailsModal
        open={Boolean(fileDetailsTarget)}
        fileName={fileDetailsTarget?.file?.name}
        fileKey={fileDetailsTarget?.type === "pending"
          ? `pending-${fileDetailsTarget.index}-${fileDetailsTarget.file?.name || ""}`
          : `saved-${fileDetailsTarget?.file?.productionFile?.id || ""}`}
        value={selectedFileDetails}
        catalog={activeProductionCatalog}
        saving={fileDetailsSaving}
        orderId={order.id}
        onClose={() => setFileDetailsTarget(null)}
        onSave={handleSaveFileDetails}
      />
    </div>
  );
}

export default function PageDesigner() {
  const navigate = useNavigate();
  const { user: authUser, profile: authProfile, signOut } = useAuth();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoadError, setOrdersLoadError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterOverdue, setFilterOverdue] = useState("all");
  const [filterArchive, setFilterArchive] = useState("all");
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [productionCatalog, setProductionCatalog] = useState({ materials: {}, terminations: {} });
  const [showCreate, setShowCreate] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [materialName, setMaterialName] = useState("");
  const [materialAreaCode, setMaterialAreaCode] = useState("");
  const [materialAreas, setMaterialAreas] = useState([]);
  const [materialAreasLoading, setMaterialAreasLoading] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialInsertedAwaitingRefresh, setMaterialInsertedAwaitingRefresh] = useState(null);
  const [clientToSelectInOrderForm, setClientToSelectInOrderForm] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [productionOrder, setProductionOrder] = useState(null);
  const [productionSaving, setProductionSaving] = useState(false);
  const [editedOrders, setEditedOrders] = useState(() => {
    try {
      const saved = localStorage.getItem(EDITED_ORDERS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [orderFiles, setOrderFiles] = useState({});
  const [orderPreviews, setOrderPreviews] = useState({});
  const notif = useNotifications(user?.id);
  const orderReviews = useOrderEventReviews(user?.id);
  const orderReturns = useOrderReturnHandoffs(user?.id);
  const newOrderAssignments = useNewOrderAssignments(user?.id, "design");
  const pendingOrderReviews = orderReviews.pendingByOrder;
  const pendingNewAssignments = newOrderAssignments.pendingByOrder;
  const [sendingToQuotation, setSendingToQuotation] = useState(null);
  const [returningToCashier, setReturningToCashier] = useState(null);
  const [returningToCashierLoading, setReturningToCashierLoading] = useState(false);
  const [returningToSales, setReturningToSales] = useState(null);
  const [returningToSalesLoading, setReturningToSalesLoading] = useState(false);
  const [originalQuoterId, setOriginalQuoterId] = useState(null);
  const [quotationSending, setQuotationSending] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  
  const userRef = useRef(null);
  const previousOrdersRef = useRef({});
  const mainScrollRef = useRef(null);
  const ordersRef = useRef([]);
  const ordersInitializedRef = useRef(false);
  const detailRequestRef = useRef(0);

  const loadDesignerCatalogs = useCallback(async () => {
    setClientsLoading(true);
    try {
      const [materialsResult, terminationsResult, loadedClients] = await Promise.all([
        supabase.from("materials").select("name,production_area_code").not("production_area_code", "is", null).order("name"),
        supabase.from("production_terminations").select("name,production_area_code").order("name"),
        loadClients(supabase),
      ]);
      if (materialsResult.error || terminationsResult.error) throw materialsResult.error || terminationsResult.error;
      setProductionCatalog(buildProductionCatalogs(materialsResult.data || [], terminationsResult.data || []));
      setClients(loadedClients);
      return true;
    } catch (error) {
      console.warn("No se pudieron cargar los datos de creación de Diseño:", error?.message || error);
      return false;
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!userRef.current) return;
    const isInitialLoad = !ordersInitializedRef.current;
    if (isInitialLoad) {
      setLoading(true);
      setOrdersLoadError("");
    }

    try {
      const { data, error } = await supabase
        .from("orders")
        .select(DESIGNER_ORDER_SELECT)
        .eq("designer_id", userRef.current.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!data) throw new Error("No se recibió la lista de órdenes.");

      const previousOrders = previousOrdersRef.current;
      if (!ordersInitializedRef.current) {
        setEditedOrders((previous) => {
          let changed = false;
          const next = { ...previous };
          data.forEach((order) => {
            if (order.updated_by === userRef.current?.id && next[order.id]) {
              delete next[order.id];
              changed = true;
            }
          });
          return changed ? next : previous;
        });
        ordersInitializedRef.current = true;
      } else {
        data.forEach((order) => {
          const previousOrder = previousOrders[order.id];
          if (order.updated_by === userRef.current?.id) {
            setEditedOrders((previous) => {
              if (!previous[order.id]) return previous;
              const next = { ...previous };
              delete next[order.id];
              return next;
            });
          } else if (shouldMarkDesignerOrderEdited(previousOrder, order, userRef.current?.id)) {
            setEditedOrders((previous) => ({ ...previous, [order.id]: Date.now() }));
          }
        });
      }

      previousOrdersRef.current = data.reduce((byId, order) => ({ ...byId, [order.id]: order }), {});
      ordersRef.current = data;
      applyOrdersSnapshot({ orders: data, setOrders, setSelectedOrder });
      setOrdersLoadError("");
    } catch (error) {
      if (!ordersInitializedRef.current) {
        setOrdersLoadError(error?.message || "No se pudieron cargar las órdenes.");
      } else {
        console.warn("No se pudieron actualizar las órdenes de Diseño:", error?.message || error);
      }
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void fetchOrders();
  }, [fetchOrders, user?.id]);

  useOrdersRealtimeSync({ userId: user?.id, scope: "designer", refreshOrders: fetchOrders });

  useEffect(() => {
    if (!user?.id) return;
    void loadDesignerCatalogs();
  }, [loadDesignerCatalogs, user?.id]);

  useEffect(() => {
    const nextFiles = {};
    const nextPreviews = {};
    orders.forEach((order) => {
      nextFiles[order.id] = getDesignerFilesFromOrder(order);
      const preview = getPreviewImage(order);
      if (preview) nextPreviews[order.id] = preview;
    });
    setOrderFiles(nextFiles);
    setOrderPreviews(nextPreviews);
  }, [orders]);

  const handleClientSearch = useCallback(async (query) => {
    const results = await searchClients(supabase, query);
    setClients((previous) => {
      const byId = new Map(previous.map((client) => [client.id, client]));
      results.forEach((client) => byId.set(client.id, client));
      return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    return results;
  }, []);

  const handleNewClientCreated = async (newClient, options = {}) => {
    setClients((previous) => {
      const exists = previous.some((client) => client.id === newClient.id);
      return exists
        ? previous
        : [...previous, newClient].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    if (showCreate) setClientToSelectInOrderForm(newClient);
    notif.showActionNotification({
      type: "info",
      title: options.reusedExisting ? "Cliente vinculado" : "Cliente registrado",
      message: options.reusedExisting
        ? `Cliente "${newClient.name}" encontrado y vinculado correctamente.`
        : `Cliente "${newClient.name}" registrado correctamente.`,
      metadata: {
        variant: "success",
        event_kind: options.reusedExisting ? "client_reused" : "client_created",
        client_id: newClient.id,
      },
    });
  };

  const openMaterialModal = async () => {
    setShowMaterialModal(true);
    setMaterialError("");
    if (materialInsertedAwaitingRefresh) {
      setMaterialName(materialInsertedAwaitingRefresh.name);
      setMaterialAreaCode(materialInsertedAwaitingRefresh.areaCode);
    } else {
      setMaterialName("");
      setMaterialAreaCode("");
    }
    setMaterialAreasLoading(true);
    try {
      const { data, error } = await supabase
        .from("production_areas").select("code,label").eq("is_active", true).order("label");
      if (error) throw error;
      setMaterialAreas(Array.isArray(data) ? data : []);
    } catch (error) {
      setMaterialAreas([]);
      setMaterialError(error?.message || "No se pudieron cargar las áreas de producción.");
    } finally {
      setMaterialAreasLoading(false);
    }
  };

  const closeMaterialModal = () => {
    if (materialSaving) return;
    setShowMaterialModal(false);
    setMaterialError("");
    if (!materialInsertedAwaitingRefresh) {
      setMaterialName("");
      setMaterialAreaCode("");
    }
  };

  const handleSaveMaterial = async () => {
    if (materialSaving) return;
    const normalizedName = materialInsertedAwaitingRefresh?.name || materialName.trim();
    const activeArea = materialInsertedAwaitingRefresh
      ? { code: materialInsertedAwaitingRefresh.areaCode }
      : materialAreas.find((area) => area.code === materialAreaCode);
    if (normalizedName.length < 2) {
      setMaterialError("El nombre del material debe tener al menos 2 caracteres.");
      return;
    }
    if (!activeArea) {
      setMaterialError("Selecciona un área de producción activa.");
      return;
    }

    setMaterialSaving(true);
    setMaterialError("");
    try {
      if (!materialInsertedAwaitingRefresh) {
        const { error } = await supabase.from("materials").insert({
          name: normalizedName,
          production_area_code: activeArea.code,
        });
        if (error) {
          if (error.code === "23505") throw new Error("Ya existe un material con ese nombre en esta área.");
          if (error.code === "42501") throw new Error("No tienes permiso para crear materiales.");
          throw new Error("No se pudo guardar el material. Revisa tu conexión e inténtalo de nuevo.");
        }
        setMaterialInsertedAwaitingRefresh({ name: normalizedName, areaCode: activeArea.code });
      }

      const catalogsLoaded = await loadDesignerCatalogs();
      if (!catalogsLoaded) {
        setMaterialError("El material ya se guardó, pero no se pudo actualizar el catálogo. Inténtalo de nuevo.");
        return;
      }

      setMaterialInsertedAwaitingRefresh(null);
      setShowMaterialModal(false);
      setMaterialName("");
      setMaterialAreaCode("");
      notif.showActionNotification({
        type: "info",
        title: "Material creado",
        message: `El material "${normalizedName}" se agregó correctamente.`,
        metadata: { variant: "success", event_kind: "material_created", material_name: normalizedName },
      });
    } catch (error) {
      setMaterialError(error?.message || "No se pudo completar la operación por un problema de conexión.");
    } finally {
      setMaterialSaving(false);
    }
  };

  useEffect(() => {
    localStorage.setItem(EDITED_ORDERS_STORAGE_KEY, JSON.stringify(editedOrders));
  }, [editedOrders]);

  const pendingReviewForDesigner = selectedOrder
    ? pendingOrderReviews[selectedOrder.id] || null
    : null;

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

  const handleViewOrder = useCallback((order) => {
    setEditedOrders(prev => {
      if (!prev[order.id]) return prev;
      const next = { ...prev };
      delete next[order.id];
      return next;
    });

    const requestId = ++detailRequestRef.current;
    setSelectedOrder(order);
    if (pendingNewAssignments[order.id]) {
      void newOrderAssignments.acknowledgeOrder(order.id);
    }
    void supabase
      .from("orders")
      .select(DESIGNER_ORDER_SELECT)
      .eq("id", order.id)
      .eq("designer_id", userRef.current?.id)
      .single()
      .then(({ data, error }) => {
        if (requestId !== detailRequestRef.current || error || !data) {
          if (error) console.warn("No se pudo actualizar el detalle de la orden:", error.message || error);
          return;
        }
        setSelectedOrder((current) => current?.id === order.id ? data : current);
      })
      .catch((error) => console.warn("No se pudo actualizar el detalle de la orden:", error?.message || error));
  }, [newOrderAssignments, pendingNewAssignments]);

  const handleOpenProductionAssignment = useCallback((order) => {
    if (!order?.id || productionSaving) return;
    setProductionOrder(order);
  }, [productionSaving]);

  const handleConfirmProductionAssignment = useCallback(async (assignments) => {
    if (!productionOrder?.id || productionSaving) return;
    setProductionSaving(true);
    const { data: updatedOrder, error } = await supabase.rpc("send_order_to_production", {
      p_order_id: productionOrder.id,
      p_area_assignments: assignments,
    });
    setProductionSaving(false);
    if (error || !updatedOrder) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al enviar",
        orderTitle: productionOrder.client_name || `Orden #${productionOrder.id.slice(0, 8).toUpperCase()}`,
        message: error?.message || "No se pudo enviar la orden a Producción.",
      });
      return;
    }
    const nextOrder = { ...productionOrder, ...updatedOrder };
    setOrders((previous) => previous.map((item) => item.id === nextOrder.id ? { ...item, ...nextOrder } : item));
    setSelectedOrder((current) => current?.id === nextOrder.id ? nextOrder : current);
    setProductionOrder(null);
    await fetchOrders();
  }, [fetchOrders, notif, productionOrder, productionSaving]);

  const isInteractiveOrderRowTarget = (target) => Boolean(
    target?.closest?.("button, a, input, select, textarea, [data-row-action]")
  );

  const handleDesignerOrderRowClick = useCallback((event, order) => {
    if (isInteractiveOrderRowTarget(event.target)) return;
    handleViewOrder(order);
  }, [handleViewOrder]);

  const handleDesignerOrderRowKeyDown = useCallback((event, order) => {
    if (!["Enter", " "].includes(event.key)) return;
    if (isInteractiveOrderRowTarget(event.target)) return;
    event.preventDefault();
    handleViewOrder(order);
  }, [handleViewOrder]);

  useEffect(() => {
    const nextUser = authUser || null;
    const previousUserId = userRef.current?.id;
    setUser(nextUser);
    userRef.current = nextUser;
    if (previousUserId && previousUserId !== nextUser?.id) {
      detailRequestRef.current += 1;
      previousOrdersRef.current = {};
      ordersInitializedRef.current = false;
      ordersRef.current = [];
      setOrders([]);
      setClients([]);
      setProductionCatalog({ materials: {}, terminations: {} });
      setSelectedOrder(null);
      setLoading(Boolean(nextUser?.id));
      setOrdersLoadError("");
    }
  }, [authUser]);

  useEffect(() => {
    return () => {

    };
  }, []);

  const isNewOrder = (order) => Boolean(pendingNewAssignments[order.id]);

  const getEditLabel = (order) => {
    if (editedOrders[order.id] && !pendingOrderReviews[order.id]) return "Editada";
    return null;
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

  const activeDesignerOrders = orders.filter((order) => (
    !order.is_archived_designer &&
    !isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED])
  ));
  const activeOrdersCount = activeDesignerOrders.length;
  const newOrdersCount = activeDesignerOrders.filter((order) => isNewOrder(order)).length;
  const editedOrdersCount = activeDesignerOrders.filter((order) => Boolean(getEditLabel(order))).length;
  const returnedBannerOrdersCount = activeDesignerOrders.filter((order) => isReturnedOrder(order)).length;
  const returnedOrdersCount = orders.filter((order) => isReturnedOrder(order)).length;
  const activeOrders = useMemo(() => orders.filter((order) => !order.is_archived_designer && !isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED])), [orders]);
  const archivedOrders = useMemo(() => orders.filter((order) => order.is_archived_designer), [orders]);
  const cancelledOrders = useMemo(() => orders.filter((order) => isOrderStatus(order.status, ORDER_STATUS.CANCELLED)), [orders]);
  const allOrdersCount = orders.length;
  const activeOrdersCountTab = activeOrders.length;
  const archivedOrdersCount = archivedOrders.length;
  const cancelledOrdersCount = cancelledOrders.length;
  const initialOrdersPending = loading && !ordersInitializedRef.current;
  const initialOrdersFailed = Boolean(ordersLoadError && !ordersInitializedRef.current);

  const metrics = [
    { label: "Órdenes activas", value: initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-metric" /> : initialOrdersFailed ? "—" : activeOrdersCount, sub: "Asignadas a tu bandeja", accentIdx: 0, icon: <Icons.Orders /> },
    { label: "En caja", value: initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-metric" /> : initialOrdersFailed ? "—" : orders.filter((order) => isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)).length, sub: "Listas para seguir flujo", accentIdx: 1, icon: <Icons.Send /> },
    { label: "Devueltas", value: initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-metric" /> : initialOrdersFailed ? "—" : returnedOrdersCount, sub: "Requieren corrección", accentIdx: 2, icon: <Icons.ArrowLeft /> },
    { label: "En producción", value: initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-metric" /> : initialOrdersFailed ? "—" : orders.filter((order) => isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)).length, sub: "Siendo producidas", accentIdx: 3, icon: <Icons.Package /> },
  ];
  const effectivePerPage = viewMode === "cards" ? DESIGNER_CARD_PAGE_SIZE : PER_PAGE;
  const filteredOrders = orders.filter((order) => {
    const query = search.trim().toLowerCase();
    const searchableValues = [order.client_name, order.description, order.id, order.material];
    const matchesSearch = !query || searchableValues.some((value) => String(value || "").toLowerCase().includes(query));
    const matchesType = filterType === "all" || (filterType === "911" ? order.order_type === "orden 911" : order.order_type !== "orden 911");
    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesClient = orderMatchesClientFilter(order, filterClient);
    const matchesOverdue = filterOverdue === "all" || isOrderOverdue(order);
    const matchesArchive = filterArchive === "all" ||
      (filterArchive === "active" && !order.is_archived_designer) ||
      (filterArchive === "archived" && order.is_archived_designer) ||
      (filterArchive === "cancelled" && isOrderStatus(order.status, ORDER_STATUS.CANCELLED)) ||
      (filterArchive === "returned" && isReturnedOrder(order));
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
    const matchesDate = filterDate === "all" ||
      (filterDate === "today" && createdAt >= startOfToday) ||
      (filterDate === "yesterday" && createdAt >= startOfYesterday && createdAt < startOfToday) ||
      (filterDate === "3days" && createdAt >= threeDaysAgo) ||
      (filterDate === "7days" && createdAt >= sevenDaysAgo) ||
      (filterDate === "month" && createdAt >= startOfMonth);
    return matchesSearch && matchesType && matchesStatus && matchesClient && matchesDate && matchesArchive && matchesOverdue;
  });
  const totalPages = Math.ceil(filteredOrders.length / effectivePerPage) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * effectivePerPage, safePage * effectivePerPage);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);
  useEffect(() => { setPage(1); }, [viewMode]);

  const refreshOrderFromDB = async (orderId) => {
    const requestId = ++detailRequestRef.current;
    const { data, error } = await supabase.from("orders").select(DESIGNER_ORDER_SELECT)
      .eq("id", orderId).eq("designer_id", userRef.current?.id).single();
    if (requestId !== detailRequestRef.current) return;
    if (data) {
      setOrders(prev => prev.map(o => o.id === orderId ? data : o));
      setSelectedOrder(data);
    }
    if (error) console.warn("No se pudo actualizar el detalle de la orden:", error.message || error);
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
    await fetchOrders();
  };

  const handleConfirmSendToQuotation = async (quoteUserId) => {
    if (!sendingToQuotation) return;

    setQuotationSending(true);

    const { error: updateError } = await supabase.rpc("designer_send_order_to_quote", {
      p_order_id: sendingToQuotation.id,
      p_quote_id: quoteUserId,
    });

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
    await fetchOrders();

  };

  const handleReturnToCashier = async (correctionNote) => {
    if (!returningToCashier) return;
    setReturningToCashierLoading(true);
    const { error } = await supabase.rpc("return_order_to_cashier", {
      p_handoff_id: returningToCashier.id,
      p_correction_note: correctionNote,
    });
    setReturningToCashierLoading(false);
    if (error) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al regresar",
        orderTitle: selectedOrder?.client_name || "Orden",
        message: error.message || "No se pudo regresar la orden a Caja.",
      });
      return;
    }
    const orderId = returningToCashier.order_id;
    setReturningToCashier(null);
    await Promise.all([refreshOrderFromDB(orderId), orderReturns.refresh(), fetchOrders()]);
  };

  const handleReturnToSales = async (reason) => {
    if (!returningToSales || returningToSalesLoading) return;
    if (returningToSales.created_by === user?.id) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Acción no disponible",
        orderTitle: returningToSales.client_name || "Orden",
        message: "Las órdenes creadas por Diseño no pueden devolverse a Ventas.",
      });
      setReturningToSales(null);
      return;
    }
    setReturningToSalesLoading(true);
    const { data, error } = await supabase.rpc("designer_return_order_to_sales", {
      p_order_id: returningToSales.id,
      p_reason: reason,
      p_expected_updated_at: returningToSales.updated_at,
    });
    setReturningToSalesLoading(false);
    if (error || !data) {
      notif.showActionNotification({ type: "order_cancelled", label: "Error al devolver", orderTitle: returningToSales.client_name || "Orden", message: error?.message || "No se pudo devolver la orden a Ventas." });
      return;
    }
    setReturningToSales(null);
    setSelectedOrder(null);
    await Promise.all([fetchOrders(), notif.refresh({ showNewToasts: true })]);
  };

  const pageTitle = activeTab === "dashboard"
    ? "Panel Principal"
    : activeTab === "profile"
      ? "Mi Perfil"
      : activeTab === "notifications"
        ? "Notificaciones"
        : "Gestión de órdenes";

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
          { id: "orders", label: "Mis Órdenes", icon: <Icons.Orders />, badge: initialOrdersPending ? "…" : initialOrdersFailed ? "—" : activeOrdersCount },
          { id: "profile", label: "Mi Perfil", icon: <Icons.User /> },
          { id: "notifications", label: "Notificaciones", icon: <Icons.Bell />, badge: notif.unreadCount }
        ]}
        onCreateNew={() => setShowCreate(true)}
        showCreateButton
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
              <div className="pd-page-title">{pageTitle}</div>
              <div className="pd-page-date">{todayLabel}</div>
            </div>
          </div>

          <div className="pd-topbar-right">
            <button
              className="ps-topbar-new-btn"
              type="button"
              onClick={() => setShowCreate(true)}
              aria-label="Nueva orden"
            >
              <div className="ps-topbar-new-inner"><Icons.Plus /> Nueva Orden</div>
              <div className="ps-topbar-new-stripe" />
            </button>
            <button
              className="pd-topbar-catalog-btn"
              type="button"
              onClick={() => setShowNewClientModal(true)}
              aria-label="Nuevo cliente"
            >
              <Icons.User />
              <span>Nuevo cliente</span>
            </button>
            <button
              className="pd-topbar-catalog-btn"
              type="button"
              onClick={openMaterialModal}
              aria-label="Crear materiales"
            >
              <Icons.Package />
              <span>Crear materiales</span>
            </button>
            <button className="ps-icon-btn" onClick={fetchOrders} title="Recargar" aria-label="Recargar">
              <Icons.Refresh />
            </button>

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
              onViewAll={() => setActiveTab("notifications")}
            />

            {/* Botón para cambiar entre dashboard, órdenes y perfil */}
            {activeTab !== "profile" && (
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
            )}
          </div>
        </header>
        {/* Contenedor con Contenido principal */}
        <main className={`pd-main-content${activeTab === "orders" ? " pd-main-content--orders" : ""}`} ref={mainScrollRef}>
          {activeTab === "dashboard" && (
            <>
              <div className="pd-greeting">
                <div className="pd-greeting-copy">
                  <h2>Buen día, <span className="pd-user-name">{displayName}</span></h2>
                  <p>Aqui tienes el resumen de tu actividad de hoy.</p>
                  <div className="pd-greeting-badges" aria-label="Resumen de órdenes" aria-busy={initialOrdersPending}>
                    {initialOrdersPending && <span className="pd-sr-only" role="status" aria-live="polite">Cargando resumen de órdenes...</span>}
                    <div className="pd-greeting-count" aria-label={initialOrdersPending ? "Cargando órdenes activas" : `${activeOrdersCount} órdenes activas`}>
                      <Icons.Package />
                      <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : activeOrdersCount.toLocaleString("es-DO")}</strong> Órdenes activas
                    </div>
                    <div className="pd-greeting-count pd-greeting-count--new" aria-label={initialOrdersPending ? "Cargando órdenes nuevas" : `${newOrdersCount} órdenes nuevas sin revisar`}>
                      <Icons.Bell />
                      <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : newOrdersCount.toLocaleString("es-DO")}</strong> Nuevas
                    </div>
                    <div className="pd-greeting-count pd-greeting-count--edited" aria-label={initialOrdersPending ? "Cargando órdenes editadas" : `${editedOrdersCount} órdenes editadas`}>
                      <Icons.Edit />
                      <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : editedOrdersCount.toLocaleString("es-DO")}</strong> Editadas
                    </div>
                    <div className="pd-greeting-count pd-greeting-count--returned" aria-label={initialOrdersPending ? "Cargando órdenes devueltas" : `${returnedBannerOrdersCount} órdenes devueltas`}>
                      <Icons.ArrowLeft />
                      <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : returnedBannerOrdersCount.toLocaleString("es-DO")}</strong> Devueltas
                    </div>
                  </div>
                </div>
                <div className="pd-greeting-actions">
                  <button type="button" className="pd-greeting-btn primary" onClick={() => setActiveTab("orders")}>
                    <Icons.Clipboard />
                    Gestión de Órdenes
                  </button>
                </div>
              </div>
              
              <div className="pd-metrics" aria-busy={initialOrdersPending}>
                {initialOrdersPending && <span className="pd-sr-only" role="status" aria-live="polite">Cargando métricas de órdenes...</span>}
                {metrics.map((m, i) => (
                  <MetricCard key={i} {...m} />
                ))}
              </div>
              
            <section className="pa-panel acm-table-panel pd-recent-section">
              <div className="pa-panel-stripe" />
                <div className="pa-panel-head pa-panel-head-results pd-recent-panel-head">
                  <div>
                    <h2>Órdenes recientes</h2>
                    <p className="acm-panel-description">Las 5 órdenes más recientes del área de diseño.</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="pa-results-count">{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "— órdenes" : `${allOrdersCount} orden${allOrdersCount !== 1 ? "es" : ""}`}</span>
                    <button className="pd-link-btn" onClick={() => setActiveTab("orders")}>
                      Ver todas <Icons.ArrowRight />
                    </button>
                  </div>
                </div>
                  <div className="ps-table-wrap" aria-busy={initialOrdersPending}>
                    <table className="ps-table acm-table pd-recent-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Tipo de orden</th>
                          <th>Con archivos</th>
                          <th>Estado</th>
                          <th aria-label="Acciones" />
                        </tr>
                      </thead>
                      <tbody>
                        {initialOrdersPending ? (
                          <DesignerOrderTableSkeleton rows={5} columns={5} recent />
                        ) : initialOrdersFailed ? (
                          <tr><td colSpan={5} className="ps-table-empty"><OrdersLoadError onRetry={fetchOrders} /></td></tr>
                        ) : orders.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="ps-table-empty">No tienes órdenes asignadas.</td>
                          </tr>
                        ) : (
                          orders.slice(0, 5).map(order => (
                          <tr key={order.id} className="row-hover acm-client-row" onClick={() => handleViewOrder(order)}>
                            <td className="td-pad">
                              <div className="acm-client-cell">
                                <span className="acm-avatar acm-avatar-small">{getInitials(order.client_name)}</span>
                                <span>
                                  <strong title={order.client_name || "Sin cliente"}>{order.client_name || "Sin cliente"}</strong>
                                </span>
                              </div>
                            </td>
                            <td className="td-pad">
                              {order.order_type === "orden 911"
                                ? <span className="acm-badge danger">911</span>
                                : <span className="acm-badge neutral">Normal</span>}
                            </td>
                            <td className="td-pad">
                              {(() => {
                                const count = (orderFiles?.[order.id] || getDesignerFilesFromOrder(order)).length;
                                return count > 0
                                  ? <span className="acm-badge info">{count} {count === 1 ? "Archivo" : "Archivos"}</span>
                                  : <span className="acm-badge neutral">Sin archivos</span>;
                              })()}
                            </td>
                            <td className="td-pad">
                              <div className="pd-status-stack">
                                {isReturnedOrder(order) && <ReturnedBadge compact />}
                                {isNewOrder(order) && <NewOrderBadge compact />}
                                <OrderReviewBadge review={pendingOrderReviews[order.id]} />
                                {isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE) && order.production_authorized_at && <span className="acm-badge success" title="Autorizada por Caja o Administración">Lista para enviar</span>}
                                {getEditLabel(order) && <span className="acm-badge warning">{getEditLabel(order)}</span>}
                                <StatusBadge status={order.status} className="acm-badge" bordered order={order} />
                              </div>
                            </td>
                            <td className="td-pad td-actions" data-row-action>
                              <div className="table-actions acm-row-actions" data-row-action>
                                {canDesignerSendInternalOrderToQuote(order, user?.id) && (
                                  <button className="table-action-btn quote" title="Enviar a Caja" aria-label="Enviar a Caja" onClick={(event) => { event.stopPropagation(); setSendingToQuotation(order); }}><Icons.Send /></button>
                                )}
                                {canDesignerRouteInternalOrderToProduction(order, user?.id) && (
                                  <button className="table-action-btn production" title="Enviar a producción" aria-label="Enviar a producción" onClick={(event) => { event.stopPropagation(); handleOpenProductionAssignment(order); }}><Icons.Package /></button>
                                )}
                                {canDesignerReturnInternalOrderToSales(order, user?.id) && (
                                  <button className="table-action-btn cancel" title="Devolver a Ventas" aria-label="Devolver a Ventas" onClick={(event) => { event.stopPropagation(); setReturningToSales(order); }}><Icons.ArrowLeft /></button>
                                )}
                                <button className="table-action-btn view" title="Ver detalle" aria-label="Ver detalle" onClick={(event) => { event.stopPropagation(); handleViewOrder(order); }}>
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
              </section>
            </>
          )}

          {activeTab === "orders" && (
            <section className="pq-section">
              <div className="pp-filters">
                <label className="pp-filter-control pp-filter-search">
                  <Icons.Search />
                  <input
                    type="search"
                    placeholder="Buscar por cliente, ID o descripción..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                  />
                  {search && (
                    <button type="button" onClick={() => { setSearch(""); setPage(1); }} aria-label="Limpiar búsqueda">
                      <Icons.X />
                    </button>
                  )}
                </label>

                <FilterSelect
                  icon={<Icons.FileText />}
                  value={filterType}
                  onChange={v => { setFilterType(v); setPage(1); }}
                  options={[
                    { value: "all", label: "Todos los tipos" },
                    { value: "normal", label: "Normal" },
                    { value: "911", label: "911 - Urgente" },
                  ]}
                />

                <FilterSelect
                  icon={<Icons.FileText />}
                  value={filterStatus}
                  onChange={v => { setFilterStatus(v); setPage(1); }}
                  options={[
                    { value: "all", label: "Todos los estados" },
                    { value: ORDER_STATUS.IN_DESIGN, label: "En Diseño" },
                    { value: ORDER_STATUS.IN_QUOTE, label: "Caja" },
                    { value: ORDER_STATUS.IN_PRODUCTION, label: "Producción" },
                    { value: ORDER_STATUS.IN_COMPLETED, label: "Completada" },
                  ]}
                />

                <FilterSelect
                  icon={<Icons.Calendar />}
                  value={filterDate}
                  onChange={v => { setFilterDate(v); setPage(1); }}
                  options={[
                    { value: "all", label: "Todas las fechas" },
                    { value: "today", label: "Hoy" },
                    { value: "yesterday", label: "Ayer" },
                    { value: "3days", label: "Últimos 3 días" },
                    { value: "7days", label: "Últimos 7 días" },
                    { value: "month", label: "Este mes" },
                  ]}
                />

                <FilterSelect
                  icon={<Icons.Users />}
                  value={filterClient}
                  onChange={v => { setFilterClient(v); setPage(1); }}
                  options={[
                    { value: "all", label: "Todos los clientes" },
                    ...clients.map(c => ({ value: c.id, label: c.name })),
                  ]}
                />

                <FilterSelect
                  icon={<Icons.AlertCircle />}
                  value={filterOverdue}
                  onChange={v => { setFilterOverdue(v); setPage(1); }}
                  options={[
                    { value: "all", label: "Todas las fechas de entrega" },
                    { value: "overdue", label: "Atrasadas" },
                  ]}
                />

                <span className="pp-filters-count"><Icons.Clipboard /> {filteredOrders.length} resultado{filteredOrders.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="pp-workbench-panel">
                <div className="pp-workbench-heading">
                  <div>
                    <span className="pp-workbench-kicker">Bandeja de trabajo</span>
                    <h3>{filterArchive === "all" ? "Todas las órdenes" : filterArchive === "archived" ? "Órdenes archivadas" : filterArchive === "cancelled" ? "Órdenes canceladas" : filterArchive === "returned" ? "Órdenes devueltas" : "Órdenes activas"}</h3>
                  </div>
                  <div className="pp-workbench-tools">
                    <div className="pp-workbench-tabs" role="tablist" aria-label="Filtro de archivo de órdenes">
                      <button
                        type="button"
                        className={filterArchive === "all" ? "active" : ""}
                        onClick={() => { setFilterArchive("all"); setPage(1); }}
                        aria-selected={filterArchive === "all"}
                      >
                        <Icons.Clipboard />
                        <span>Todas</span>
                        <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : allOrdersCount}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "active" ? "active" : ""}
                        onClick={() => { setFilterArchive("active"); setPage(1); }}
                        aria-selected={filterArchive === "active"}
                      >
                        <Icons.Package />
                        <span>Activas</span>
                        <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : activeOrdersCountTab}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "archived" ? "active" : ""}
                        onClick={() => { setFilterArchive("archived"); setPage(1); }}
                        aria-selected={filterArchive === "archived"}
                      >
                        <Icons.Archive />
                        <span>Archivadas</span>
                        <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : archivedOrdersCount}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "cancelled" ? "active" : ""}
                        onClick={() => { setFilterArchive("cancelled"); setPage(1); }}
                        aria-selected={filterArchive === "cancelled"}
                      >
                        <Icons.Trash />
                        <span>Canceladas</span>
                        <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : cancelledOrdersCount}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "returned" ? "active" : ""}
                        onClick={() => { setFilterArchive("returned"); setPage(1); }}
                        aria-selected={filterArchive === "returned"}
                      >
                        <Icons.ArrowLeft />
                        <span>Devueltas</span>
                        <strong>{initialOrdersPending ? <DesignerSkeletonLine className="pd-skeleton-counter" /> : initialOrdersFailed ? "—" : returnedOrdersCount}</strong>
                      </button>
                    </div>
                    <div className="pp-workbench-view-toggle" aria-label="Modo de vista">
                      <button
                        type="button"
                        onClick={() => setViewMode("table")}
                        className={viewMode === "table" ? "active" : ""}
                        title="Vista de tabla"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("cards")}
                        className={viewMode === "cards" ? "active" : ""}
                        title="Vista de tarjetas"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

              <div className="pp-workbench-body">
                <div className={`ps-panel${viewMode === "cards" ? " ps-panel--transparent" : ""}`}>
                <div className="ps-panel-stripe" />
                {viewMode === "table" ? (
                  <div className="ps-table-wrap" aria-busy={initialOrdersPending}>
                    <table className="ps-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Tipo</th>
                          <th>Estado</th>
                          <th>Fecha</th>
                          <th>Archivos</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {initialOrdersPending ? (
                          <DesignerOrderTableSkeleton rows={PER_PAGE} columns={6} />
                        ) : initialOrdersFailed ? (
                          <tr><td colSpan={6} className="ps-table-empty"><OrdersLoadError onRetry={fetchOrders} /></td></tr>
                        ) : filteredOrders.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="ps-table-empty">No hay órdenes que coincidan con los filtros.</td>
                          </tr>
                        ) : (
                          paginatedOrders.map(order => {
                            const fileCount = (orderFiles?.[order.id] || getDesignerFilesFromOrder(order)).length;
                            return (
                            <tr
                              key={order.id}
                              className="row-hover ps-order-row"
                              tabIndex={0}
                              onClick={(event) => handleDesignerOrderRowClick(event, order)}
                              onKeyDown={(event) => handleDesignerOrderRowKeyDown(event, order)}
                              aria-label={`Ver detalles de la orden ${order.id?.slice(0, 8) || ""} de ${order.client_name || "cliente sin nombre"}`}
                            >
                              <td className="td-pad td-name">
                                <div className="ps-client-cell">
                                  <span className="acm-avatar acm-avatar-small">{getInitials(order.client_name)}</span>
                                  <span className="ps-client-cell-main">
                                    <strong title={order.client_name || "Sin cliente"}>{order.client_name || "Sin cliente"}</strong>
                                    <span className="ps-client-cell-badges">
                                      {isReturnedOrder(order) && <ReturnedBadge compact />}
                                      {isNewOrder(order) && <NewOrderBadge compact />}
                                      <OrderReviewBadge review={pendingOrderReviews[order.id]} />
                                      {isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE) && order.production_authorized_at && <span className="acm-badge success" title="Autorizada por Caja o Administración">Lista para enviar</span>}
                                      {getEditLabel(order) && <span className="acm-badge warning">{getEditLabel(order)}</span>}
                                    </span>
                                  </span>
                                </div>
                              </td>
                              <td className="td-pad">
                                {order.order_type === "orden 911" ? <span className="acm-badge danger">911</span> : <span className="acm-badge neutral">Normal</span>}
                              </td>
                              <td className="td-pad"><StatusBadge status={order.status} className="acm-badge" bordered order={order} /></td>
                              <td className="td-pad"><span className="ps-date-badge">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></td>
                              <td className="td-pad">
                                {fileCount > 0
                                  ? <span className="acm-badge info">{fileCount} {fileCount === 1 ? "Archivo" : "Archivos"}</span>
                                  : <span className="acm-badge neutral">Sin archivos</span>}
                              </td>
                              <td className="td-pad td-actions" data-row-action>
                                <div className="table-actions" data-row-action>
                                  {canDesignerSendInternalOrderToQuote(order, user?.id) && (
                                    <button className="table-action-btn quote" title="Enviar a Caja" aria-label="Enviar a Caja" onClick={(event) => { event.stopPropagation(); setSendingToQuotation(order); }}>
                                      <Icons.Send />
                                    </button>
                                  )}
                                  {canDesignerRouteInternalOrderToProduction(order, user?.id) && (
                                    <button
                                      className="table-action-btn production"
                                      title="Enviar a producción"
                                      aria-label="Enviar a producción"
                                      onClick={(event) => { event.stopPropagation(); handleOpenProductionAssignment(order); }}
                                    >
                                      <Icons.Package />
                                    </button>
                                  )}
                                  {canDesignerReturnInternalOrderToSales(order, user?.id) && (
                                    <button className="table-action-btn cancel" title="Devolver a Ventas" aria-label="Devolver a Ventas" onClick={(event) => { event.stopPropagation(); setReturningToSales(order); }}>
                                      <Icons.ArrowLeft />
                                    </button>
                                  )}
                                  <button className="table-action-btn view" title="Ver detalle" onClick={(event) => { event.stopPropagation(); handleViewOrder(order); }}>
                                    <Icons.Eye />
                                  </button>
                                  {_canArchiveDesignerOrder(order) ? (
                                    <button className="table-action-btn archive" title="Archivar" onClick={(event) => { event.stopPropagation(); handleOpenArchiveOrder(order); }}>
                                      <Icons.Archived />
                                    </button>
                                  ) : order.is_archived_designer ? (
                                    <button className="table-action-btn archive" disabled title="Orden archivada">
                                      <Icons.Check />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  initialOrdersPending ? <DesignerOrderCardsSkeleton /> : initialOrdersFailed ? <OrdersLoadError onRetry={fetchOrders} /> : <div className="ps-cards-grid">
                    {filteredOrders.length === 0 ? (
                      <p className="ps-table-empty">No hay órdenes que coincidan con los filtros.</p>
                    ) : paginatedOrders.map(order => {
                      const fileCount = (orderFiles?.[order.id] || getDesignerFilesFromOrder(order)).length;
                      const isUrgent = String(order.order_type || "").toLowerCase().includes("911");
                      return (
                      <div
                        key={order.id}
                        className="ps-order-card"
                        onClick={() => handleViewOrder(order)}
                        data-order-type={isUrgent ? "911" : "normal"}
                      >
                        <div className="ps-order-card-client">
                          <span className="acm-avatar acm-avatar-small">{getInitials(order.client_name)}</span>
                          <span className="ps-order-card-client-main">
                            <strong title={order.client_name || "Sin cliente"}>{order.client_name || "Sin cliente"}</strong>
                            <span className="ps-order-card-client-badges">
                              <span className="ps-order-card-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                              {isReturnedOrder(order) && <ReturnedBadge compact />}
                              {isNewOrder(order) && <NewOrderBadge compact />}
                              <OrderReviewBadge review={pendingOrderReviews[order.id]} />
                              {isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE) && order.production_authorized_at && <span className="acm-badge success" title="Autorizada por Caja o Administración">Lista para enviar</span>}
                              {getEditLabel(order) && <span className="acm-badge warning">{getEditLabel(order)}</span>}
                            </span>
                          </span>
                        </div>

                        <div className="ps-order-card-fields">
                          <div className="ps-order-card-field">
                            <span className="ps-order-card-field-label">Tipo</span>
                            {isUrgent
                              ? <span className="acm-badge danger">911</span>
                              : <span className="acm-badge neutral">Normal</span>
                            }
                          </div>
                          <div className="ps-order-card-field">
                            <span className="ps-order-card-field-label">Estado</span>
                            <StatusBadge status={order.status} className="acm-badge" bordered order={order} />
                          </div>
                        </div>

                        <div className="ps-order-card-footer">
                          <span className="ps-order-card-date">
                            {new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {fileCount > 0
                            ? <span className="acm-badge info">{fileCount} {fileCount === 1 ? "Archivo" : "Archivos"}</span>
                            : <span className="acm-badge neutral">Sin archivos</span>
                          }
                        </div>

                        <div className="ps-order-card-actions">
                          {canDesignerSendInternalOrderToQuote(order, user?.id) && (
                            <button className="card-action-btn quote" onClick={(event) => { event.stopPropagation(); setSendingToQuotation(order); }} title="Enviar a Caja" aria-label="Enviar a Caja"><Icons.Send /></button>
                          )}
                          {canDesignerRouteInternalOrderToProduction(order, user?.id) && (
                            <button className="card-action-btn production" onClick={(event) => { event.stopPropagation(); handleOpenProductionAssignment(order); }} title="Enviar a producción" aria-label="Enviar a producción">
                              <Icons.Package />
                            </button>
                          )}
                          {canDesignerReturnInternalOrderToSales(order, user?.id) && (
                            <button className="card-action-btn cancel" onClick={(event) => { event.stopPropagation(); setReturningToSales(order); }} title="Devolver a Ventas" aria-label="Devolver a Ventas"><Icons.ArrowLeft /></button>
                          )}
                          <button className="card-action-btn view" onClick={(event) => { event.stopPropagation(); handleViewOrder(order); }} title="Ver detalles">
                            <Icons.Eye />
                          </button>
                          {_canArchiveDesignerOrder(order) ? (
                            <button className="card-action-btn archive" onClick={(event) => { event.stopPropagation(); handleOpenArchiveOrder(order); }} title="Archivar">
                              <Icons.Archived />
                            </button>
                          ) : order.is_archived_designer ? (
                            <button className="card-action-btn archive" disabled title="Orden archivada">
                              <Icons.Check />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
                {!initialOrdersPending && !initialOrdersFailed && <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />}
                </div>
              </div>
              </div>
            </section>
          )}

          {activeTab === "profile" && (
            <DesignerProfileModule authUser={user} fallbackProfile={authProfile} />
          )}

          {activeTab === "notifications" && (
            <DesignerNotificationsModule
              notifications={notif.notifications}
              archivedNotifications={notif.archivedNotifications}
              unreadCount={notif.unreadCount}
              loading={notif.loading}
              archivedLoading={notif.archivedLoading}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDeleteAll={notif.deleteNotificationsByScope}
              notificationSoundEnabled={notif.notificationSoundEnabled}
              notificationSoundLoading={notif.notificationSoundLoading}
              onNotificationSoundChange={notif.setNotificationSoundEnabled}
            />
          )}
        </main>
      </div>


      <SharedCreateOrderModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async () => {
          await fetchOrders();
          await notif.refresh({ showNewToasts: true });
        }}
        userId={user?.id}
        productionCatalog={productionCatalog}
        clients={clients}
        clientsLoading={clientsLoading}
        onClientSearch={handleClientSearch}
        onAddNewClient={() => setShowNewClientModal(true)}
        clientToSelect={clientToSelectInOrderForm}
        onClientToSelectConsumed={() => setClientToSelectInOrderForm(null)}
        creationMode="designer"
      />
      <CreateClientModal
        open={showNewClientModal}
        onClose={() => setShowNewClientModal(false)}
        onCreated={handleNewClientCreated}
        supabase={supabase}
        userId={user?.id}
      />
      <MaterialFormModal
        open={showMaterialModal}
        onClose={closeMaterialModal}
        name={materialName}
        areaCode={materialAreaCode}
        areas={materialAreas}
        areasLoading={materialAreasLoading}
        insertedAwaitingRefresh={Boolean(materialInsertedAwaitingRefresh)}
        error={materialError}
        saving={materialSaving}
        onNameChange={(value) => { setMaterialName(value); setMaterialError(""); }}
        onAreaChange={(value) => { setMaterialAreaCode(value); setMaterialError(""); }}
        onSave={handleSaveMaterial}
      />
      <OrderDetailModal 
        open={!!selectedOrder} 
        onClose={() => { detailRequestRef.current += 1; setSelectedOrder(null); }}
        order={selectedOrder}
        designerFiles={selectedOrder ? orderFiles[selectedOrder.id] : []}
        designerPreview={selectedOrder ? orderPreviews[selectedOrder.id] : null}
        onSendToQuotation={handleOpenSendToQuotation}
        quotationSending={quotationSending}
        onRefresh={() => (
          selectedOrder ? refreshOrderFromDB(selectedOrder.id) : Promise.resolve()
        )}
        pendingReview={pendingReviewForDesigner}
        onAcknowledgeReview={pendingReviewForDesigner ? () => orderReviews.acknowledgeOrder(selectedOrder.id) : undefined}
        reviewAcknowledging={orderReviews.acknowledgingOrderId === selectedOrder?.id}
        reviewError={orderReviews.acknowledgeError}
        currentUserId={user?.id}
        returnHandoff={selectedOrder ? orderReturns.incomingByOrder[selectedOrder.id] : null}
        returnHistory={selectedOrder ? orderReturns.historyByOrder[selectedOrder.id] || [] : []}
        onReturnToCashier={setReturningToCashier}
        onOpenProductionAssignment={handleOpenProductionAssignment}
        productionActionLoading={productionSaving}
      />
      <ProductionAssignmentModal
        open={!!productionOrder}
        order={productionOrder}
        loading={productionSaving}
        onClose={() => setProductionOrder(null)}
        onConfirm={handleConfirmProductionAssignment}
      />
      <ReturnToCashierModal
        open={!!returningToCashier}
        handoff={returningToCashier}
        order={selectedOrder}
        onClose={() => setReturningToCashier(null)}
        onConfirm={handleReturnToCashier}
        loading={returningToCashierLoading}
      />
      <ReturnToDesignerModal
        open={!!returningToSales}
        order={returningToSales}
        targetOverride="sales"
        onClose={() => setReturningToSales(null)}
        onConfirm={handleReturnToSales}
        loading={returningToSalesLoading}
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
