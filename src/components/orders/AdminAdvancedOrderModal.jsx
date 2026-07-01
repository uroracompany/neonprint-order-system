import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { PaymentBadge, StatusBadge } from "../ui/Badge";
import { ORDER_STATUS, PAYMENT_COLORS, PAYMENT_STATUS, PRODUCTION_AREAS, PRODUCTION_AREA_LABELS, PRODUCTION_FILE_STATUS, PRODUCTION_FILE_STATUS_LABELS } from "../../utils/constants";
import { getParticipatingProductionAreaCodes, buildProductionFileRows } from "../../utils/production";
import { validateReceiptFile } from "../../utils/receiptValidation";
import { buildPaymentReceiptPath, uploadOrderAsset, removeOrderAssetByPublicUrl, buildStorageSafeFileName, validateOrderAssetSize, formatFileSize, getOrderAssetLimit } from "../../utils/uploadOrderAsset";
import { compressImage, REF_IMAGE_CONFIG } from "../../utils/imageValidation";
import { getReferenceImages } from "../../utils/orderAssets";
import FileUploadZone from "../ui/FileUploadZone";
import PaymentFormModal from "../ui/PaymentFormModal";
import "./AdminAdvancedOrderModal.css";

const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";

const REASONS = [
  ["client_request", "Solicitud del cliente"],
  ["assignment_correction", "Corrección de responsable"],
  ["workflow_correction", "Corrección de flujo"],
  ["operational_priority", "Prioridad operativa"],
  ["other", "Otro"],
];

const ACTION_COPY = {
  route_quote: ["Enviar a Caja", "Mover la orden al flujo de caja", Icons.Money],
  set_quote_assignee: ["Gestionar usuario de Caja", "Asignar, cambiar o quitar responsable", Icons.Users],
  route_sales: ["Regresar orden a Ventas", "Elegir vendedor responsable", Icons.ArrowLeft],
  register_payment: ["Registrar pago", "Registrar o actualizar el pago de la orden", Icons.Receipt],
  route_production: ["Enviar a Producción", "Asignar responsables por área", Icons.Package],
  return_to_quote: ["Regresar a Caja", "Regresar la orden de Producción a Caja", Icons.ArrowLeft],
  reassign_production: ["Reasignar Producción", "Cambiar responsables de áreas de producción", Icons.Users],
  manage_files: ["Gestionar archivos", "Editar el estado de archivos de producción", Icons.File],
  mark_delivered: ["Marcar como entregado", "Pasar la orden a estado Entregado", Icons.CheckCircle],
  return_to_completed: ["Volver a Completado", "Regresar la orden de Entregado a Completado", Icons.ArrowLeft],
  route_design: ["Enviar a Diseño", "Mover la orden al flujo de diseño", Icons.Brush],
  set_designer_assignee: ["Gestionar diseñador", "Asignar, cambiar o quitar responsable de diseño", Icons.Users],
  return_to_design: ["Regresar a Diseño", "Regresar la orden de Caja a Diseño", Icons.ArrowLeft],
  assign_seller: ["Reasignar vendedor", "Cambiar el vendedor responsable", Icons.Users],
};

const getCompactPaymentLabel = (status) => {
  const label = (PAYMENT_COLORS[status] || PAYMENT_COLORS[PAYMENT_STATUS.PENDING]).label;
  return label.replace(/^Pago\s+/i, "");
};

