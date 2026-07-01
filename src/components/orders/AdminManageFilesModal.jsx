import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { ORDER_STATUS, PAYMENT_STATUS, PRODUCTION_AREA_LABELS, PRODUCTION_FILE_STATUS, PRODUCTION_FILE_STATUS_LABELS } from "../../utils/constants";
import { buildProductionFileRows } from "../../utils/production";
import { buildStorageSafeFileName, formatFileSize, getOrderAssetLimit, removeOrderAssetByPublicUrl, uploadOrderAsset, validateOrderAssetSize } from "../../utils/uploadOrderAsset";
import { compressImage, REF_IMAGE_CONFIG } from "../../utils/imageValidation";
import { getReferenceImages } from "../../utils/orderAssets";
import FileUploadZone from "../ui/FileUploadZone";
import "./AdminManageFilesModal.css";

const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";

const getAllFileStatuses = () => [
  { value: PRODUCTION_FILE_STATUS.PENDING, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.PENDING] },
  { value: PRODUCTION_FILE_STATUS.IN_PRODUCTION, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.IN_PRODUCTION] },
  { value: PRODUCTION_FILE_STATUS.IN_TERMINATION, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.IN_TERMINATION] },
  { value: PRODUCTION_FILE_STATUS.COMPLETED, label: PRODUCTION_FILE_STATUS_LABELS[PRODUCTION_FILE_STATUS.COMPLETED] },
];

const PAYMENT_LOCKED_STATUS = ORDER_STATUS.IN_QUOTE;

