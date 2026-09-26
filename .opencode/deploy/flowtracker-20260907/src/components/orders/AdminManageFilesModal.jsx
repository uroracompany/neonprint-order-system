import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { ORDER_STATUS, PAYMENT_STATUS, PRODUCTION_AREA_LABELS, PRODUCTION_FILE_STATUS, PRODUCTION_FILE_STATUS_LABELS, getFileNameFromUrl } from "../../utils/constants";
import { buildStorageSafeFileName, formatFileSize, getOrderAssetLimit, uploadOrderAsset, validateOrderAssetSize } from "../../utils/uploadOrderAsset";
import { compressImage, REF_IMAGE_CONFIG } from "../../utils/imageValidation";
import { getReferenceImages } from "../../utils/orderAssets";
import FileUploadZone from "../ui/FileUploadZone";
import { SecureImage, SecureImageLink } from "../ui/SecureImage";
import { ProductionFileSpecifications } from "./CreateOrderModal";
import { buildProductionCatalogs } from "../../utils/production";
import "./AdminManageFilesModal.css";

const getUserDisplayName = (profile) => {
  if (!profile) return "Usuario eliminado";
  const label = profile.name || profile.email || "Usuario eliminado";
  return profile.deleted_at || profile.employment_status === false ? `${label} — dado de baja` : label;
};

const FILE_STATUS_TRANSITIONS = {
  [PRODUCTION_FILE_STATUS.PENDING]: [PRODUCTION_FILE_STATUS.IN_PRODUCTION],
  [PRODUCTION_FILE_STATUS.IN_PRODUCTION]: [PRODUCTION_FILE_STATUS.IN_TERMINATION],
  [PRODUCTION_FILE_STATUS.IN_TERMINATION]: [PRODUCTION_FILE_STATUS.IN_PRODUCTION, PRODUCTION_FILE_STATUS.COMPLETED],
  [PRODUCTION_FILE_STATUS.COMPLETED]: [PRODUCTION_FILE_STATUS.IN_TERMINATION],
};

const getAllowedFileStatuses = (currentStatus) => [currentStatus, ...(FILE_STATUS_TRANSITIONS[currentStatus] || [])]
  .filter((status, index, statuses) => status && statuses.indexOf(status) === index)
  .map((value) => ({ value, label: PRODUCTION_FILE_STATUS_LABELS[value] || value }));

const PAYMENT_LOCKED_STATUS = ORDER_STATUS.IN_QUOTE;

