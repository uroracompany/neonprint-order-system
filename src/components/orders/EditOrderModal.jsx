import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { ClientSelect } from "../ui/ClientCombobox";
import FileUploadZone from "../ui/FileUploadZone";
import FileCard from "../FileCard";
import { normalizeAssetUrls, serializeReferenceImages } from "../../utils/orderAssets";
import { buildProductionFileRows } from "../../utils/production";
import {
  buildStorageSafeFileName,
  formatFileSize,
  removeOrderAssetByPublicUrl,
  uploadOrderAsset,
} from "../../utils/uploadOrderAsset";
import {
  canDecodeAsImage,
  compressImage,
  REF_IMAGE_CONFIG,
  validateReferenceImages,
} from "../../utils/imageValidation";
import { formatDominicanPhone, getSelectedClientOrderFields } from "../../utils/clients";
import {
  Field,
  Modal,
  MultiMaterialSelector,
  PHONE_PLACEHOLDER,
  ProductionAreaSelect,
} from "./CreateOrderModal";

const isValidDominicanPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (normalized.length !== 10) return false;

  const areaCode = normalized.slice(0, 3);
  return ["809", "829", "849"].includes(areaCode);
};

export default function EditOrderModal({
  open,
  onClose,
  order,
  onUpdated,
  materialOptions = [],
  clients = [],
  clientsLoading = false,
  onClientSearch,
}) {
  const fileInputRef = useRef(null);
  const previewInputRef = useRef(null);
  const refImagesInputRef = useRef(null);

  const [form, setForm] = useState({
    client_id: null,
    client_name: "",
    client_contact: "",
    invoice_number: "",
    description: "",
    materials: [],
    termination_type: "",
    delivery_date: "",
  });
  const [existingFiles, setExistingFiles] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [newFileAreas, setNewFileAreas] = useState([]);
  const [newFileLabels, setNewFileLabels] = useState([]);
  const [existingPreview, setExistingPreview] = useState(null);
  const [newPreview, setNewPreview] = useState(null);
  const [existingRefImages, setExistingRefImages] = useState([]);
  const [newRefImages, setNewRefImages] = useState([]);
  const [removedRefImageUrls, setRemovedRefImageUrls] = useState([]);
  const [removedFileUrls, setRemovedFileUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [missingLabelIndices, setMissingLabelIndices] = useState([]);
  const [missingAreaIndices, setMissingAreaIndices] = useState([]);

  useEffect(() => {
    if (!order) return;

    setForm({
      client_id: order.client_id || null,
      client_name: order.client_name || "",
      client_contact: order.client_contact || "",
      invoice_number: order.invoice_number || "",
      description: order.description || "",
      materials: order.material ? order.material.split(", ").filter(Boolean) : [],
      termination_type: order.termination_type || "",
      delivery_date: order.delivery_date ? order.delivery_date.split("T")[0] : "",
    });

    setExistingFiles(normalizeAssetUrls(order.order_file_url));
    setExistingPreview(order.preview_image || null);
    setExistingRefImages(normalizeAssetUrls(order.reference_images));
    setNewFiles([]);
    setNewFileAreas([]);
    setNewFileLabels([]);
    setNewPreview(null);
    setNewRefImages([]);
    setRemovedRefImageUrls([]);
    setRemovedFileUrls([]);
    setFieldErrors({});
    setError("");
  }, [order]);

  const set = (key, value) => {
    setForm(previous => ({ ...previous, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };

  const applySelectedClient = (client) => {
    if (!client) {
      setForm(previous => ({ ...previous, ...getSelectedClientOrderFields(null, "client_contact") }));
      return;
    }

    const fields = getSelectedClientOrderFields(client, "client_contact");
    if (fields.client_contact) fields.client_contact = formatDominicanPhone(fields.client_contact);

    setForm(previous => ({ ...previous, ...fields }));
    setFieldErrors(previous => {
      const next = { ...previous };
      delete next.client_id;
      delete next.client_name;
      delete next.client_contact;
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};

    if (!form.client_id) {
      errors.client_id = "Debes seleccionar un cliente registrado.";
    }
    if (!form.client_name.trim()) {
      errors.client_name = "Selecciona un cliente registrado para completar el nombre.";
    }
    if (!form.client_contact.trim()) {
      errors.client_contact = "Selecciona un cliente registrado con telefono.";
    }
    if (!form.description.trim()) {
      errors.description = "La descripcion es requerida.";
    }
    if (newFiles.length > 0) {
      const missingAreas = newFileAreas
        .map((area, index) => (!area ? index : -1))
        .filter(index => index !== -1);
      const missingLabels = newFileLabels
        .map((label, index) => (!label?.trim() ? index : -1))
        .filter(index => index !== -1);

      setMissingAreaIndices(missingAreas);
      setMissingLabelIndices(missingLabels);

      const messages = [];
      if (missingAreas.length > 0) messages.push("un tipo de produccion");
      if (missingLabels.length > 0) messages.push("un nombre de representacion");
      if (messages.length > 0) {
        errors.order_files = `Cada archivo nuevo debe tener ${messages.join(" y ")}.`;
      }
    } else {
      setMissingAreaIndices([]);
      setMissingLabelIndices([]);
    }
    if (form.client_contact.trim() && !isValidDominicanPhone(form.client_contact)) {
      errors.client_contact = "El telefono debe ser un numero valido de Republica Dominicana (809, 829 o 849).";
    }

    return errors;
  };

  const handleRemoveExistingFile = (url) => {
    setRemovedFileUrls(previous => [...previous, url]);
    setExistingFiles(previous => previous.filter(file => file !== url));
  };

  const handleAddNewFiles = (filesOrEvent) => {
    const files = Array.from(filesOrEvent?.target?.files || filesOrEvent || []);
    if (!files.length) return;

    setNewFiles(previous => [...previous, ...files]);
    setNewFileAreas(previous => [...previous, ...files.map(() => "")]);
    setNewFileLabels(previous => [...previous, ...files.map(() => "")]);
    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };

  const handleRemoveNewFile = (index) => {
    setNewFiles(previous => previous.filter((_, currentIndex) => currentIndex !== index));
    setNewFileAreas(previous => previous.filter((_, currentIndex) => currentIndex !== index));
    setNewFileLabels(previous => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleRemoveExistingPreview = () => {
    if (existingPreview) {
      setRemovedFileUrls(previous => [...previous, existingPreview]);
    }
    setExistingPreview(null);
  };

  const handleAddNewPreview = (filesOrEvent) => {
    const file = Array.from(filesOrEvent?.target?.files || filesOrEvent || [])[0];
    if (!file) return;

    if (!REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES.includes(file.type)) {
      setFieldErrors(previous => ({ ...previous, design_preview: "Formato no soportado. Usa JPG, PNG, WebP, SVG o PDF." }));
      if (filesOrEvent?.target) filesOrEvent.target.value = "";
      return;
    }

    setFieldErrors(previous => ({ ...previous, design_preview: "" }));
    setNewPreview(file);
    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };

  const handleSubmit = async () => {
    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Por favor, corrige los errores en el formulario.");
      requestAnimationFrame(() => {
        const element = document.querySelector(".ps-field-error");
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setLoading(true);
    setError("");
    setFieldErrors({});
    setMissingLabelIndices([]);
    setMissingAreaIndices([]);

    let fileUrls = [...existingFiles];
    const newFileUrls = [];

    try {
      for (let index = 0; index < newFiles.length; index += 1) {
        const file = newFiles[index];
        const fileName = buildStorageSafeFileName(file, `${index}-`);
        const publicUrl = await uploadOrderAsset({
          bucket: "order-docs",
          path: `orders/${order.id}/files/${fileName}`,
          file,
        });

        if (publicUrl) {
          fileUrls.push(publicUrl);
          newFileUrls.push(publicUrl);
        }
      }
    } catch (uploadError) {
      setLoading(false);
      setError(uploadError?.message || "Error al subir los archivos de diseno.");
      return;
    }

    if (newFileUrls.length > 0) {
      const productionRows = buildProductionFileRows({
        orderId: order.id,
        urls: newFileUrls,
        files: newFiles,
        areaCodes: newFileAreas,
        publicLabels: newFileLabels,
        userId: order.seller_id || order.created_by,
      });

      const { error: productionFilesError } = await supabase
        .from("order_production_files")
        .insert(productionRows);

      if (productionFilesError) {
        setLoading(false);
        setError("No se pudo guardar la clasificacion de produccion de los archivos.");
        return;
      }
    }

    let previewUrl = existingPreview;
    if (newPreview) {
      try {
        const fileName = buildStorageSafeFileName(newPreview, "preview-");
        previewUrl = await uploadOrderAsset({
          bucket: "order-previews",
          path: `orders/${order.id}/preview/${fileName}`,
          file: newPreview,
        });
      } catch (uploadError) {
        setLoading(false);
        setError(uploadError?.message || "Error al subir el preview de la orden.");
        return;
      }
    } else if (!existingPreview) {
      previewUrl = null;
    }

    let refImageUrls = [...existingRefImages];
    if (newRefImages.length > 0) {
      const totalCount = existingRefImages.length + newRefImages.length;
      if (totalCount > REF_IMAGE_CONFIG.MAX_COUNT) {
        setLoading(false);
        setError(`Solo se permiten hasta ${REF_IMAGE_CONFIG.MAX_COUNT} imagenes de referencia por orden.`);
        return;
      }
      const validation = validateReferenceImages(newRefImages);
      if (!validation.valid) {
        setLoading(false);
        setError(validation.errors.join(". "));
        return;
      }
      try {
        for (let index = 0; index < newRefImages.length; index += 1) {
          const file = await compressImage(newRefImages[index]);
          const fileName = buildStorageSafeFileName(file, `ref-${index}-`);
          const publicUrl = await uploadOrderAsset({
            bucket: "order-docs",
            path: `orders/${order.id}/ref-images/${fileName}`,
            file,
          });
          if (publicUrl) refImageUrls.push(publicUrl);
        }
      } catch (uploadError) {
        setLoading(false);
        setError(uploadError?.message || "Error al subir las imagenes de referencia.");
        return;
      }
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        client_id: form.client_id,
        client_name: form.client_name.trim(),
        client_contact: form.client_contact.trim() || null,
        invoice_number: form.invoice_number.trim(),
        description: form.description.trim(),
        material: form.materials.join(", "),
        termination_type: form.termination_type.trim() || null,
        delivery_date: form.delivery_date || null,
        order_file_url: JSON.stringify(fileUrls),
        preview_image: previewUrl,
        reference_images: refImageUrls.length > 0 ? serializeReferenceImages(refImageUrls) : [],
      })
      .eq("id", order.id);

    if (updateError) {
      setLoading(false);
      setError(`Error al actualizar: ${updateError.message}`);
      return;
    }

    if (removedFileUrls.length > 0) {
      const { error: removeProductionFilesError } = await supabase
        .from("order_production_files")
        .delete()
        .eq("order_id", order.id)
        .in("url", removedFileUrls);

      if (removeProductionFilesError) {
        setLoading(false);
        setError("La orden se actualizo, pero no se pudieron retirar archivos de produccion.");
        return;
      }
    }

    await Promise.all([
      ...removedFileUrls.flatMap((url) => [
        removeOrderAssetByPublicUrl({ bucket: "order-docs", url }),
        removeOrderAssetByPublicUrl({ bucket: "order-previews", url }),
      ]),
      ...removedRefImageUrls.map((url) =>
        removeOrderAssetByPublicUrl({ bucket: "order-docs", url })
      ),
      !previewUrl && existingPreview
        ? removeOrderAssetByPublicUrl({ bucket: "order-previews", url: existingPreview })
        : Promise.resolve({ removed: false, error: null }),
    ]);

    setLoading(false);
    onUpdated?.();
    onClose();
  };

  const parseFileName = (url) => {
    if (!url) return "Archivo";
    const parts = url.split("/");
    const fileName = parts[parts.length - 1];
    const nameParts = fileName.split("-");
    nameParts.shift();
    nameParts.shift();
    nameParts.shift();
    return nameParts.join("-") || fileName;
  };

  return (
    <Modal open={open} onClose={onClose} title={`Editar Orden #${order?.id?.slice(0, 8).toUpperCase()}`}>
      {error && <div className="ps-form-error">{error}</div>}

      <div className="ps-form-section-title">
        <span className="ps-form-section-num">1</span> Datos del cliente
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Cliente registrado" required error={fieldErrors.client_id} hint="Selecciona el cliente registrado de esta orden.">
            <ClientSelect
              clients={clients}
              loading={clientsLoading}
              value={form.client_id}
              onSelect={applySelectedClient}
              onSearch={onClientSearch}
              placeholder="Seleccionar cliente registrado"
            />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Nombre del cliente" required error={fieldErrors.client_name}>
            <input className="ps-form-input" value={form.client_name} readOnly disabled />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Contacto" required hint="Se completa desde el cliente registrado." error={fieldErrors.client_contact}>
            <input className="ps-form-input" placeholder={PHONE_PLACEHOLDER} value={form.client_contact} readOnly disabled maxLength="12" />
          </Field>
        </div>
      </div>

      <div className="ps-form-section-title" style={{ marginTop: 20 }}>
        <span className="ps-form-section-num">2</span> Detalles de la orden
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Descripcion" required error={fieldErrors.description}>
            <textarea className="ps-form-input textarea" value={form.description} onChange={event => set("description", event.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Material" optional>
            <MultiMaterialSelector selected={form.materials} onChange={value => set("materials", value)} options={materialOptions} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Tipo de terminacion" optional>
            <input className="ps-form-input" value={form.termination_type} onChange={event => set("termination_type", event.target.value)} placeholder="Ej: Brillante, Mate, Con marco..." />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Fecha de entrega" optional>
            <div className="ps-input-icon-wrap">
              <span className="ps-input-icon"><Icons.Calendar /></span>
              <input className="ps-form-input with-icon" type="date" value={form.delivery_date} onChange={event => set("delivery_date", event.target.value)} />
            </div>
          </Field>
        </div>
      </div>

      <div className="ps-form-section-title" style={{ marginTop: 20 }}>
        <span className="ps-form-section-num">3</span> Archivos y Preview
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Archivos adjuntos" hint="Archivos de diseno existentes y nuevos" error={fieldErrors.order_files}>
            {existingFiles.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {existingFiles.map((url, index) => (
                  <FileCard
                    key={`${url}-${index}`}
                    name={parseFileName(url)}
                    url={url}
                    onRemove={() => handleRemoveExistingFile(url)}
                  />
                ))}
              </div>
            )}
            {newFiles.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {newFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className={missingLabelIndices.includes(index) || missingAreaIndices.includes(index) ? "ps-file-missing" : ""}>
                    <FileCard
                      name={file.name}
                      secondaryText={formatFileSize(file.size)}
                      onRemove={() => handleRemoveNewFile(index)}
                    >
                      <div className="production-file-meta ps-production-file-fields">
                        <label className="production-file-field">
                          <span className="production-file-field-label">Nombre visible en seguimiento</span>
                          <input
                            className={`ps-form-input${missingLabelIndices.includes(index) ? " ps-input-error" : ""}`}
                            value={newFileLabels[index] || ""}
                            onChange={(event) => {
                              setNewFileLabels(newFileLabels.map((label, currentIndex) => currentIndex === index ? event.target.value : label));
                              setMissingLabelIndices([]);
                              setFieldErrors(previous => ({ ...previous, order_files: "" }));
                            }}
                            placeholder="Ej: Banner principal"
                            aria-label={`Nombre visible en seguimiento de ${file.name}`}
                          />
                        </label>
                        <label className="production-file-field">
                          <span className="production-file-field-label">Area de produccion</span>
                          <ProductionAreaSelect
                            value={newFileAreas[index]}
                            isError={missingAreaIndices.includes(index)}
                            onChange={(value) => {
                              setNewFileAreas(newFileAreas.map((area, currentIndex) => currentIndex === index ? value : area));
                              setMissingAreaIndices([]);
                              setFieldErrors(previous => ({ ...previous, order_files: "" }));
                            }}
                          />
                        </label>
                      </div>
                    </FileCard>
                  </div>
                ))}
              </div>
            )}
            <FileUploadZone
              mode="attachment"
              multiple
              inputRef={fileInputRef}
              buttonLabel="Agregar archivos"
              hint="PDF, AI, PNG, JPG..."
              onFilesAccepted={handleAddNewFiles}
            />
          </Field>
        </div>

        <div className="col-full">
          <Field label="Imagen de preview" hint="Vista previa del diseno">
            {(existingPreview || newPreview) ? (
              <div className="ps-preview-showcase">
                <FileUploadZone
                  mode="image"
                  replaceMode
                  inputRef={previewInputRef}
                  className="file-upload-zone--hidden-picker"
                  buttonLabel="Cambiar imagen"
                  onFilesAccepted={handleAddNewPreview}
                />
                <div className="ps-preview-card">
                  <img
                    src={newPreview ? URL.createObjectURL(newPreview) : existingPreview}
                    alt="Preview"
                    className="ps-preview-img-main"
                  />
                  <div className="ps-preview-card-overlay">
                    <span className="ps-preview-card-label">
                      {newPreview ? "Nueva preview" : "Preview actual"}
                    </span>
                    <div className="ps-preview-card-actions">
                      <button className="ps-preview-change-btn" onClick={() => previewInputRef.current?.click()}>
                        {newPreview ? "Cancelar" : "Cambiar"}
                      </button>
                      <button className="ps-preview-del-btn" onClick={newPreview ? () => setNewPreview(null) : handleRemoveExistingPreview}>
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <FileUploadZone
                mode="image"
                replaceMode
                inputRef={previewInputRef}
                buttonLabel="Subir imagen de preview"
                hint="Imagen de la orden de trabajo (PNG, JPG...)"
                onFilesAccepted={handleAddNewPreview}
              />
            )}
          </Field>
        </div>

        <div className="col-full">
          <Field label="Imagenes de referencia" hint="Sube imagenes de referencia para la orden (opcional)">
            {existingRefImages.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {existingRefImages.map((url, index) => (
                  <div key={`${url}-${index}`} className="ps-file-item">
                    <img src={url} alt={parseFileName(url)} className="ps-ref-thumb" />
                    <span className="ps-file-name">{parseFileName(url)}</span>
                    <button className="ps-file-remove" onClick={() => {
                      setExistingRefImages(existingRefImages.filter((_, currentIndex) => currentIndex !== index));
                      setRemovedRefImageUrls([...removedRefImageUrls, url]);
                    }}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {newRefImages.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {newRefImages.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="ps-file-item" style={{ borderColor: "var(--cyan)", background: "rgba(6, 182, 212, 0.04)" }}>
                    <img src={URL.createObjectURL(file)} alt={file.name} className="ps-ref-thumb" style={{ borderColor: "var(--cyan)" }} />
                    <span className="ps-file-name">{file.name}</span>
                    <button className="ps-file-remove" onClick={() => setNewRefImages(newRefImages.filter((_, currentIndex) => currentIndex !== index))}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <FileUploadZone
              mode="image"
              multiple
              inputRef={refImagesInputRef}
              maxFiles={REF_IMAGE_CONFIG.MAX_COUNT}
              existingCount={existingRefImages.length + newRefImages.length}
              buttonLabel="Subir imagenes"
              hint="Imagenes de referencia (Max 3, 20MB c/u. Soporta JPG, PNG, WebP, GIF, HEIC y HEIF)"
              onFilesAccepted={async (rawFiles, { showError }) => {
                const validFiles = [];
                const errors = [];
                for (const file of rawFiles) {
                  const result = await canDecodeAsImage(file);
                  if (result.valid) {
                    validFiles.push(file);
                  } else {
                    errors.push(`"${file.name}": ${result.error}`);
                  }
                }
                if (errors.length > 0) {
                  showError(errors.join(". "));
                }
                if (validFiles.length > 0) {
                  setNewRefImages([...newRefImages, ...validFiles]);
                }
              }}
            />
          </Field>
        </div>
      </div>

      <div className="ps-form-actions">
        <button className="ps-btn-cancel" onClick={onClose}>Cancelar</button>
        <button className="ps-btn-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Guardando..." : "Guardar Cambios ->"}
        </button>
      </div>
    </Modal>
  );
}
