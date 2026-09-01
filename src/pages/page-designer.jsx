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
import { ORDER_STATUS, isOrderStatus, isOrderStatusIn, ARCHIVE_MODULES, getFileNameFromUrl } from "../utils/constants";
import { StatusBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import { FilterSelect } from "../components/ui/FilterSelect";
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
import { loadClients, orderMatchesClientFilter, formatPhone } from "../utils/clients";
import { getOrderFiles, getPreviewImage, getReferenceImages } from "../utils/orderAssets";
import { canDecodeAsImage, compressImage, REF_IMAGE_CONFIG, validateReferenceImages } from "../utils/imageValidation";
import { buildProductionFileRows } from "../utils/production";
import { buildProductionCatalogs } from "../utils/production";
import { ProductionFileDetailsModal } from "../components/orders/CreateOrderModal";
import { applyOrdersSnapshot } from "../utils/orderRealtime";
import DesignerProfileModule from "../components/designer/DesignerProfileModule";
import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule";
import ReturnToCashierModal from "../components/orders/ReturnToCashierModal";
import { OrderReturnHandoffPanel } from "../components/orders/OrderReturnHandoff";
import { isOrderOverdue } from "../utils/orderDeadline";
import { isReturnedDesignerOrder, shouldMarkDesignerOrderEdited } from "../utils/designerOrderEdits";

const EDITED_ORDERS_STORAGE_KEY = "pd_edited_orders";
const PER_PAGE = 15;
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
  "return_reason",
  "returned_to_designer_at",
  "order_file_url",
  "preview_image",
  "reference_images",
  "designer_id",
  "seller_id",
  "created_by",
  "is_archived_designer",
  "quote_id",
  "quantity",
  "order_production_files(id, order_id, url, public_label, production_area_code, material_names, termination_name)",
  "order_files(id, provider, bucket, object_key, original_filename, content_type, category, status, deleted_at, uploaded_by)",
].join(", ");
const isReturnedOrder = isReturnedDesignerOrder;

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