export default function AdminManageFilesModal({
  open,
  order,
  profiles = [],
  onClose,
  onRefreshActions,
  capabilities = null,
  nextSafeStep = "",
}) {
  const [productionFiles, setProductionFiles] = useState([]);
  const [allProductionAreas, setAllProductionAreas] = useState([]);
  const [productionUsers, setProductionUsers] = useState([]);
  const [fileStatusChanges, setFileStatusChanges] = useState({});
  const [fileDeliveryIds, setFileDeliveryIds] = useState({});
  const [savingFileStatus, setSavingFileStatus] = useState(false);
  const [fileAreaChanges, setFileAreaChanges] = useState({});
  const [fileAreaReasons, setFileAreaReasons] = useState({});
  const [savingFileArea, setSavingFileArea] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [newFileLabel, setNewFileLabel] = useState("");
  const [newFileAreaCode, setNewFileAreaCode] = useState("");
  const [newFileMaterials, setNewFileMaterials] = useState([]);
  const [newFileTermination, setNewFileTermination] = useState("");
  const [productionCatalog, setProductionCatalog] = useState({ materials: {}, terminations: {} });
  const [addingFile, setAddingFile] = useState(false);
  const [showAddFileForm, setShowAddFileForm] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [savingPreview, setSavingPreview] = useState(false);
  const [previewSaved, setPreviewSaved] = useState(false);
  const [refFilesToAdd, setRefFilesToAdd] = useState([]);
  const [refUrlsToRemove, setRefUrlsToRemove] = useState([]);
  const [savingRefs, setSavingRefs] = useState(false);
  const [refsSaved, setRefsSaved] = useState(false);
  const [error, setError] = useState("");
  const [orderUpdatedAt, setOrderUpdatedAt] = useState(order?.updated_at || null);
  const [assetMetadata, setAssetMetadata] = useState(() => ({
    preview_image: order?.preview_image || null,
    reference_images: order?.reference_images || [],
  }));
  const hydratedAssetVersionRef = useRef(null);

  useEffect(() => {
    if (!open || !order?.id) {
      hydratedAssetVersionRef.current = null;
      return;
    }

    const sourceVersion = `${order.id}:${order.updated_at || ""}`;
    setError("");
    if (hydratedAssetVersionRef.current !== sourceVersion) {
      hydratedAssetVersionRef.current = sourceVersion;
      setOrderUpdatedAt(order.updated_at || null);
      setAssetMetadata({
        preview_image: order.preview_image || null,
        reference_images: order.reference_images || [],
      });
    }
    let active = true;
    (async () => {
      const catalogsRequest = Promise.all([
        supabase.from("materials").select("name,production_area_code").not("production_area_code", "is", null),
        supabase.from("production_terminations").select("name,production_area_code"),
      ]);
      const { data, error: fetchError } = await supabase
        .from("orders")
        .select("order_production_files(*)")
        .eq("id", order.id)
        .single();
      if (!active) return;
      if (fetchError || !data?.order_production_files) {
        setProductionFiles([]);
      } else {
        setProductionFiles(Array.isArray(data.order_production_files) ? data.order_production_files : []);
      }
      const { data: areaData } = await supabase
        .from("production_areas")
        .select("code,producer_role,label")
        .eq("is_active", true);
      if (!active) return;
      setAllProductionAreas(areaData || []);
      const [materialsResult, terminationsResult] = await catalogsRequest;
      if (active) setProductionCatalog(buildProductionCatalogs(materialsResult.data || [], terminationsResult.data || []));
      const roles = [...new Set((areaData || []).map((a) => a.producer_role).filter(Boolean))];
      if (roles.length === 0) { setProductionUsers([]); return; }
      const { data: userData } = await supabase
        .from("profiles")
        .select("id,name,email,role,employment_status,deleted_at")
        .in("role", roles)
        .eq("employment_status", true)
        .is("deleted_at", null);
      if (!active) return;
      setProductionUsers(userData || []);
    })();
    return () => { active = false; };
  }, [open, order?.id, order?.updated_at, order?.preview_image, order?.reference_images]);

  const isPaymentLocked = order?.status === PAYMENT_LOCKED_STATUS && order?.payment_status === PAYMENT_STATUS.PAID;
  const isInQuoteOrLater = order?.status && !["Pending", "in_Design", "cancelled"].includes(order.status);
  const orderDesignType = order?.order_design_type || order?.design_type;
  const supportsCapability = (capability) => !Array.isArray(capabilities) || capabilities.includes(capability);
  const canManageOrderAssets = supportsCapability("manage_design_assets") && (
    (orderDesignType === "INTERNAL_DESING" && order?.status === ORDER_STATUS.IN_DESIGN)
    || (orderDesignType === "EXTERNAL_DESING" && order?.status === ORDER_STATUS.PENDING)
  );
  const canManageProductionFiles = supportsCapability("manage_production_files")
    && [ORDER_STATUS.IN_PRODUCTION, ORDER_STATUS.IN_TERMINATION].includes(order?.status);
  const canReassignProductionFileArea = supportsCapability("reassign_production_file_area")
    && [ORDER_STATUS.PENDING, ORDER_STATUS.IN_DESIGN, ORDER_STATUS.IN_QUOTE, ORDER_STATUS.IN_PRODUCTION, ORDER_STATUS.IN_TERMINATION].includes(order?.status);
  const assetWorkflowMessage = orderDesignType === "INTERNAL_DESING"
    ? "Para modificar archivos, devuelve la orden a Caja y luego a Diseño desde Configuración avanzada."
    : "Para modificar archivos, devuelve la orden a Caja y luego a Ventas desde Configuración avanzada.";
  const existingRefUrls = useMemo(
    () => getReferenceImages({ reference_images: assetMetadata.reference_images }),
    [assetMetadata.reference_images],
  );
  const currentPreviewUrl = useMemo(() => {
    if (previewFile) return URL.createObjectURL(previewFile);
    return assetMetadata.preview_image || null;
  }, [previewFile, assetMetadata.preview_image]);
  const hasPreviewChanges = previewFile !== null;
  const deliveryUsers = useMemo(() => profiles.filter((p) => p.role === "delivery" && p.employment_status === true && !p.deleted_at), [profiles]);
  const productionUsersByRole = useMemo(
    () => productionUsers.filter((u) => u.employment_status !== false && !u.deleted_at).reduce((acc, u) => { (acc[u.role] = acc[u.role] || []).push(u); return acc; }, {}),
    [productionUsers],
  );

  useEffect(() => {
    return () => { if (currentPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(currentPreviewUrl); };
  }, [currentPreviewUrl]);

  if (!open || !order) return null;

  const handleSaveFileStatus = async (fileId, newStatus) => {
    setSavingFileStatus(true);
    setError("");
    try {
      const file = productionFiles.find((f) => f.id === fileId);
      if (!file) throw new Error("Archivo no encontrado.");
      const { data: updatedFile, error: rpcError } = await supabase.rpc("admin_update_production_file_status", {
        p_file_id: fileId,
        p_next_status: newStatus,
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
      if (!change.assignedUserId) throw new Error("Selecciona un nuevo responsable activo para el área destino.");
      const reasonDetail = (fileAreaReasons[fileId] || "").trim();
      if (reasonDetail.length < 10) throw new Error("Explica el motivo del cambio de área con al menos 10 caracteres.");
      const { data: updatedFile, error: rpcError } = await supabase.rpc("admin_reassign_file_production_area", {
        p_file_id: fileId,
        p_new_area_code: change.areaCode,
        p_new_assigned_user_id: change.assignedUserId,
        p_expected_updated_at: file.updated_at,
        p_reason_category: "assignment_correction",
        p_reason_detail: reasonDetail,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!updatedFile) throw new Error("No se recibio el archivo actualizado.");
      setProductionFiles((prev) => prev.map((f) => f.id === fileId ? { ...f, ...updatedFile } : f));
      setFileAreaChanges((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
      setFileAreaReasons((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
    } catch (err) {
      setError(err.message || "Error al cambiar el area del archivo.");
    } finally {
      setSavingFileArea(false);
    }
  };

  const handleAddFile = async () => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    if (!newFile) return setError("Selecciona un archivo.");
    if (!newFileLabel.trim()) return setError("Ingresa una etiqueta para el archivo.");
    if (!newFileAreaCode) return setError("Selecciona un area de produccion.");
    if (!newFileMaterials.length || !newFileTermination.trim()) return setError("Agrega materiales y una terminación para el archivo.");
    setAddingFile(true);
    setError("");
    try {
      const safeName = buildStorageSafeFileName(newFile);
      const fileName = `${Date.now()}-${safeName}`;
      const path = `orders/${order.id}/files/${fileName}`;
      const publicUrl = await uploadOrderAsset({ bucket: "order-docs", path, file: newFile });
      if (!publicUrl) throw new Error("Error al subir el archivo.");
      const { data: attached, error: insertError } = await supabase.rpc("admin_add_production_file_with_specifications", {
        p_order_id: order.id,
        p_url: publicUrl,
        p_filename: newFile.name,
        p_public_label: newFileLabel.trim(),
        p_area_code: newFileAreaCode,
        p_material_names: newFileMaterials,
        p_termination_name: newFileTermination.trim(),
        p_expected_updated_at: orderUpdatedAt,
      });
      // The object was uploaded but could not be attached.  Do not give the
      // browser deletion authority: the server-side reconciler will queue an
      // unreferenced managed object after its grace period.
      if (insertError) {
        throw new Error(insertError.message);
      }
      if (attached?.order_updated_at) setOrderUpdatedAt(attached.order_updated_at);
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
      setNewFileMaterials([]);
      setNewFileTermination("");
    } catch (err) {
      setError(err.message || "Error al anadir el archivo.");
    } finally {
      setAddingFile(false);
    }
  };

  const handleDeleteFile = async (file) => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    const reason = window.prompt(`Motivo para retirar "${file.public_label || file.filename || "sin nombre"}" (mínimo 10 caracteres):`);
    if (reason === null) return;
    if (reason.trim().length < 10) return setError("Explica el motivo con al menos 10 caracteres.");
    setError("");
    try {
      const { error: deleteError } = await supabase.rpc("admin_remove_production_file", {
        p_file_id: file.id,
        p_reason_detail: reason.trim(),
        p_expected_updated_at: file.updated_at,
      });
      if (deleteError) throw new Error(deleteError.message);
      setProductionFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err) {
      setError(err.message || "Error al eliminar el archivo.");
    }
  };

  const handlePreviewSelect = (files) => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    const file = Array.from(files)[0];
    if (!file) return;
    const sizeError = validateOrderAssetSize({ bucket: "order-previews", file });
    if (sizeError) { setError(sizeError); return; }
    setPreviewFile(file);
    setError("");
    setPreviewSaved(false);
  };

  const handleRemovePreview = () => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    setPreviewFile(null);
  };

  const handleSavePreview = async () => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    if (!previewFile) return setError("Selecciona un archivo.");
    setSavingPreview(true);
    setError("");
    try {
      const safeName = buildStorageSafeFileName(previewFile);
      const fileName = `${Date.now()}-${safeName}`;
      const path = `orders/${order.id}/preview/${fileName}`;
      const publicUrl = await uploadOrderAsset({ bucket: "order-previews", path, file: previewFile });
      if (!publicUrl) throw new Error("Error al subir la imagen.");
      const { data: updatedOrder, error: updateError } = await supabase.rpc("admin_update_order_asset_metadata", {
        p_order_id: order.id,
        p_expected_updated_at: orderUpdatedAt,
        p_changes: { preview_image: publicUrl },
      });
      if (updateError) throw new Error(updateError.message);
      if (!updatedOrder) throw new Error("No se recibio la orden actualizada.");
      setOrderUpdatedAt(updatedOrder.updated_at);
      setAssetMetadata({
        preview_image: updatedOrder.preview_image || null,
        reference_images: updatedOrder.reference_images || [],
      });
      setPreviewFile(null);
      setPreviewSaved(true);
      if (onRefreshActions) onRefreshActions();
    } catch (err) {
      setError(err.message || "Error al guardar la imagen de trabajo.");
    } finally {
      setSavingPreview(false);
    }
  };

  const handleRefFilesAccepted = (files) => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    const remainingExisting = existingRefUrls.length - refUrlsToRemove.length;
    const maxNew = REF_IMAGE_CONFIG.MAX_COUNT - remainingExisting;
    if (files.length > maxNew) {
      setError(`Solo se permiten hasta ${REF_IMAGE_CONFIG.MAX_COUNT} imagenes de referencia en total.`);
      return;
    }
    setRefFilesToAdd((prev) => [...prev, ...Array.from(files)]);
    setError("");
    setRefsSaved(false);
  };

  const handleRemoveRefUrl = (url) => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
    setRefUrlsToRemove((prev) => [...prev, url]);
  };

  const handleUndoRemoveRefUrl = (url) => {
    setRefUrlsToRemove((prev) => prev.filter((u) => u !== url));
  };

  const handleRemoveRefFile = (index) => {
    setRefFilesToAdd((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveRefImages = async () => {
    if (!canManageOrderAssets) return setError(assetWorkflowMessage);
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
      const { data: updatedOrder, error: updateError } = await supabase.rpc("admin_update_order_asset_metadata", {
        p_order_id: order.id,
        p_expected_updated_at: orderUpdatedAt,
        p_changes: { reference_images: allUrls },
      });
      if (updateError) throw new Error(updateError.message);
      if (!updatedOrder) throw new Error("No se recibio la orden actualizada.");
      setOrderUpdatedAt(updatedOrder.updated_at);
      setAssetMetadata({
        preview_image: updatedOrder.preview_image || null,
        reference_images: updatedOrder.reference_images || [],
      });
      setRefFilesToAdd([]);
      setRefUrlsToRemove([]);
      setRefsSaved(true);
    } catch (err) {
      setError(err.message || "Error al guardar las imagenes de referencia.");
    } finally {
      setSavingRefs(false);
    }
  };

  return (
    <div className="amfm-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="amfm-modal" role="dialog" aria-modal="true" aria-labelledby="amfm-title">
        <header className="amfm-header">
          <div>
            <h2 id="amfm-title">Gestionar archivos</h2>
            <p>Orden #{order?.order_number || order?.order_code || order?.id?.slice(0, 8).toUpperCase()}</p>
          </div>
          <button className="amfm-close-button" type="button" onClick={onClose} aria-label="Cerrar">
            <Icons.Close />
          </button>
        </header>

        <div className="amfm-body">
          {isPaymentLocked && (
            <div className="amfm-notice">No se pueden modificar archivos porque el pago esta completo.</div>
          )}
          {!canManageOrderAssets && !canManageProductionFiles && !canReassignProductionFileArea && (
            <div className="amfm-notice">{nextSafeStep || assetWorkflowMessage}</div>
          )}
          {previewSaved && (
            <div className="amfm-success">Imagen de orden de trabajo guardada correctamente.</div>
          )}
          {refsSaved && (
            <div className="amfm-success">Imagenes de referencia guardadas correctamente.</div>
          )}

          {!isPaymentLocked && canManageOrderAssets && !showAddFileForm && (
            <button type="button" className="amfm-button primary amfm-add-file-btn" onClick={() => setShowAddFileForm(true)}>
              <Icons.Plus /> Anadir archivo
            </button>
          )}

          {canManageOrderAssets && showAddFileForm && (
            <div className="amfm-add-file-form">
              <label className="amfm-field">
                <span>Archivo</span>
                <input type="file" onChange={(e) => setNewFile(e.target.files[0])} />
              </label>
              <label className="amfm-field">
                <span>Etiqueta</span>
                <input type="text" value={newFileLabel} onChange={(e) => setNewFileLabel(e.target.value)} placeholder="Nombre visible del archivo" />
              </label>
              <ProductionFileSpecifications
                areaCode={newFileAreaCode}
                materialNames={newFileMaterials}
                terminationName={newFileTermination}
                catalog={productionCatalog}
                onAreaChange={setNewFileAreaCode}
                onMaterialsChange={setNewFileMaterials}
                onTerminationChange={setNewFileTermination}
              />
              <div className="amfm-add-file-actions">
                <button type="button" className="amfm-button" onClick={() => { setShowAddFileForm(false); setNewFile(null); setNewFileLabel(""); setNewFileAreaCode(""); setNewFileMaterials([]); setNewFileTermination(""); }}>
                  Cancelar
                </button>
                <button type="button" className="amfm-button primary" disabled={addingFile} onClick={handleAddFile}>
                  {addingFile ? "Subiendo..." : "Anadir archivo"}
                </button>
              </div>
            </div>
          )}

          {productionFiles.length === 0 ? (
            <div className="amfm-empty">No hay archivos de produccion disponibles.</div>
          ) : (
            <div className="amfm-file-section">
              {productionFiles.map((file) => {
                const selectedNextStatus = fileStatusChanges[file.id] || file.status;
                const pendingStatus = fileStatusChanges[file.id];
                const completingLastFile = pendingStatus === PRODUCTION_FILE_STATUS.COMPLETED
                  && productionFiles.every((item) => item.id === file.id || item.status === PRODUCTION_FILE_STATUS.COMPLETED);
                const areaChange = fileAreaChanges[file.id] || {};
                const selectedAreaCode = areaChange.areaCode || "";
                const selectedArea = allProductionAreas.find((a) => a.code === selectedAreaCode);
                const newAreaRole = selectedArea?.producer_role;
                const availableUsers = newAreaRole ? productionUsersByRole[newAreaRole] || [] : [];
                const needsReassign = selectedAreaCode && selectedAreaCode !== file.production_area_code;
                const canSaveArea = needsReassign && areaChange.assignedUserId && (fileAreaReasons[file.id] || "").trim().length >= 10;
                return (
                  <div key={file.id} className="amfm-file-card">
                    <div className="amfm-file-card-header">
                      <span className="amfm-file-label">
                        <strong>{file.public_label || file.filename || "Archivo"}</strong>
                        <small>{PRODUCTION_AREA_LABELS[file.production_area_code] || file.production_area_code}</small>
                        {file.material_names?.length > 0 && <small>Materiales: {file.material_names.join(", ")}</small>}
                        {file.termination_name && <small>Terminación: {file.termination_name}</small>}
                        <small className="amfm-file-status-badge">{PRODUCTION_FILE_STATUS_LABELS[file.status]}</small>
                      </span>
                      {!isPaymentLocked && canManageOrderAssets && !(productionFiles.length <= 1 && isInQuoteOrLater) && (
                        <button type="button" className="amfm-delete-file-btn" onClick={() => handleDeleteFile(file)} title="Eliminar archivo">
                          <Icons.Trash />
                        </button>
                      )}
                    </div>
                    {canReassignProductionFileArea && file.status !== PRODUCTION_FILE_STATUS.COMPLETED && <div className="amfm-file-change-area">
                      <label className="amfm-field">
                        <span>Nueva area</span>
                        <div className="amfm-select-wrap">
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
                            <option value="">Mantener area actual</option>
                            {allProductionAreas.filter((a) => a.code !== file.production_area_code).map((a) => (
                              <option key={a.code} value={a.code}>{a.label || a.code}</option>
                            ))}
                          </select>
                          <Icons.ChevronDown />
                        </div>
                      </label>
                      {needsReassign && (
                        <>
                          <label className="amfm-field">
                            <span>Nuevo responsable (obligatorio)</span>
                            <div className="amfm-select-wrap">
                              <select
                                value={areaChange.assignedUserId || ""}
                                onChange={(e) => setFileAreaChanges((prev) => ({ ...prev, [file.id]: { ...prev[file.id], assignedUserId: e.target.value } }))}
                                disabled={savingFileArea}
                              >
                                <option value="">Seleccionar responsable del area</option>
                                {availableUsers.map((u) => <option key={u.id} value={u.id}>{getUserDisplayName(u)}</option>)}
                              </select>
                              <Icons.ChevronDown />
                            </div>
                          </label>
                          <label className="amfm-field">
                            <span>Motivo del cambio de área</span>
                            <textarea rows={2} value={fileAreaReasons[file.id] || ""} onChange={(e) => setFileAreaReasons((prev) => ({ ...prev, [file.id]: e.target.value.slice(0, 500) }))} placeholder="Explica el cambio (mínimo 10 caracteres)" disabled={savingFileArea} />
                          </label>
                        </>
                      )}
                      {canSaveArea && (
                        <button type="button" className="amfm-button primary amfm-file-save-btn" disabled={savingFileArea} onClick={() => handleSaveFileArea(file.id)}>
                          {savingFileArea ? "Guardando..." : "Guardar cambio de area"}
                        </button>
                      )}
                    </div>}
                    {canManageProductionFiles && <div className="amfm-file-change-status">
                      <label className="amfm-field">
                        <span>Cambiar estado</span>
                        <div className="amfm-select-wrap">
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
                            {getAllowedFileStatuses(file.status).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                          <Icons.ChevronDown />
                        </div>
                      </label>
                      {completingLastFile && (
                        <label className="amfm-field">
                          <span>Delivery para completar la orden (obligatorio)</span>
                          <div className="amfm-select-wrap">
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
                          className="amfm-button primary amfm-file-save-btn"
                          disabled={savingFileStatus || (completingLastFile && !fileDeliveryIds[file.id])}
                          onClick={() => handleSaveFileStatus(file.id, pendingStatus)}
                        >
                          {savingFileStatus ? "Guardando..." : "Guardar estado"}
                        </button>
                      )}
                    </div>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="amfm-preview-section">
            <h4>Imagen de la Orden de Trabajo</h4>
            {currentPreviewUrl ? (
              <div className="amfm-preview-container">
                {previewFile ? (
                  <img src={currentPreviewUrl} alt="Preview" className="amfm-preview-image" />
                ) : assetMetadata.preview_image ? (
                  <SecureImageLink
                    url={assetMetadata.preview_image}
                    fileName={getFileNameFromUrl(assetMetadata.preview_image)}
                  >
                    {(resolvedUrl) => <img src={resolvedUrl} alt="Preview" className="amfm-preview-image" />}
                  </SecureImageLink>
                ) : (
                  <img src={currentPreviewUrl} alt="Preview" className="amfm-preview-image" />
                )}
                {previewFile && <span className="amfm-preview-badge">Nuevo</span>}
                <div className="amfm-preview-overlay">
                  {!previewFile && assetMetadata.preview_image ? (
                    <SecureImageLink
                      url={assetMetadata.preview_image}
                      fileName={getFileNameFromUrl(assetMetadata.preview_image)}
                      className="amfm-preview-action"
                      title="Ver imagen"
                    >
                      <Icons.Eye />
                    </SecureImageLink>
                  ) : (
                    <a href={currentPreviewUrl} target="_blank" rel="noopener noreferrer" className="amfm-preview-action" title="Ver imagen">
                      <Icons.Eye />
                    </a>
                  )}
                  {!isPaymentLocked && canManageOrderAssets && (
                    <>
                      <FileUploadZone mode="image" replaceMode className="file-upload-zone--hidden-picker" buttonLabel="Cambiar" onFilesAccepted={handlePreviewSelect} />
                      <button type="button" className="amfm-preview-action" onClick={() => { const input = document.querySelector('.file-upload-zone--hidden-picker input[type="file"]'); if (input) input.click(); }} title="Cambiar imagen">
                        <Icons.Edit />
                      </button>
                      {!(assetMetadata.preview_image && isInQuoteOrLater) && (
                        <button type="button" className="amfm-preview-action remove" onClick={handleRemovePreview} title="Quitar imagen">
                          <Icons.Trash />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!isPaymentLocked && canManageOrderAssets && hasPreviewChanges && (
                  <button type="button" className="amfm-button primary amfm-preview-save-btn" disabled={savingPreview} onClick={handleSavePreview}>
                    {savingPreview ? "Guardando..." : "Guardar imagen de trabajo"}
                  </button>
                )}
              </div>
            ) : !isPaymentLocked && canManageOrderAssets ? (
              <FileUploadZone mode="image" replaceMode buttonLabel="Subir orden de trabajo" hint={`Max. ${formatFileSize(getOrderAssetLimit("order-previews"))}`} onFilesAccepted={handlePreviewSelect} />
            ) : (
              <div className="amfm-preview-empty">
                <Icons.Image />
                <span>Sin imagen de orden de trabajo</span>
              </div>
            )}
          </div>

          <div className="amfm-ref-section">
            <h4>Imagenes de Referencia {existingRefUrls.length > 0 && `(${existingRefUrls.length})`}</h4>
            {(existingRefUrls.length > 0 || refFilesToAdd.length > 0) && (
              <div className="amfm-ref-gallery">
                {existingRefUrls.filter((url) => !refUrlsToRemove.includes(url)).map((url, index) => (
                  <div className="amfm-ref-thumb" key={url}>
                    <SecureImage url={url} alt={`Referencia ${index + 1}`} />
                    {!isPaymentLocked && canManageOrderAssets && (
                      <button
                        type="button"
                        className="amfm-ref-thumb-remove"
                        onClick={() => handleRemoveRefUrl(url)}
                        aria-label={`Quitar imagen de referencia ${index + 1}`}
                        title="Quitar imagen"
                      >
                        <Icons.X />
                      </button>
                    )}
                  </div>
                ))}
                {refUrlsToRemove.map((url, i) => {
                  const origIndex = existingRefUrls.indexOf(url);
                  return (
                    <div key={`removed-${i}`} className="amfm-ref-thumb removed">
                      <SecureImage url={url} alt={`Ref a eliminar ${origIndex + 1}`} style={{ opacity: 0.4 }} />
                      <button type="button" className="amfm-ref-thumb-restore" onClick={() => handleUndoRemoveRefUrl(url)}>Restaurar</button>
                    </div>
                  );
                })}
                {refFilesToAdd.map((file, i) => {
                  const objectUrl = URL.createObjectURL(file);
                  return (
                    <div key={`new-${i}`} className="amfm-ref-thumb new">
                      <img src={objectUrl} alt={`Nueva ${i + 1}`} style={{ borderColor: "var(--cyan)" }} />
                      <button type="button" className="amfm-ref-thumb-remove" onClick={() => handleRemoveRefFile(i)} title="Quitar imagen">
                        <Icons.X />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {!isPaymentLocked && canManageOrderAssets && (
              <FileUploadZone mode="image" multiple maxFiles={REF_IMAGE_CONFIG.MAX_COUNT} existingCount={existingRefUrls.length - refUrlsToRemove.length} buttonLabel="Agregar imagenes de referencia" hint={`Maximo ${REF_IMAGE_CONFIG.MAX_COUNT} imagenes`} onFilesAccepted={handleRefFilesAccepted} />
            )}
            {canManageOrderAssets && (refFilesToAdd.length > 0 || refUrlsToRemove.length > 0) && (
              <button type="button" className="amfm-button primary amfm-ref-save-btn" disabled={savingRefs} onClick={handleSaveRefImages}>
                {savingRefs ? "Guardando..." : "Guardar imagenes de referencia"}
              </button>
            )}
          </div>

          {error && <div className="amfm-error"><Icons.AlertCircle />{error}</div>}
        </div>

        <footer className="amfm-footer">
          <span><Icons.Clock /> Cada cambio que realices quedará registrado en el historial de la orden.</span>
          <div>
            <button type="button" className="amfm-button" onClick={onClose}>Cerrar</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