export default function AdminManageFilesModal({
  open,
  order,
  profiles = [],
  onClose,
  onRefreshActions,
}) {
  const [productionFiles, setProductionFiles] = useState([]);
  const [allProductionAreas, setAllProductionAreas] = useState([]);
  const [productionUsers, setProductionUsers] = useState([]);
  const [fileStatusChanges, setFileStatusChanges] = useState({});
  const [fileDeliveryIds, setFileDeliveryIds] = useState({});
  const [savingFileStatus, setSavingFileStatus] = useState(false);
  const [fileAreaChanges, setFileAreaChanges] = useState({});
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !order?.id) return;
    setError("");
    let active = true;
    (async () => {
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
      const roles = [...new Set((areaData || []).map((a) => a.producer_role).filter(Boolean))];
      if (roles.length === 0) { setProductionUsers([]); return; }
      const { data: userData } = await supabase
        .from("profiles")
        .select("id,name,email,role,employment_status")
        .in("role", roles)
        .eq("employment_status", true);
      if (!active) return;
      setProductionUsers(userData || []);
    })();
    return () => { active = false; };
  }, [open, order?.id]);

  const isPaymentLocked = order?.status === PAYMENT_LOCKED_STATUS && order?.payment_status === PAYMENT_STATUS.PAID;
  const isInQuoteOrLater = order?.status && !["Pending", "in_Design", "cancelled"].includes(order.status);
  const existingRefUrls = useMemo(() => getReferenceImages(order), [order]);
  const currentPreviewUrl = useMemo(() => {
    if (previewFile) return URL.createObjectURL(previewFile);
    return order?.preview_image || null;
  }, [previewFile, order?.preview_image]);
  const hasPreviewChanges = previewFile !== null;
  const deliveryUsers = useMemo(() => profiles.filter((p) => p.role === "delivery" && p.employment_status !== false), [profiles]);
  const productionUsersByRole = useMemo(
    () => productionUsers.reduce((acc, u) => { (acc[u.role] = acc[u.role] || []).push(u); return acc; }, {}),
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
      setError(err.message || "Error al cambiar el area del archivo.");
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
      if (onRefreshActions) onRefreshActions();
    } catch (err) {
      setError(err.message || "Error al guardar la imagen de trabajo.");
    } finally {
      setSavingPreview(false);
    }
  };

  const handleRefFilesAccepted = (files) => {
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

  const allStatuses = getAllFileStatuses();

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
          {previewSaved && (
            <div className="amfm-success">Imagen de orden de trabajo guardada correctamente.</div>
          )}
          {refsSaved && (
            <div className="amfm-success">Imagenes de referencia guardadas correctamente.</div>
          )}

          {!isPaymentLocked && !showAddFileForm && (
            <button type="button" className="amfm-button primary amfm-add-file-btn" onClick={() => setShowAddFileForm(true)}>
              <Icons.Plus /> Anadir archivo
            </button>
          )}

          {showAddFileForm && (
            <div className="amfm-add-file-form">
              <label className="amfm-field">
                <span>Archivo</span>
                <input type="file" onChange={(e) => setNewFile(e.target.files[0])} />
              </label>
              <label className="amfm-field">
                <span>Etiqueta</span>
                <input type="text" value={newFileLabel} onChange={(e) => setNewFileLabel(e.target.value)} placeholder="Nombre visible del archivo" />
              </label>
              <label className="amfm-field">
                <span>Area de produccion</span>
                <div className="amfm-select-wrap">
                  <select value={newFileAreaCode} onChange={(e) => setNewFileAreaCode(e.target.value)}>
                    <option value="">Seleccionar area</option>
                    {allProductionAreas.map((a) => (
                      <option key={a.code} value={a.code}>{a.label || a.code}</option>
                    ))}
                  </select>
                  <Icons.ChevronDown />
                </div>
              </label>
              <div className="amfm-add-file-actions">
                <button type="button" className="amfm-button" onClick={() => { setShowAddFileForm(false); setNewFile(null); setNewFileLabel(""); setNewFileAreaCode(""); }}>
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
                const needsReassign = file.assigned_to && selectedAreaCode && selectedAreaCode !== file.production_area_code;
                const canSaveArea = selectedAreaCode && selectedAreaCode !== file.production_area_code && (!needsReassign || areaChange.assignedUserId);
                return (
                  <div key={file.id} className="amfm-file-card">
                    <div className="amfm-file-card-header">
                      <span className="amfm-file-label">
                        <strong>{file.public_label || file.filename || "Archivo"}</strong>
                        <small>{PRODUCTION_AREA_LABELS[file.production_area_code] || file.production_area_code}</small>
                        <small className="amfm-file-status-badge">{PRODUCTION_FILE_STATUS_LABELS[file.status]}</small>
                      </span>
                      {!isPaymentLocked && !(productionFiles.length <= 1 && isInQuoteOrLater) && (
                        <button type="button" className="amfm-delete-file-btn" onClick={() => handleDeleteFile(file)} title="Eliminar archivo">
                          <Icons.Trash />
                        </button>
                      )}
                    </div>
                    <div className="amfm-file-change-area">
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
                      )}
                      {canSaveArea && (
                        <button type="button" className="amfm-button primary amfm-file-save-btn" disabled={savingFileArea} onClick={() => handleSaveFileArea(file.id)}>
                          {savingFileArea ? "Guardando..." : "Guardar cambio de area"}
                        </button>
                      )}
                    </div>
                    <div className="amfm-file-change-status">
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
                            {allStatuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="amfm-preview-section">
            <h4>Imagen de la Orden de Trabajo</h4>
            {currentPreviewUrl ? (
              <div className="amfm-preview-container">
                <img src={currentPreviewUrl} alt="Preview" className="amfm-preview-image" />
                {previewFile && <span className="amfm-preview-badge">Nuevo</span>}
                <div className="amfm-preview-overlay">
                  <a href={currentPreviewUrl} target="_blank" rel="noopener noreferrer" className="amfm-preview-action" title="Ver imagen">
                    <Icons.Eye />
                  </a>
                  {!isPaymentLocked && (
                    <>
                      <FileUploadZone mode="image" replaceMode className="file-upload-zone--hidden-picker" buttonLabel="Cambiar" onFilesAccepted={handlePreviewSelect} />
                      <button type="button" className="amfm-preview-action" onClick={() => { const input = document.querySelector('.file-upload-zone--hidden-picker input[type="file"]'); if (input) input.click(); }} title="Cambiar imagen">
                        <Icons.Edit />
                      </button>
                      {!(order?.preview_image && isInQuoteOrLater) && (
                        <button type="button" className="amfm-preview-action remove" onClick={handleRemovePreview} title="Quitar imagen">
                          <Icons.Trash />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!isPaymentLocked && hasPreviewChanges && (
                  <button type="button" className="amfm-button primary amfm-preview-save-btn" disabled={savingPreview} onClick={handleSavePreview}>
                    {savingPreview ? "Guardando..." : "Guardar imagen de trabajo"}
                  </button>
                )}
              </div>
            ) : !isPaymentLocked ? (
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
                {existingRefUrls.filter((url) => !refUrlsToRemove.includes(url)).map((url, i) => (
                  <div key={i} className="amfm-ref-thumb">
                    <img src={url} alt={`Ref ${i + 1}`} />
                    {!isPaymentLocked && (
                      <button type="button" className="amfm-ref-thumb-remove" onClick={() => handleRemoveRefUrl(url)} title="Quitar imagen">
                        <Icons.X />
                      </button>
                    )}
                  </div>
                ))}
                {refUrlsToRemove.map((url, i) => {
                  const origIndex = existingRefUrls.indexOf(url);
                  return (
                    <div key={`removed-${i}`} className="amfm-ref-thumb removed">
                      <img src={url} alt={`Ref a eliminar ${origIndex + 1}`} style={{ opacity: 0.4 }} />
                      <button type="button" className="amfm-ref-thumb-restore" onClick={() => handleUndoRemoveRefUrl(url)}>Restaurar</button>
                    </div>
                  );
                })}
                {refFilesToAdd.map((file, i) => {
                  const objectUrl = URL.createObjectURL(file);
                  return (
                    <div key={`new-${i}`} className="amfm-ref-thumb new">
                      <img src={objectUrl} alt={`Nueva ${i + 1}`} />
                      <button type="button" className="amfm-ref-thumb-remove" onClick={() => handleRemoveRefFile(i)} title="Quitar imagen">
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