function SelectField({ label, value, onChange, children, hint }) {
  return (
    <label className="aao-field">
      <span>{label}</span>
      <div className="aao-select-wrap">
        <select value={value} onChange={onChange}>{children}</select>
        <Icons.ChevronDown aria-hidden="true" />
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function AdminAdvancedOrderModal({
  open,
  order,
  profiles = [],
  onClose,
  onRunAction,
  loading = false,
  currentUserId = null,
}) {
  const [availability, setAvailability] = useState(null);
  const [loadingActions, setLoadingActions] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [reasonCategory, setReasonCategory] = useState("workflow_correction");
  const [reasonDetail, setReasonDetail] = useState("");
  const [error, setError] = useState("");
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [productionFiles, setProductionFiles] = useState([]);
  const [productionUsers, setProductionUsers] = useState([]);
  const [fileStatusChanges, setFileStatusChanges] = useState({});
  const [fileDeliveryIds, setFileDeliveryIds] = useState({});
  const [savingFileStatus, setSavingFileStatus] = useState(false);
  const [productionAssignments, setProductionAssignments] = useState({});
  const [fileAreaChanges, setFileAreaChanges] = useState({});
  const [allProductionAreas, setAllProductionAreas] = useState([]);
  const [savingFileArea, setSavingFileArea] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [newFileLabel, setNewFileLabel] = useState("");
  const [newFileAreaCode, setNewFileAreaCode] = useState("");
  const [addingFile, setAddingFile] = useState(false);
  const [showAddFileForm, setShowAddFileForm] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [savingPreview, setSavingPreview] = useState(false);
  const [previewSaved, setPreviewSaved] = useState(false);
  const [refFilesToAdd, setRefFilesToAdd] = useState([]);
  const [refUrlsToRemove, setRefUrlsToRemove] = useState([]);
  const [savingRefs, setSavingRefs] = useState(false);
  const [refsSaved, setRefsSaved] = useState(false);

  useEffect(() => {
    if (!open || !order?.id) return;
    let active = true;
    setActiveAction(null);
    setError("");
    setReasonDetail("");
    setLoadingActions(true);
    supabase.rpc("get_admin_order_actions", { p_order_id: order.id })
      .then(({ data, error: requestError }) => {
        if (!active) return;
        setAvailability(requestError ? null : data);
        setError(requestError?.message || "");
        setLoadingActions(false);
      });
    return () => { active = false; };
  }, [open, order?.id, order?.updated_at]);

  useEffect(() => {
    if (!open || !order?.id) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("order_production_files(*)")
        .eq("id", order.id)
        .single();
      if (!active) return;
      if (error || !data?.order_production_files) { setProductionFiles([]); }
      else {
        const files = Array.isArray(data.order_production_files) ? data.order_production_files : [];
        setProductionFiles(files);
      }
      const { data: areaData } = await supabase.from("production_areas").select("code,producer_role,label").eq("is_active", true);
      if (!active) return;
      setAllProductionAreas(areaData || []);
      const roles = [...new Set((areaData || []).map((a) => a.producer_role).filter(Boolean))];
      if (roles.length === 0) { setProductionUsers([]); return; }
      const { data: userData } = await supabase.from("profiles").select("id,name,email,role,employment_status").in("role", roles).eq("employment_status", true);
      if (!active) return;
      setProductionUsers(userData || []);
    })();
    return () => { active = false; };
  }, [open, order?.id]);

  const actionItems = availability?.actions || [];
  const orderNumber = order?.order_number || order?.order_code || order?.id?.slice(0, 8).toUpperCase();
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const quoteUsers = useMemo(() => profiles.filter((item) => item.role === "quote" && item.employment_status !== false), [profiles]);
  const sellerUsers = useMemo(() => profiles.filter((item) => item.role === "seller" && item.employment_status !== false), [profiles]);
  const designUsers = useMemo(() => profiles.filter((item) => item.role === "designer" && item.employment_status !== false), [profiles]);
  const deliveryUsers = useMemo(() => profiles.filter((item) => item.role === "delivery" && item.employment_status !== false), [profiles]);
  const currentUserProfile = useMemo(() => currentUserId ? profilesById.get(currentUserId) : null, [currentUserId, profilesById]);
  const extendedSellerUsers = useMemo(() => {
    if (!currentUserProfile) return sellerUsers;
    if (sellerUsers.some(u => u.id === currentUserId)) return sellerUsers;
    return [...sellerUsers, currentUserProfile];
  }, [sellerUsers, currentUserProfile, currentUserId]);
  const extendedDesignUsers = useMemo(() => {
    if (!currentUserProfile) return designUsers;
    if (designUsers.some(u => u.id === currentUserId)) return designUsers;
    return [...designUsers, currentUserProfile];
  }, [designUsers, currentUserProfile, currentUserId]);
  const isPaymentLocked = order?.status === ORDER_STATUS.IN_QUOTE && order?.payment_status === PAYMENT_STATUS.PAID;
  const isInQuoteOrLater = order?.status && !["Pending", "in_Design", "cancelled"].includes(order.status);
  const currentPreviewUrl = useMemo(() => {
    if (previewFile) return URL.createObjectURL(previewFile);
    return order?.preview_image || null;
  }, [previewFile, order?.preview_image]);
  const existingRefUrls = useMemo(() => getReferenceImages(order), [order]);
  const hasPreviewChanges = previewFile !== null;

  useEffect(() => {
    return () => { if (currentPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(currentPreviewUrl); };
  }, [currentPreviewUrl]);

  const quoteAssigneeName = order?.quote_id
    ? getUserDisplayName(profilesById.get(order.quote_id))
    : "Sin asignar";
  const productionUsersByRole = useMemo(
    () => productionUsers.reduce((acc, u) => { (acc[u.role] = acc[u.role] || []).push(u); return acc; }, {}),
    [productionUsers],
  );
  const productionAreas = useMemo(() => {
    const codes = getParticipatingProductionAreaCodes(productionFiles);
    const roles = PRODUCTION_AREAS;
    return roles.filter((a) => codes.includes(a.code));
  }, [productionFiles]);

  const selectedAction = activeAction ? ACTION_COPY[activeAction] : null;
  const SelectedActionIcon = selectedAction?.[2] || Icons.Settings;

  useEffect(() => {
    if (!activeAction || !order) return;
    if (activeAction === "set_quote_assignee") setTargetUserId(order.quote_id || "");
    else if (activeAction === "route_sales") setTargetUserId(order.seller_id || order.created_by || "");
    else if (activeAction === "route_design") setTargetUserId(order.designer_id || "");
    else if (activeAction === "set_designer_assignee") setTargetUserId(order.designer_id || "");
    else if (activeAction === "assign_seller") setTargetUserId(order.seller_id || order.created_by || "");
    else setTargetUserId("");
  }, [activeAction, order]);

  if (!open || !order) return null;

  const beginAction = (key) => {
    setError("");
    if (key === "register_payment") {
      setPaymentOrder(order);
      return;
    }
    if (key === "manage_files") {
      setFileStatusChanges({});
      setFileDeliveryIds({});
      setFileAreaChanges({});
      setPreviewSaved(false);
      setRefsSaved(false);
    }
    if (key === "reassign_production") {
      const current = {};
      productionFiles.forEach((f) => {
        if (f.production_area_code && f.assigned_to && !current[f.production_area_code]) {
          current[f.production_area_code] = f.assigned_to;
        }
      });
      setProductionAssignments(current);
    }
    setActiveAction(key);
  };

  const handlePaymentInAdvanced = async ({ paymentStatus, receiptFile }) => {
    if (!order) return;

    if (paymentStatus === PAYMENT_STATUS.PENDING && (order.status === ORDER_STATUS.IN_PRODUCTION || order.status === ORDER_STATUS.IN_TERMINATION || order.status === ORDER_STATUS.IN_COMPLETED || order.status === ORDER_STATUS.IN_DELIVERED)) {
      throw new Error("Una orden en Producción, Terminación, Completado o Entregado no puede volver a pago Pendiente.");
    }

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      setPaymentLoading(true);
      const { error: creditError } = await supabase.rpc("mark_order_as_credit", {
        p_order_id: order.id,
        p_due_date: null,
      });
      setPaymentLoading(false);
      if (creditError) throw new Error(creditError.message || "No se pudo aprobar el crédito.");
      setPaymentOrder(null);
      return;
    }

    setPaymentLoading(true);
    let paymentInvoiceUrl = null;

    if (receiptFile) {
      const validation = await validateReceiptFile(receiptFile);
      if (!validation.isValid) {
        setPaymentLoading(false);
        throw new Error(validation.error || "La imagen no es válida.");
      }
      try {
        const filePath = buildPaymentReceiptPath(order.id, receiptFile.name);
        const publicUrl = await uploadOrderAsset({
          bucket: "payment-invoice",
          path: filePath,
          file: receiptFile,
        });
        if (publicUrl) {
          paymentInvoiceUrl = publicUrl;
        } else {
          setPaymentLoading(false);
          throw new Error("Error al subir la imagen de pago.");
        }
      } catch (uploadError) {
        setPaymentLoading(false);
        throw new Error(uploadError?.message || "Error al subir la imagen de pago.");
      }
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        payment_status: paymentStatus,
        invoice_payment: paymentStatus === PAYMENT_STATUS.PARTIAL ? null : paymentInvoiceUrl,
      })
      .eq("id", order.id);

    setPaymentLoading(false);
    if (updateError) throw new Error("Error al actualizar el pago.");

    setPaymentOrder(null);
  };

  const submit = async () => {
    if (!reasonCategory) return setError("Selecciona una categoría del motivo.");
    if (reasonDetail.trim().length < 10) return setError("Explica el motivo con al menos 10 caracteres.");
    if ((activeAction === "route_sales" || activeAction === "assign_seller") && !targetUserId) return setError("Selecciona un usuario de Ventas.");
    if (activeAction === "reassign_production") {
      const unassigned = productionAreas.some((a) => !productionAssignments[a.code]);
      if (unassigned) return setError("Debes asignar un responsable para cada área participante.");
    }
    await onRunAction({
      action: activeAction,
      targetUserId: targetUserId || null,
      reasonCategory,
      reasonDetail: reasonDetail.trim(),
      expectedUpdatedAt: availability?.expected_updated_at || order.updated_at,
      areaAssignments: activeAction === "reassign_production" ? productionAssignments : undefined,
    });
  };

  const handleSaveFileStatus = async (fileId, newStatus) => {
    setSavingFileStatus(true);
    setError("");
    try {
      const file = productionFiles.find((f) => f.id === fileId);
      if (!file) throw new Error("Archivo no encontrado.");
      const { data: updatedFile, error: rpcError } = await supabase.rpc("admin_force_file_status", {
        p_file_id: fileId,
        p_new_status: newStatus,
        p_reason_category: "workflow_correction",
        p_reason_detail: "Cambio de estado por administrador desde Configuracion avanzada.",
        p_expected_updated_at: file.updated_at,
        p_delivery_id: fileDeliveryIds[fileId] || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!updatedFile) throw new Error("No se recibio el archivo actualizado.");
      setProductionFiles((prev) => prev.map((f) => f.id === fileId ? { ...f, ...updatedFile } : f));
      setFileStatusChanges((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
      setFileDeliveryIds((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
    } catch (err) {
      setError(err.message || "Error al actualizar el estado del archivo.");
    } finally {
      setSavingFileStatus(false);
    }
  };

  const handleSaveFileArea = async (fileId) => {
    const change = fileAreaChanges[fileId];
    if (!change?.areaCode) return;
    setSavingFileArea(true);
    setError("");
    try {
      const file = productionFiles.find((f) => f.id === fileId);
      if (!file) throw new Error("Archivo no encontrado.");
      if (file.assigned_to && !change.assignedUserId) {
        throw new Error("El archivo tiene un responsable asignado. Debes seleccionar un nuevo responsable.");
      }
      const { data: updatedFile, error: rpcError } = await supabase.rpc("admin_reassign_file_production_area", {
        p_file_id: fileId,
        p_new_area_code: change.areaCode,
        p_new_assigned_user_id: change.assignedUserId || null,
        p_expected_updated_at: file.updated_at,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!updatedFile) throw new Error("No se recibio el archivo actualizado.");
      setProductionFiles((prev) => prev.map((f) => f.id === fileId ? { ...f, ...updatedFile } : f));
      setFileAreaChanges((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
    } catch (err) {
      setError(err.message || "Error al cambiar el área del archivo.");
    } finally {
      setSavingFileArea(false);
    }
  };

  const handleAddFile = async () => {
    if (!newFile) return setError("Selecciona un archivo.");
    if (!newFileLabel.trim()) return setError("Ingresa una etiqueta para el archivo.");
    if (!newFileAreaCode) return setError("Selecciona un area de produccion.");
    setAddingFile(true);
    setError("");
    try {
      const safeName = buildStorageSafeFileName(newFile);
      const fileName = `${Date.now()}-${safeName}`;
      const path = `orders/${order.id}/files/${fileName}`;
      const publicUrl = await uploadOrderAsset({ bucket: "order-docs", path, file: newFile });
      if (!publicUrl) throw new Error("Error al subir el archivo.");
      const { data: { user } } = await supabase.auth.getUser();
      const rows = buildProductionFileRows({
        orderId: order.id,
        urls: [publicUrl],
        files: [newFile],
        areaCodes: [newFileAreaCode],
        publicLabels: [newFileLabel.trim()],
        userId: user?.id || null,
      });
      const { error: insertError } = await supabase.from("order_production_files").insert(rows);
      if (insertError) throw new Error(insertError.message);
      const existingUrls = JSON.parse(order.order_file_url || "[]");
      const { error: updateError } = await supabase.from("orders").update({
        order_file_url: JSON.stringify([...existingUrls, publicUrl]),
      }).eq("id", order.id);
      if (updateError) throw new Error(updateError.message);
      const { data: freshData } = await supabase
        .from("orders")
        .select("order_production_files(*)")
        .eq("id", order.id)
        .single();
      if (freshData?.order_production_files) {
        setProductionFiles(Array.isArray(freshData.order_production_files) ? freshData.order_production_files : []);
      }
      setShowAddFileForm(false);
      setNewFile(null);
      setNewFileLabel("");
      setNewFileAreaCode("");
    } catch (err) {
      setError(err.message || "Error al anadir el archivo.");
    } finally {
      setAddingFile(false);
    }
  };

  const handleDeleteFile = async (file) => {
    if (!window.confirm(`?Eliminar el archivo "${file.public_label || file.filename || "sin nombre"}"?`)) return;
    setError("");
    try {
      if (file.url) {
        await removeOrderAssetByPublicUrl({ bucket: "order-docs", url: file.url });
      }
      const { error: deleteError } = await supabase
        .from("order_production_files")
        .delete()
        .eq("id", file.id);
      if (deleteError) throw new Error(deleteError.message);
      const existingUrls = JSON.parse(order.order_file_url || "[]");
      const updatedUrls = Array.isArray(existingUrls) ? existingUrls.filter((u) => u !== file.url) : [];
      await supabase.from("orders").update({
        order_file_url: JSON.stringify(updatedUrls),
      }).eq("id", order.id);
      setProductionFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err) {
      setError(err.message || "Error al eliminar el archivo.");
    }
  };

  const handlePreviewSelect = (files) => {
    const file = Array.from(files)[0];
    if (!file) return;
    const sizeError = validateOrderAssetSize({ bucket: "order-previews", file });
    if (sizeError) { setError(sizeError); return; }
    setPreviewFile(file);
    setError("");
    setPreviewSaved(false);
  };

  const handleRemovePreview = () => {
    setPreviewFile(null);
  };

  const handleSavePreview = async () => {
    if (!previewFile) return setError("Selecciona un archivo.");
    setSavingPreview(true);
    setError("");
    try {
      const safeName = buildStorageSafeFileName(previewFile);
      const fileName = `${Date.now()}-${safeName}`;
      const path = `orders/${order.id}/preview/${fileName}`;
      const publicUrl = await uploadOrderAsset({ bucket: "order-previews", path, file: previewFile });
      if (!publicUrl) throw new Error("Error al subir la imagen.");
      const { error: updateError } = await supabase
        .from("orders")
        .update({ preview_image: publicUrl })
        .eq("id", order.id);
      if (updateError) throw new Error(updateError.message);
      setPreviewFile(null);
      setPreviewSaved(true);
      const { data } = await supabase.rpc("get_admin_order_actions", { p_order_id: order.id });
      if (data) setAvailability(data);
    } catch (err) {
      setError(err.message || "Error al guardar la imagen de trabajo.");
    } finally {
      setSavingPreview(false);
    }
  };

  const handleRefFilesAccepted = (files) => {
    const maxNew = REF_IMAGE_CONFIG.MAX_COUNT - (existingRefUrls.length - refUrlsToRemove.length);
    if (files.length > maxNew) {
      setError(`Solo se permiten hasta ${REF_IMAGE_CONFIG.MAX_COUNT} imagenes de referencia en total.`);
      return;
    }
    setRefFilesToAdd((prev) => [...prev, ...Array.from(files)]);
    setError("");
    setRefsSaved(false);
  };

  const handleRemoveRefUrl = (url) => {
    setRefUrlsToRemove((prev) => [...prev, url]);
  };

  const handleUndoRemoveRefUrl = (url) => {
    setRefUrlsToRemove((prev) => prev.filter((u) => u !== url));
  };

  const handleRemoveRefFile = (index) => {
    setRefFilesToAdd((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveRefImages = async () => {
    if (refFilesToAdd.length === 0 && refUrlsToRemove.length === 0) return;
    setSavingRefs(true);
    setError("");
    try {
      const uploadedUrls = [];
      for (const file of refFilesToAdd) {
        const compressed = await compressImage(file);
        const safeName = buildStorageSafeFileName(compressed);
        const fileName = `${Date.now()}-${safeName}`;
        const path = `orders/${order.id}/ref-images/${fileName}`;
        const publicUrl = await uploadOrderAsset({ bucket: "order-docs", path, file: compressed });
        if (publicUrl) uploadedUrls.push(publicUrl);
      }
      const remaining = existingRefUrls.filter((url) => !refUrlsToRemove.includes(url));
      const allUrls = [...remaining, ...uploadedUrls];
      const { error: updateError } = await supabase
        .from("orders")
        .update({ reference_images: allUrls })
        .eq("id", order.id);
      if (updateError) throw new Error(updateError.message);
      setRefFilesToAdd([]);
      setRefUrlsToRemove([]);
      setRefsSaved(true);
    } catch (err) {
      setError(err.message || "Error al guardar las imagenes de referencia.");
    } finally {
      setSavingRefs(false);
    }
  };

  const getAllFileStatuses = () => [
    { value: PRODUCTION_FILE_STATUS.PENDING, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.PENDING] },
    { value: PRODUCTION_FILE_STATUS.IN_PRODUCTION, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.IN_PRODUCTION] },
    { value: PRODUCTION_FILE_STATUS.IN_TERMINATION, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.IN_TERMINATION] },
    { value: PRODUCTION_FILE_STATUS.COMPLETED, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.COMPLETED] },
  ];

  return (
    <div className="aao-overlay" role="presentation">
      <section className="aao-modal" role="dialog" aria-modal="true" aria-labelledby="aao-title">
        <header className="aao-header">
          <div>
            <h2 id="aao-title">Configuración avanzada</h2>
            <p>Orden #{orderNumber}</p>
          </div>
          <button className="aao-icon-button" type="button" onClick={onClose} aria-label="Cerrar configuración">
            <Icons.Close />
          </button>
        </header>

        <div className="aao-summary-card" aria-label="Resumen de la orden">
          <div className="aao-summary-item">
            <span className="aao-summary-icon"><Icons.File /></span>
            <span className="aao-summary-copy">
              <strong>{order?.order_design_type === "INTERNAL_DESING" ? "Diseño interno" : "Diseño externo"}</strong>
              <small>Tipo de diseño</small>
            </span>
          </div>
          <div className="aao-summary-item">
            <span className="aao-summary-copy">
              <StatusBadge status={order.status} className="ps-badge" bordered />
              <small>Estado actual</small>
            </span>
          </div>
          <div className="aao-summary-item">
            <span className="aao-summary-icon"><Icons.User /></span>
            <span className="aao-summary-copy">
              <strong>{order.client_name || "Sin cliente"}</strong>
              <small>Cliente</small>
            </span>
          </div>
          <div className="aao-summary-item">
            <span className="aao-summary-icon"><Icons.User /></span>
            <span className="aao-summary-copy">
              <strong>{quoteAssigneeName}</strong>
              <small>Usuario de Caja</small>
            </span>
          </div>
        </div>

        {!activeAction ? (
          <div className="aao-body">
            <div className="aao-section-heading">
              <div><h3>Acciones disponibles</h3></div>
            </div>
            {loadingActions ? (
              <div className="aao-empty">Cargando acciones disponibles…</div>
            ) : actionItems.length === 0 ? (
              <div className="aao-empty">No hay ajustes avanzados disponibles en esta etapa.</div>
            ) : (
              <div className="aao-action-list">
                {actionItems.map((item) => {
                  const [title, description, Icon] = ACTION_COPY[item.key] || [item.label, "", Icons.Settings];
                  return (
                    <button key={item.key} type="button" className={`aao-action is-${item.key}`} onClick={() => beginAction(item.key)}>
                      <span className={`aao-action-icon is-${item.key}`}><Icon /></span>
                      <span className="aao-action-copy"><strong>{title}</strong><small>{description}</small></span>
                      {item.key === "register_payment" && (
                        <span className="aao-action-status">
                          {getCompactPaymentLabel(order.payment_status)}
                        </span>
                      )}
                      <Icons.ChevronRight />
                    </button>
                  );
                })}
              </div>
            )}
            {error && <div className="aao-error"><Icons.AlertCircle />{error}</div>}
          </div>
        ) : (
          <div className="aao-body">
            <button className="aao-back" type="button" onClick={async () => { setActiveAction(null); setError(""); if (order?.id) { const { data } = await supabase.rpc("get_admin_order_actions", { p_order_id: order.id }); if (data) setAvailability(data); } }}>
              <Icons.ArrowLeft /> Volver a las acciones
            </button>
            <div className="aao-form-title">
              <span className={`aao-action-icon is-${activeAction}`}><SelectedActionIcon /></span>
              <div><h3>{selectedAction?.[0]}</h3><p>{selectedAction?.[1]}</p></div>
            </div>

            {activeAction === "route_quote" && (
              <SelectField label="Usuario de Caja (opcional)" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} hint="Sin asignar, la orden queda bajo control de Administración.">
                <option value="">Sin asignar — Administración</option>
                {quoteUsers.map((item) => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}
              </SelectField>
            )}
            {activeAction === "set_quote_assignee" && (
              <SelectField label="Responsable de Caja" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} hint="Puedes quitar la asignación sin sacar la orden de Caja.">
                <option value="">Sin asignar — Administración</option>
                {quoteUsers.map((item) => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}
              </SelectField>
            )}
            {activeAction === "route_sales" && (
              <SelectField label="Usuario de Ventas" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}>
                <option value="">Seleccionar vendedor</option>
                {extendedSellerUsers.map((item) => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}
              </SelectField>
            )}
            {activeAction === "route_design" && (
              <SelectField label="Diseñador (opcional)" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} hint="Sin asignar, la orden queda bajo control de Administración.">
                <option value="">Sin asignar — Administración</option>
                {extendedDesignUsers.map((item) => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}
              </SelectField>
            )}
            {activeAction === "set_designer_assignee" && (
              <SelectField label="Responsable de Diseño" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} hint="Puedes quitar la asignación sin sacar la orden de Diseño.">
                <option value="">Sin asignar — Administración</option>
                {extendedDesignUsers.map((item) => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}
              </SelectField>
            )}
            {activeAction === "return_to_design" && (
              <p className="aao-hint">La orden regresará a Diseño preservando los archivos y el diseñador actual.</p>
            )}
            {activeAction === "assign_seller" && (
              <SelectField label="Nuevo vendedor" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}>
                <option value="">Seleccionar vendedor</option>
                {extendedSellerUsers.map((item) => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}
              </SelectField>
            )}

            {activeAction === "manage_files" && (
              <div className="aao-file-section">
                {isPaymentLocked && (
                  <div className="aao-notice">No se pueden modificar archivos porque el pago esta completo.</div>
                )}
                {previewSaved && (
                  <div className="aao-success">Imagen de orden de trabajo guardada correctamente.</div>
                )}
                {refsSaved && (
                  <div className="aao-success">Imagenes de referencia guardadas correctamente.</div>
                )}
                {!isPaymentLocked && !showAddFileForm && (
                  <button type="button" className="aao-button primary aao-add-file-btn" onClick={() => setShowAddFileForm(true)}>
                    <Icons.Plus /> Anadir archivo
                  </button>
                )}
                {showAddFileForm && (
                  <div className="aao-add-file-form">
                    <label className="aao-field">
                      <span>Archivo</span>
                      <input type="file" onChange={(e) => setNewFile(e.target.files[0])} />
                    </label>
                    <label className="aao-field">
                      <span>Etiqueta</span>
                      <input type="text" value={newFileLabel} onChange={(e) => setNewFileLabel(e.target.value)} placeholder="Nombre visible del archivo" />
                    </label>
                    <label className="aao-field">
                      <span>Area de produccion</span>
                      <div className="aao-select-wrap">
                        <select value={newFileAreaCode} onChange={(e) => setNewFileAreaCode(e.target.value)}>
                          <option value="">Seleccionar area</option>
                          {allProductionAreas.map((a) => (
                            <option key={a.code} value={a.code}>{a.label || a.code}</option>
                          ))}
                        </select>
                        <Icons.ChevronDown />
                      </div>
                    </label>
                    <div className="aao-add-file-actions">
                      <button type="button" className="aao-button secondary" onClick={() => { setShowAddFileForm(false); setNewFile(null); setNewFileLabel(""); setNewFileAreaCode(""); }}>
                        Cancelar
                      </button>
                      <button type="button" className="aao-button primary" disabled={addingFile} onClick={handleAddFile}>
                        {addingFile ? "Subiendo..." : "Anadir archivo"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Production Files */}
                {productionFiles.length === 0 ? (
                  <div className="aao-empty">No hay archivos de produccion disponibles.</div>
                ) : (
                  productionFiles.map((file) => {
                    const allStatuses = getAllFileStatuses();
                    const selectedNextStatus = fileStatusChanges[file.id] || file.status;
                    const pendingStatus = fileStatusChanges[file.id];
                    const completingLastFile = pendingStatus === PRODUCTION_FILE_STATUS.COMPLETED
                      && productionFiles.every((item) => item.id === file.id || item.status === PRODUCTION_FILE_STATUS.COMPLETED);
                    const areaChange = fileAreaChanges[file.id] || {};
                    const selectedAreaCode = areaChange.areaCode || "";
                    const selectedArea = allProductionAreas.find((a) => a.code === selectedAreaCode);
                    const newAreaRole = selectedArea?.producer_role;
                    const availableUsers = newAreaRole ? productionUsersByRole[newAreaRole] || [] : [];
                    const needsReassign = file.assigned_to && selectedAreaCode && selectedAreaCode !== file.production_area_code;
                    const canSaveArea = selectedAreaCode && selectedAreaCode !== file.production_area_code && (!needsReassign || areaChange.assignedUserId);
                    return (
                      <div key={file.id} className="aao-file-card">
                        <div className="aao-file-card-header">
                          <span className="aao-file-label">
                            <strong>{file.public_label || file.filename || "Archivo"}</strong>
                            <small>{PRODUCTION_AREA_LABELS[file.production_area_code] || file.production_area_code}</small>
                            <small className="aao-file-status-badge">{PRODUCTION_FILE_STATUS_LABELS[file.status]}</small>
                          </span>
                          {!isPaymentLocked && !(productionFiles.length <= 1 && isInQuoteOrLater) && (
                            <button type="button" className="aao-delete-file-btn" onClick={() => handleDeleteFile(file)} title="Eliminar archivo">
                              <Icons.Trash />
                            </button>
                          )}
                        </div>
                        <div className="aao-file-change-area">
                          <label className="aao-field">
                            <span>Nueva área</span>
                            <div className="aao-select-wrap">
                              <select
                                value={selectedAreaCode}
                                onChange={(e) => {
                                  const code = e.target.value;
                                  setFileAreaChanges((prev) => {
                                    const next = { ...prev };
                                    if (code && code !== file.production_area_code) {
                                      next[file.id] = { areaCode: code, assignedUserId: "" };
                                    } else {
                                      delete next[file.id];
                                    }
                                    return next;
                                  });
                                }}
                                disabled={savingFileArea}
                              >
                                <option value="">Mantener área actual</option>
                                {allProductionAreas.filter((a) => a.code !== file.production_area_code).map((a) => (
                                  <option key={a.code} value={a.code}>{a.label || a.code}</option>
                                ))}
                              </select>
                              <Icons.ChevronDown />
                            </div>
                          </label>
                          {needsReassign && (
                            <label className="aao-field">
                              <span>Nuevo responsable (obligatorio)</span>
                              <div className="aao-select-wrap">
                                <select
                                  value={areaChange.assignedUserId || ""}
                                  onChange={(e) => setFileAreaChanges((prev) => ({ ...prev, [file.id]: { ...prev[file.id], assignedUserId: e.target.value } }))}
                                  disabled={savingFileArea}
                                >
                                  <option value="">Seleccionar responsable del área</option>
                                  {availableUsers.map((u) => <option key={u.id} value={u.id}>{getUserDisplayName(u)}</option>)}
                                </select>
                                <Icons.ChevronDown />
                              </div>
                            </label>
                          )}
                          {canSaveArea && (
                            <button
                              type="button"
                              className="aao-button primary aao-file-save-btn"
                              disabled={savingFileArea}
                              onClick={() => handleSaveFileArea(file.id)}
                            >
                              {savingFileArea ? "Guardando..." : "Guardar cambio de área"}
                            </button>
                          )}
                        </div>
                        <div className="aao-file-change-status">
                          <label className="aao-field">
                            <span>Cambiar estado</span>
                            <div className="aao-select-wrap">
                              <select
                                value={selectedNextStatus}
                                onChange={(e) => {
                                  const nextStatus = e.target.value;
                                  if (nextStatus === file.status) {
                                    setFileStatusChanges((prev) => { const next = { ...prev }; delete next[file.id]; return next; });
                                  } else {
                                    setFileStatusChanges((prev) => ({ ...prev, [file.id]: nextStatus }));
                                  }
                                  if (nextStatus !== PRODUCTION_FILE_STATUS.COMPLETED) {
                                    setFileDeliveryIds((prev) => { const next = { ...prev }; delete next[file.id]; return next; });
                                  }
                                }}
                                disabled={savingFileStatus}
                              >
                                {allStatuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                              </select>
                              <Icons.ChevronDown />
                            </div>
                          </label>
                          {completingLastFile && (
                            <label className="aao-field">
                              <span>Delivery para completar la orden (obligatorio)</span>
                              <div className="aao-select-wrap">
                                <select
                                  value={fileDeliveryIds[file.id] || ""}
                                  onChange={(e) => setFileDeliveryIds((prev) => ({ ...prev, [file.id]: e.target.value }))}
                                  disabled={savingFileStatus}
                                >
                                  <option value="">Seleccionar Delivery</option>
                                  {deliveryUsers.map((user) => <option key={user.id} value={user.id}>{getUserDisplayName(user)}</option>)}
                                </select>
                                <Icons.ChevronDown />
                              </div>
                            </label>
                          )}
                          {pendingStatus && (
                            <button
                              type="button"
                              className="aao-button primary aao-file-save-btn"
                              disabled={savingFileStatus || (completingLastFile && !fileDeliveryIds[file.id])}
                              onClick={() => handleSaveFileStatus(file.id, pendingStatus)}
                            >
                              {savingFileStatus ? "Guardando..." : "Guardar estado"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Preview Image */}
                <div className="aao-preview-section">
                  <h4>Imagen de la Orden de Trabajo</h4>
                  {currentPreviewUrl ? (
                    <div className="aao-preview-container">
                      <img src={currentPreviewUrl} alt="Preview" className="aao-preview-image" />
                      {previewFile && <span className="aao-preview-badge">Nuevo</span>}
                      <div className="aao-preview-overlay">
                        <a href={currentPreviewUrl} target="_blank" rel="noopener noreferrer" className="aao-preview-action" title="Ver imagen">
                          <Icons.Eye />
                        </a>
                        {!isPaymentLocked && (
                          <>
                            <FileUploadZone mode="image" replaceMode className="file-upload-zone--hidden-picker" buttonLabel="Cambiar" onFilesAccepted={handlePreviewSelect} />
                            <button type="button" className="aao-preview-action" onClick={() => { const input = document.querySelector('.file-upload-zone--hidden-picker input[type="file"]'); if (input) input.click(); }} title="Cambiar imagen">
                              <Icons.Edit />
                            </button>
                            {!(order?.preview_image && isInQuoteOrLater) && (
                            <button type="button" className="aao-preview-action remove" onClick={handleRemovePreview} title="Quitar imagen">
                              <Icons.Trash />
                            </button>
                            )}
                          </>
                        )}
                      </div>
                      {!isPaymentLocked && hasPreviewChanges && (
                        <button type="button" className="aao-button primary aao-preview-save-btn" disabled={savingPreview} onClick={handleSavePreview}>
                          {savingPreview ? "Guardando..." : "Guardar imagen de trabajo"}
                        </button>
                      )}
                    </div>
                  ) : !isPaymentLocked ? (
                    <FileUploadZone mode="image" replaceMode buttonLabel="Subir orden de trabajo" hint={`Max. ${formatFileSize(getOrderAssetLimit("order-previews"))}`} onFilesAccepted={handlePreviewSelect} />
                  ) : (
                    <div className="aao-preview-empty">
                      <Icons.Image />
                      <span>Sin imagen de orden de trabajo</span>
                    </div>
                  )}
                </div>

                {/* Reference Images */}
                <div className="aao-ref-section">
                  <h4>Imagenes de Referencia {existingRefUrls.length > 0 && `(${existingRefUrls.length})`}</h4>
                  {(existingRefUrls.length > 0 || refFilesToAdd.length > 0) && (
                    <div className="aao-ref-gallery">
                      {existingRefUrls.filter((url) => !refUrlsToRemove.includes(url)).map((url, i) => (
                        <div key={i} className="aao-ref-thumb">
                          <img src={url} alt={`Ref ${i + 1}`} />
                          {!isPaymentLocked && (
                            <button type="button" className="aao-ref-thumb-remove" onClick={() => handleRemoveRefUrl(url)} title="Quitar imagen">
                              <Icons.X />
                            </button>
                          )}
                        </div>
                      ))}
                      {refUrlsToRemove.map((url, i) => {
                        const origIndex = existingRefUrls.indexOf(url);
                        return (
                          <div key={`removed-${i}`} className="aao-ref-thumb removed">
                            <img src={url} alt={`Ref a eliminar ${origIndex + 1}`} style={{ opacity: 0.4 }} />
                            <button type="button" className="aao-ref-thumb-restore" onClick={() => handleUndoRemoveRefUrl(url)}>Restaurar</button>
                          </div>
                        );
                      })}
                      {refFilesToAdd.map((file, i) => {
                        const objectUrl = URL.createObjectURL(file);
                        return (
                          <div key={`new-${i}`} className="aao-ref-thumb new">
                            <img src={objectUrl} alt={`Nueva ${i + 1}`} />
                            <button type="button" className="aao-ref-thumb-remove" onClick={() => handleRemoveRefFile(i)} title="Quitar imagen">
                              <Icons.X />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!isPaymentLocked && (
                    <FileUploadZone mode="image" multiple maxFiles={REF_IMAGE_CONFIG.MAX_COUNT} existingCount={existingRefUrls.length - refUrlsToRemove.length} buttonLabel="Agregar imagenes de referencia" hint={`Maximo ${REF_IMAGE_CONFIG.MAX_COUNT} imagenes`} onFilesAccepted={handleRefFilesAccepted} />
                  )}
                  {(refFilesToAdd.length > 0 || refUrlsToRemove.length > 0) && (
                    <button type="button" className="aao-button primary aao-ref-save-btn" disabled={savingRefs} onClick={handleSaveRefImages}>
                      {savingRefs ? "Guardando..." : "Guardar imagenes de referencia"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeAction === "reassign_production" && (
              <div className="aao-reassign-section">
                {productionAreas.length === 0 ? (
                  <div className="aao-empty">No hay áreas participantes en esta orden.</div>
                ) : (
                  productionAreas.map((area) => {
                    const options = productionUsersByRole[area.role] || [];
                    return (
                      <SelectField key={area.code} label={area.label} value={productionAssignments[area.code] || ""} onChange={(e) => setProductionAssignments((prev) => ({ ...prev, [area.code]: e.target.value }))}>
                        <option value="">Seleccionar responsable</option>
                        {options.map((u) => <option key={u.id} value={u.id}>{getUserDisplayName(u)}</option>)}
                      </SelectField>
                    );
                  })
                )}
              </div>
            )}

            {activeAction !== "manage_files" && (
            <div className="aao-reason-grid">
              <SelectField label="Motivo" value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)}>
                {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectField>
              <label className="aao-field">
                <span>Detalle</span>
                <textarea value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value.slice(0, 500))} placeholder="Explica brevemente por qué se realiza este cambio." rows={4} />
                <small className="aao-counter">{reasonDetail.length}/500</small>
              </label>
            </div>
            )}
            {error && <div className="aao-error"><Icons.AlertCircle />{error}</div>}
          </div>
        )}

        <footer className="aao-footer">
          <span><Icons.Clock /> Cada cambio que realices quedará registrado en el historial de la orden.</span>
          <div>
            <button type="button" className="aao-button secondary" onClick={activeAction ? () => setActiveAction(null) : onClose} disabled={loading}>{activeAction ? "Cancelar" : "Cerrar"}</button>
            {activeAction && activeAction !== "manage_files" && <button type="button" className="aao-button primary" onClick={submit} disabled={loading}>{loading ? "Guardando…" : "Confirmar cambio"}</button>}
          </div>
        </footer>
      </section>

      <PaymentFormModal
        open={!!paymentOrder}
        order={paymentOrder}
        loading={paymentLoading}
        onClose={() => setPaymentOrder(null)}
        onConfirm={handlePaymentInAdvanced}
      />
    </div>
  );
}