const getDesignerFilesFromOrder = (order) => (
  getOrderFiles(order).map((url) => ({
    name: getFileNameFromUrl(url),
    url,
  }))
);

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
}) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingFileAreas, setPendingFileAreas] = useState([]);
  const [pendingFileLabels, setPendingFileLabels] = useState([]);
  const [pendingFileMaterials, setPendingFileMaterials] = useState([]);
  const [pendingFileTerminations, setPendingFileTerminations] = useState([]);
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
  const [referenceStates, setReferenceStates] = useState({});
  const [referenceSaving, setReferenceSaving] = useState(false);
  const [replacingReferenceId, setReplacingReferenceId] = useState(null);
  const designerPreviewInputRef = useRef(null);
  const designerReplacementReferenceInputRef = useRef(null);
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

  useEffect(() => {
    setOrderUpdatedAt(order?.updated_at || null);
  }, [order?.id, order?.updated_at]);

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
      setPendingFileMaterials(prev => [...prev, ...acceptedFiles.map(() => [])]);
      setPendingFileTerminations(prev => [...prev, ...acceptedFiles.map(() => "")]);
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
      setSaveSuccessMessage("Orden de trabajo eliminada correctamente.");
      setSaveSuccess(true);
    } catch (error) {
      console.error("Error removing design preview:", error);
      setSaveError(
        error?.message === "ORDER_STALE"
          ? "La orden cambió mientras la revisabas. Actualízala antes de volver a intentarlo."
          : error?.message || "No se pudo eliminar la orden de trabajo. Inténtalo nuevamente.",
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
    const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;
    const combined = [...pendingReferenceFiles, ...files].filter((file, index, list) => (
      list.findIndex((candidate) => fileKey(candidate) === fileKey(file)) === index
    ));
    const available = REF_IMAGE_CONFIG.MAX_COUNT - referenceAssets.length;
    if (combined.length > available) {
      const message = `Solo puedes agregar ${available} imagen${available === 1 ? "" : "es"} de referencia más.`;
      context?.showError?.(message);
      setSaveError(message);
      return;
    }
    setPendingReferenceFiles(combined);
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
    setPendingFiles([]);
    setPendingFileAreas([]);
    setPendingFileLabels([]);
    setPendingFileMaterials([]);
    setPendingFileTerminations([]);
    setPendingPreview(null);
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
  const workSummary = hasChanges
    ? { label: "Pendiente", icon: <Icons.Clock />, tone: "is-warning" }
    : canSendToQuotation
      ? { label: "Completado", icon: <Icons.Check />, tone: "is-ready" }
      : canEditDesignerAssets
        ? { label: "Editable", icon: <Icons.Edit />, tone: "is-editable" }
        : isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
          ? { label: "En revisión", icon: <Icons.Search />, tone: "is-review" }
          : { label: "Completado", icon: <Icons.Check />, tone: "is-ready" };
  const footerNote = !canEditDesignerAssets
    ? readonlyMessage
    : !hasRequiredAssets
      ? "Adjunta un archivo de diseño y la orden de trabajo para continuar."
    : hasChanges
      ? "Completa los datos de los archivos y guarda los cambios."
      : !persistedFilesAreConfigured
        ? "Completa los detalles de cada archivo antes de enviar a caja."
      : canSendToQuotation
        ? "La orden tiene archivos y preview. Lista para enviar a caja."
        : "Agrega archivos y preview para completar el trabajo de diseño.";
  const footerNoteClass = !canEditDesignerAssets || hasChanges || canSendToQuotation
    ? "designer-order-modal__footer-note"
    : "designer-order-modal__footer-note designer-order-modal__footer-note--accent";

  return (
    <div className="designer-order-modal-overlay">
      <div className="designer-order-modal">
        <div className="designer-order-modal__stripe"></div>
        <div className="designer-order-modal__header">
          <div className="designer-order-modal__inner-header">
            <div className="designer-order-modal__title">
              <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
              <span className="designer-order-modal__subtitle">Detalles de la orden de trabajo</span>
            </div>
            <button className="designer-order-modal__close" onClick={handleClose}>
              <Icons.Close />
            </button>
          </div>
        </div>
        
        <div className="designer-order-modal__body">
          <div className="designer-order-modal__summary" aria-label="Resumen de la orden">
            <div className="designer-order-modal__summary-item">
              <span><Icons.CheckCircle /> Estado</span>
              <StatusBadge status={order.status} className="designer-order-modal__summary-badge" showDot={false} bordered order={order} />
            </div>
            <div className="designer-order-modal__summary-item">
              <span><Icons.Paperclip /> Archivos</span>
              <strong className="acm-badge info designer-order-modal__summary-badge designer-order-modal__summary-badge-files">
                {uniqueFiles.length.toLocaleString("es-DO")} Archivos
              </strong>
            </div>
            <div className="designer-order-modal__summary-item">
              <span><Icons.Eye /> Preview</span>
              <strong className={`designer-order-modal__summary-badge designer-order-modal__summary-badge-preview ${hasPreview ? "is-ready" : "is-pending"}`}>
                {hasPreview ? "Cargada" : "Pendiente"}
              </strong>
            </div>
            <div className={`designer-order-modal__summary-item ${workSummary.tone}`}>
              <span><Icons.Package /> Trabajo</span>
              <strong className="designer-order-modal__work-status">
                {workSummary.icon}
                {workSummary.label}
              </strong>
            </div>
          </div>

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
          
          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.User />
              <h4>Información del Cliente</h4>
            </div>
            <div className="designer-order-modal__grid">
              <div className="designer-order-modal__item">
                <span className="designer-order-modal__label"><Icons.User /> Cliente</span>
                <span className="designer-order-modal__value">{order.client_name || "No especificado"}</span>
              </div>
              <div className="designer-order-modal__item">
                <span className="designer-order-modal__label"><Icons.User /> Vendedor</span>
                <span className="designer-order-modal__value highlight">{sellerName || "No especificado"}</span>
              </div>
              <div className="designer-order-modal__item">
                <span className="designer-order-modal__label"><Icons.Phone /> Teléfono</span>
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
                ) : <span className="designer-order-modal__value">No especificado</span>}
              </div>
              <div className="designer-order-modal__item">
                <span className="designer-order-modal__label"><Icons.Package /> Tipo de Orden</span>
                <span className="designer-order-modal__value">
                  {order.order_type === "orden 911" ? (
                    <span className="acm-badge danger">⚡ 911 - Urgente</span>
                  ) : (
                    <span className="acm-badge neutral">Normal</span>
                  )}
                </span>
              </div>
              <div className="designer-order-modal__item">
                <span className="designer-order-modal__label"><Icons.Calendar /> Fecha de Creación</span>
                <span className="designer-order-modal__date-badge">{created}</span>
              </div>
            </div>
          </div>

          <OrderReviewCard
            pendingReview={pendingReview}
            onAcknowledge={onAcknowledgeReview}
            acknowledging={reviewAcknowledging}
            error={reviewError}
          />

          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.Clipboard />
              <h4>Detalles de la orden de trabajo</h4>
              {isReturnedOrder(order) && <ReturnedBadge />}
            </div>
            <div className="designer-order-modal__grid">
              <div className="designer-order-modal__item full">
                <span className="designer-order-modal__label"><Icons.FileText /> Descripción</span>
                <p className="designer-order-modal__description">{order.description || "Sin descripción"}</p>
              </div>
              <div className="designer-order-modal__item">
                <span className="designer-order-modal__label"><Icons.Package /> Material</span>
                <span className="designer-order-modal__value highlight">{order.material || "No especificado"}</span>
              </div>
              {order.width && order.height && (
                <div className="designer-order-modal__item">
                  <span className="designer-order-modal__label"><Icons.Maximize /> Dimensiones</span>
                  <span className="designer-order-modal__value">{order.width} x {order.height} cm</span>
                </div>
              )}
              {order.quantity && (
                <div className="designer-order-modal__item">
                  <span className="designer-order-modal__label"><Icons.Hash /> Cantidad</span>
                  <span className="designer-order-modal__value">{order.quantity} unidades</span>
                </div>
              )}
            </div>
          </div>

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
                {pendingFiles.map((file, i) => (
                  <div key={i} className={missingLabelIndices.includes(i) || missingAreaIndices.includes(i) || missingSpecificationIndices.includes(i) ? 'pd-file-missing' : ''}>
                    <FileCard
                      name={file.name}
                      secondaryText={formatFileSize(file.size)}
                      onRemove={() => removePendingFile(i)}
                      detailText={pendingFileLabels[i] ? `Seguimiento: ${pendingFileLabels[i]}` : "Seguimiento pendiente"}
                      actions={[{
                        title: `Ver detalles de ${file.name}`,
                        label: "Detalles",
                        icon: <Icons.Edit />,
                        onClick: () => setFileDetailsTarget({ type: "pending", index: i, file }),
                      }]}
                      removeIcon={<Icons.Trash />}
                      removeTitle={`Eliminar ${file.name}`}
                    />
                  </div>
                ))}
              </div>
            )}

            {uniqueFiles.length > 0 && (
              <div className="pd-files-container" style={{ marginTop: pendingFiles.length > 0 ? '12px' : '16px' }}>
                <span className="pd-files-label">Archivos guardados ({uniqueFiles.length})</span>
                {uniqueFiles.map((file, i) => (
                  <FileCard
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
                        title: `Ver detalles de ${file.name}`,
                        label: "Detalles",
                        icon: <Icons.Edit />,
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
                  />
                ))}
              </div>
            )}
          </div>
          
          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.Image />
              <h4>Orden de trabajo</h4>
            </div>
            
            <div className="pd-preview-container">
              {displayPreview ? (
                <>
                  <img
                    src={displayPreview}
                    alt="Preview"
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
                          buttonLabel="Cambiar preview"
                          onFilesAccepted={handlePreviewSelect}
                        />
                        <button className="pd-file-action" style={{ background: 'white', color: '#0f172a' }} onClick={() => designerPreviewInputRef.current?.click()}>
                          <Icons.Edit />
                        </button>
                        <button
                          className="pd-file-action remove"
                          style={{ background: 'white' }}
                          disabled={removingPreview || Boolean(removingFileId)}
                          title={pendingPreview ? "Quitar orden de trabajo pendiente" : "Eliminar orden de trabajo"}
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
                      buttonLabel="Reemplazar orden de trabajo"
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

          <div className="designer-order-modal__card">
            <div className="designer-order-modal__card-title">
              <Icons.Image />
              <h4>Imágenes de referencia</h4>
              <span className="pd-reference-count">{referenceAssets.length}/{REF_IMAGE_CONFIG.MAX_COUNT}</span>
            </div>
            {referenceAssets.length > 0 ? (
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
              </div>
            ) : <p className="pd-reference-empty">Aún no hay imágenes de referencia.</p>}

            {canEditDesignerAssets && (referenceAssets.length + pendingReferenceFiles.length < REF_IMAGE_CONFIG.MAX_COUNT || pendingReferenceFiles.length > 0) && (
              <div className="pd-reference-upload">
                {referenceAssets.length + pendingReferenceFiles.length < REF_IMAGE_CONFIG.MAX_COUNT && (
                  <FileUploadZone
                    mode="image"
                    multiple
                    variant="compact"
                    maxFiles={REF_IMAGE_CONFIG.MAX_COUNT - referenceAssets.length}
                    existingCount={pendingReferenceFiles.length}
                    buttonLabel="Agregar imágenes de referencia"
                    onFilesAccepted={handleReferenceFiles}
                    disabled={referenceSaving}
                  />
                )}
                {pendingReferenceFiles.length > 0 && (
                  <div className="pd-reference-pending">
                    <span>{pendingReferenceFiles.length} imagen{pendingReferenceFiles.length === 1 ? "" : "es"} pendiente{pendingReferenceFiles.length === 1 ? "" : "s"}</span>
                    <div className="pd-reference-pending-actions">
                      <button type="button" className="designer-order-modal__button designer-order-modal__button--secondary" disabled={referenceSaving} onClick={() => setPendingReferenceFiles([])}>Cancelar</button>
                      <button type="button" className="designer-order-modal__button designer-order-modal__button--primary" disabled={referenceSaving} onClick={handleSaveReferenceFiles}>
                        {referenceSaving ? "Guardando..." : "Guardar imágenes"}
                      </button>
                    </div>
                  </div>
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
          <button className="designer-order-modal__button designer-order-modal__button--secondary" onClick={handleClose}>
            Cerrar
          </button>
          {canSendToQuotation && (
            <button
              className="designer-order-modal__button designer-order-modal__button--quotation"
              onClick={() => returnHandoff ? onReturnToCashier?.(returnHandoff) : onSendToQuotation?.(order)}
              disabled={quotationSending || Boolean(removingFileId)}
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
        catalog={productionCatalog}
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
  const [viewMode, setViewMode] = useState("table");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
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
  const [originalQuoterId, setOriginalQuoterId] = useState(null);
  const [quotationSending, setQuotationSending] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  
  const ordersRef = useRef([]);
  const userRef = useRef(null);
  const previousOrdersRef = useRef({});
  const ordersInitializedRef = useRef(false);
  const mainScrollRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    if (!userRef.current) return;

    const { data, error } = await supabase
      .from("orders")
      .select(DESIGNER_ORDER_SELECT)
      .eq("designer_id", userRef.current.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const previousOrders = previousOrdersRef.current;

      if (!ordersInitializedRef.current) {
        setEditedOrders(prev => {
          let changed = false;
          const next = { ...prev };

          data.forEach(order => {
            if (order.updated_by === userRef.current?.id && next[order.id]) {
              delete next[order.id];
              changed = true;
            }
          });

          return changed ? next : prev;
        });
        previousOrdersRef.current = data.reduce((acc, order) => {
          acc[order.id] = order;
          return acc;
        }, {});
        ordersInitializedRef.current = true;
        ordersRef.current = data;
        applyOrdersSnapshot({ orders: data, setOrders, setSelectedOrder });
        setLoading(false);
        return;
      }

      data.forEach(order => {
        const previousOrder = previousOrders[order.id];

        if (order.updated_by === userRef.current?.id) {
          setEditedOrders(prev => {
            if (!prev[order.id]) return prev;
            const next = { ...prev };
            delete next[order.id];
            return next;
          });
          return;
        }

        if (shouldMarkDesignerOrderEdited(previousOrder, order, userRef.current?.id)) {
          setEditedOrders(prev => ({ ...prev, [order.id]: Date.now() }));
        }
      });

      previousOrdersRef.current = data.reduce((acc, order) => {
        acc[order.id] = order;
        return acc;
      }, {});
      ordersRef.current = data;
      applyOrdersSnapshot({ orders: data, setOrders, setSelectedOrder });
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

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

  const handleViewOrder = useCallback(async (order) => {
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
    
    if (pendingNewAssignments[order.id]) {
      void newOrderAssignments.acknowledgeOrder(order.id);
    }
  }, [newOrderAssignments, pendingNewAssignments]);

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
    setUser(authUser || null);
    userRef.current = authUser || null;
  }, [authUser]);

  useEffect(() => {
    if (!user?.id) return;
    fetchOrders();
  }, [fetchOrders, user?.id]);

  useOrdersRealtimeSync({
    userId: user?.id,
    scope: "designer",
    refreshOrders: fetchOrders,
  });

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

  const activeDesignerOrders = orders.filter(order => (
    !order.is_archived_designer &&
    !isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED])
  ));
  const activeOrdersCount = activeDesignerOrders.length;
  const newOrdersCount = activeDesignerOrders.filter(order => isNewOrder(order)).length;
  const editedOrdersCount = activeDesignerOrders.filter(order => Boolean(getEditLabel(order))).length;
  const returnedBannerOrdersCount = activeDesignerOrders.filter(order => isReturnedOrder(order)).length;

  const returnedOrdersCount = orders.filter(o => isReturnedOrder(o)).length;
  const activeOrders = useMemo(() => orders.filter(o => !o.is_archived_designer && !isOrderStatusIn(o.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED])), [orders]);
  const archivedOrders = useMemo(() => orders.filter(o => o.is_archived_designer), [orders]);
  const cancelledOrders = useMemo(() => orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.CANCELLED)), [orders]);
  const returnedOrders = useMemo(() => orders.filter(o => isReturnedOrder(o)), [orders]);

  const metrics = [
    { label: "Órdenes activas", value: activeOrdersCount, sub: "Asignadas a tu bandeja", accentIdx: 0, icon: <Icons.Orders /> },
    { label: "En caja", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_QUOTE)).length, sub: "Listas para seguir flujo", accentIdx: 1, icon: <Icons.Send /> },
    { label: "Devueltas", value: returnedOrdersCount, sub: "Requieren corrección", accentIdx: 2, icon: <Icons.ArrowLeft /> },
    { label: "En producción", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_PRODUCTION)).length, sub: "Siendo producidas", accentIdx: 3, icon: <Icons.Package /> },
  ];

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
    const matchesOverdue = filterOverdue === "all" || isOrderOverdue(order);

    const matchesArchive =
      filterArchive === "all" ||
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

    const matchesDate =
      filterDate === "all" ||
      (filterDate === "today" && createdAt >= startOfToday) ||
      (filterDate === "yesterday" && createdAt >= startOfYesterday && createdAt < startOfToday) ||
      (filterDate === "3days" && createdAt >= threeDaysAgo) ||
      (filterDate === "7days" && createdAt >= sevenDaysAgo) ||
      (filterDate === "month" && createdAt >= startOfMonth);

    return matchesSearch && matchesType && matchesStatus && matchesClient && matchesDate && matchesArchive && matchesOverdue;
  });

  const effectivePerPage = viewMode === "cards" ? 10 : PER_PAGE;
  const totalPages = Math.ceil(filteredOrders.length / effectivePerPage) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * effectivePerPage, safePage * effectivePerPage);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);
  useEffect(() => { setPage(1); }, [viewMode]);

  useEffect(() => {
    const nextFiles = {};
    const nextPreviews = {};

    orders.forEach(order => {
      nextFiles[order.id] = getDesignerFilesFromOrder(order);
      const preview = getPreviewImage(order);
      if (preview) nextPreviews[order.id] = preview;
    });

    setOrderFiles(nextFiles);
    setOrderPreviews(nextPreviews);
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
          { id: "orders", label: "Mis Órdenes", icon: <Icons.Orders />, badge: activeOrdersCount },
          { id: "profile", label: "Mi Perfil", icon: <Icons.User /> },
          { id: "notifications", label: "Notificaciones", icon: <Icons.Bell />, badge: notif.unreadCount }
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
              <div className="pd-page-title">{pageTitle}</div>
              <div className="pd-page-date">{todayLabel}</div>
            </div>
          </div>

          <div className="pd-topbar-right">
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
                  <div className="pd-greeting-badges" aria-label="Resumen de órdenes">
                    <div className="pd-greeting-count" aria-label={`${activeOrdersCount} órdenes activas`}>
                      <Icons.Package />
                      <strong>{activeOrdersCount.toLocaleString("es-DO")}</strong> Órdenes activas
                    </div>
                    <div className="pd-greeting-count pd-greeting-count--new" aria-label={`${newOrdersCount} órdenes nuevas sin revisar`}>
                      <Icons.Bell />
                      <strong>{newOrdersCount.toLocaleString("es-DO")}</strong> Nuevas
                    </div>
                    <div className="pd-greeting-count pd-greeting-count--edited" aria-label={`${editedOrdersCount} órdenes editadas`}>
                      <Icons.Edit />
                      <strong>{editedOrdersCount.toLocaleString("es-DO")}</strong> Editadas
                    </div>
                    <div className="pd-greeting-count pd-greeting-count--returned" aria-label={`${returnedBannerOrdersCount} órdenes devueltas`}>
                      <Icons.ArrowLeft />
                      <strong>{returnedBannerOrdersCount.toLocaleString("es-DO")}</strong> Devueltas
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
              
              <div className="pd-metrics">
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
                    <span className="pa-results-count">{orders.length} orden{orders.length !== 1 ? "es" : ""}</span>
                    <button className="pd-link-btn" onClick={() => setActiveTab("orders")}>
                      Ver todas <Icons.ArrowRight />
                    </button>
                  </div>
                </div>
                  <div className="ps-table-wrap">
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
                        {loading ? (
                          <tr>
                            <td colSpan={5} className="ps-table-empty">Cargando órdenes...</td>
                          </tr>
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
                                const count = getOrderFiles(order).length + (orderFiles?.[order.id]?.length || 0);
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
                                {getEditLabel(order) && <span className="acm-badge warning">{getEditLabel(order)}</span>}
                                <StatusBadge status={order.status} className="acm-badge" showDot={false} bordered order={order} />
                              </div>
                            </td>
                            <td className="td-pad td-actions" data-row-action>
                              <div className="table-actions acm-row-actions" data-row-action>
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
                        <strong>{orders.length}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "active" ? "active" : ""}
                        onClick={() => { setFilterArchive("active"); setPage(1); }}
                        aria-selected={filterArchive === "active"}
                      >
                        <Icons.Package />
                        <span>Activas</span>
                        <strong>{activeOrders.length}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "archived" ? "active" : ""}
                        onClick={() => { setFilterArchive("archived"); setPage(1); }}
                        aria-selected={filterArchive === "archived"}
                      >
                        <Icons.Archive />
                        <span>Archivadas</span>
                        <strong>{archivedOrders.length}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "cancelled" ? "active" : ""}
                        onClick={() => { setFilterArchive("cancelled"); setPage(1); }}
                        aria-selected={filterArchive === "cancelled"}
                      >
                        <Icons.Trash />
                        <span>Canceladas</span>
                        <strong>{cancelledOrders.length}</strong>
                      </button>
                      <button
                        type="button"
                        className={filterArchive === "returned" ? "active" : ""}
                        onClick={() => { setFilterArchive("returned"); setPage(1); }}
                        aria-selected={filterArchive === "returned"}
                      >
                        <Icons.ArrowLeft />
                        <span>Devueltas</span>
                        <strong>{returnedOrders.length}</strong>
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
                  <div className="ps-table-wrap">
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
                        {loading ? (
                          <tr>
                            <td colSpan={6} className="ps-table-empty">Cargando órdenes...</td>
                          </tr>
                        ) : filteredOrders.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="ps-table-empty">No hay órdenes que coincidan con los filtros.</td>
                          </tr>
                        ) : (
                          paginatedOrders.map(order => {
                            const fileCount = getOrderFiles(order).length + (orderFiles?.[order.id]?.length || 0);
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
                                      {getEditLabel(order) && <span className="acm-badge warning">{getEditLabel(order)}</span>}
                                    </span>
                                  </span>
                                </div>
                              </td>
                              <td className="td-pad">
                                {order.order_type === "orden 911" ? <span className="acm-badge danger">911</span> : <span className="acm-badge neutral">Normal</span>}
                              </td>
                              <td className="td-pad"><StatusBadge status={order.status} className="acm-badge" showDot={false} bordered order={order} /></td>
                              <td className="td-pad"><span className="ps-date-badge">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></td>
                              <td className="td-pad">
                                {fileCount > 0
                                  ? <span className="acm-badge info">{fileCount} {fileCount === 1 ? "Archivo" : "Archivos"}</span>
                                  : <span className="acm-badge neutral">Sin archivos</span>}
                              </td>
                              <td className="td-pad td-actions" data-row-action>
                                <div className="table-actions" data-row-action>
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
                  <div className="ps-cards-grid">
                    {paginatedOrders.map(order => {
                      const fileCount = getOrderFiles(order).length + (orderFiles?.[order.id]?.length || 0);
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
                <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
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


      <OrderDetailModal 
        open={!!selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
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
      />
      <ReturnToCashierModal
        open={!!returningToCashier}
        handoff={returningToCashier}
        order={selectedOrder}
        onClose={() => setReturningToCashier(null)}
        onConfirm={handleReturnToCashier}
        loading={returningToCashierLoading}
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
