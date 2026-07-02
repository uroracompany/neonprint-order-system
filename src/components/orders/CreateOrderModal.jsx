import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { ClientSelect } from "../ui/ClientCombobox";
import FileUploadZone from "../ui/FileUploadZone";
import FileCard from "../FileCard";
import { ORDER_STATUS, PRODUCTION_AREAS } from "../../utils/constants";
import { serializeReferenceImages } from "../../utils/orderAssets";
import { buildProductionFileRows } from "../../utils/production";
import { buildStorageSafeFileName, formatFileSize, removeOrderAssetByPublicUrl, uploadOrderAsset } from "../../utils/uploadOrderAsset";
import { canDecodeAsImage, compressImage, REF_IMAGE_CONFIG, validateReferenceImages } from "../../utils/imageValidation";
import { formatDominicanPhone, getSelectedClientOrderFields } from "../../utils/clients";

export const PHONE_PLACEHOLDER = "Seleccionar Cliente";

const EMPTY_FORM = {
  design_file_areas: [],
  design_file_labels: [],
  client_id: null,
  client_name: "",
  client_phone: "",
  invoice_number: "",
  description: "",
  materials: [],
  termination_type: "",
  order_type: "",
  design_type: "",
  delivery_date: "",
  indefinido: false,
  design_files: [],
  design_preview: null,
  reference_images: [],
};

export function Modal({ open, onClose, title, children, wide, stickyHeader = false, className = "" }) {
  if (!open) return null;
  return (
    <div className="ps-modal-overlay">
      <div className={`ps-modal ${wide ? "wide" : "narrow"} ${className}`.trim()}>
        <div className="ps-modal-stripe" />
        <div className={`ps-modal-header ${stickyHeader ? "is-sticky" : ""}`}>
          <span className="ps-modal-title">{title}</span>
          <button className="ps-modal-close" onClick={onClose} aria-label="Cerrar modal"><Icons.Close /></button>
        </div>
        <div className="ps-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, required, optional, hint, error, children }) {
  return (
    <div className={`ps-field ${error ? "ps-field-error" : ""}`}>
      <label className="ps-label">
        {label}
        {required && <span className="ps-label-req">*</span>}
        {optional && <span className="ps-label-opt">(opcional)</span>}
      </label>
      {hint && <p className="ps-field-hint">{hint}</p>}
      <div className={`ps-field-input-wrapper ${error ? "has-error" : ""}`}>
        {children}
      </div>
      {error && <p className="ps-field-error-message">{error}</p>}
    </div>
  );
}

export function ProductionAreaSelect({ value, onChange, className = "ps-form-input", isError }) {
  return (
    <select className={`${className}${isError ? " ps-input-error" : ""}`} value={value || ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">Tipo de produccion</option>
      {PRODUCTION_AREAS.map((area) => (
        <option key={area.code} value={area.code}>{area.label}</option>
      ))}
    </select>
  );
}

export function MultiMaterialSelector({ selected = [], onChange, options = [] }) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const ref = useRef(null);
  const customInputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setCustomMode(false);
        setCustomValue("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (mat) => {
    onChange(selected.includes(mat) ? selected.filter(m => m !== mat) : [...selected, mat]);
  };
  const remove = (mat) => onChange(selected.filter(m => m !== mat));

  const handleAddCustom = () => {
    const val = customValue.trim();
    if (val && !selected.includes(val)) {
      onChange([...selected, val]);
    }
    setCustomValue("");
    setCustomMode(false);
  };

  const handleCustomKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddCustom();
    }
    if (e.key === "Escape") {
      setCustomMode(false);
      setCustomValue("");
    }
  };

  useEffect(() => {
    if (customMode && customInputRef.current) customInputRef.current.focus();
  }, [customMode]);

  const isCustomMaterial = (mat) => !options.includes(mat);

  return (
    <div className="ps-multimat" ref={ref}>
      <div className={`ps-multimat-box ${open ? "focused" : ""}`} onClick={() => setOpen(p => !p)}>
        {selected.length === 0
          ? <span className="ps-multimat-placeholder">Seleccionar materiales...</span>
          : selected.map(m => (
            <span key={m} className={`ps-chip ${isCustomMaterial(m) ? "ps-chip--custom" : ""}`}>
              {isCustomMaterial(m) && <span className="ps-chip-custom-icon"><Icons.Plus /></span>}
              {m}
              <button className="ps-chip-remove" onClick={e => { e.stopPropagation(); remove(m); }}><Icons.X /></button>
            </span>
          ))
        }
        <span className="ps-multimat-arrow"><Icons.ChevronDown /></span>
      </div>

      {open && (
        <div className="ps-multimat-dropdown">
          {!customMode ? (
            <div className="ps-multimat-option ps-multimat-add" onClick={() => setCustomMode(true)}>
              <span className="ps-multimat-add-icon"><Icons.Plus /></span>
              Agregar material personalizado
            </div>
          ) : (
            <div className="ps-multimat-custom-form">
              <input
                ref={customInputRef}
                className="ps-multimat-custom-input"
                placeholder="Escribe el nombre del material..."
                value={customValue}
                onChange={e => setCustomValue(e.target.value)}
                onKeyDown={handleCustomKeyDown}
              />
              <button className="ps-multimat-custom-btn" onClick={handleAddCustom} disabled={!customValue.trim()}>
                Agregar
              </button>
            </div>
          )}

          <div className="ps-multimat-divider" />

          {options.map(mat => (
            <div key={mat} className={`ps-multimat-option ${selected.includes(mat) ? "selected" : ""}`} onClick={() => toggle(mat)}>
              <span className="ps-multimat-check">{selected.includes(mat) ? "✓" : ""}</span>
              {mat}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const isValidDominicanPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (normalized.length !== 10) return false;

  const areaCode = normalized.slice(0, 3);
  return ["809", "829", "849"].includes(areaCode);
};

const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms)
  );
  return Promise.race([promise, timeout]);
};

export default function CreateOrderModal({
  open,
  onClose,
  onCreated,
  userId,
  materialOptions,
  clients = [],
  clientsLoading = false,
  onClientSearch,
  onAddNewClient,
  clientToSelect = null,
  onClientToSelectConsumed,
}) {
  const fileInputRef = useRef(null);
  const previewInputRef = useRef(null);
  const refImagesInputRef = useRef(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [missingLabelIndices, setMissingLabelIndices] = useState([]);
  const [missingAreaIndices, setMissingAreaIndices] = useState([]);

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

  const applySelectedClient = useCallback((client) => {
    if (!client) {
      setForm(previous => ({ ...previous, ...getSelectedClientOrderFields(null) }));
      return;
    }

    const fields = getSelectedClientOrderFields(client, "client_phone");
    if (fields.client_phone) fields.client_phone = formatDominicanPhone(fields.client_phone);

    setForm(previous => ({ ...previous, ...fields }));
    setFieldErrors(previous => {
      const next = { ...previous };
      delete next.client_name;
      delete next.client_phone;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open || !clientToSelect?.id) return;
    applySelectedClient(clientToSelect);
    onClientToSelectConsumed?.();
  }, [applySelectedClient, clientToSelect, onClientToSelectConsumed, open]);

  const validateForm = () => {
    const errors = {};

    if (!form.client_id) {
      errors.client_id = "Debes seleccionar un cliente registrado.";
    }
    if (!form.client_name.trim()) {
      errors.client_name = "Selecciona un cliente registrado para completar el nombre.";
    }
    if (!form.client_phone.trim()) {
      errors.client_phone = "Selecciona un cliente registrado con telefono.";
    }
    if (!form.description.trim()) {
      errors.description = "La descripción del trabajo es requerida.";
    }
    if (form.materials.length === 0) {
      errors.materials = "Selecciona al menos un material.";
    }
    if (!form.order_type) {
      errors.order_type = "Selecciona el tipo de orden.";
    }
    if (!form.design_type) {
      errors.design_type = "Indica si el diseño es interno o externo.";
    }
    if (!form.invoice_number.trim()) {
      errors.invoice_number = "El número de facturación es requerido.";
    }
    if (form.client_phone.trim() && !isValidDominicanPhone(form.client_phone)) {
      errors.client_phone = "El teléfono debe ser un número válido de República Dominicana (809, 829 o 849).";
    }
    if (!form.indefinido && !form.delivery_date) {
      errors.delivery_date = "Selecciona una fecha de entrega o marca 'Por definir'.";
    }
    if (form.design_type === "EXTERNAL_DESING" && form.design_files.length === 0) {
      errors.design_files = "Debe subir al menos un archivo de diseño.";
    }
    if (form.design_type === "EXTERNAL_DESING" && form.design_files.length > 0) {
      const missingAreas = form.design_file_areas
        .map((area, index) => (!area ? index : -1))
        .filter(index => index !== -1);
      const missingLabels = form.design_file_labels
        .map((label, index) => (!label?.trim() ? index : -1))
        .filter(index => index !== -1);

      setMissingAreaIndices(missingAreas);
      setMissingLabelIndices(missingLabels);

      const messages = [];
      if (missingAreas.length > 0) messages.push("un tipo de producción");
      if (missingLabels.length > 0) messages.push("un nombre de representación");
      if (messages.length > 0) {
        errors.design_files = `Cada archivo debe tener ${messages.join(" y ")}.`;
      }
    } else {
      setMissingAreaIndices([]);
      setMissingLabelIndices([]);
    }
    if (form.design_type === "EXTERNAL_DESING" && !form.design_preview) {
      errors.design_preview = "Debe agregar una imagen de la orden de trabajo.";
    }

    return errors;
  };

  const handleSubmit = async () => {
    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Por favor, corrige los errores en el formulario.");
      requestAnimationFrame(() => {
        const el = document.querySelector(".ps-field-error");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setLoading(true);
    setError("");
    setFieldErrors({});
    setMissingLabelIndices([]);
    setMissingAreaIndices([]);

    try {
      await withTimeout((async () => {
        const nextIndefinido = form.indefinido || !form.delivery_date;
        const orderId = crypto.randomUUID();

        let fileUrls = [];
        let previewUrl = null;
        let refImageUrls = [];
        const uploadedUrls = [];
        const cleanupUploadedUrls = () => Promise.all(
          uploadedUrls.map(({ bucket, url }) => removeOrderAssetByPublicUrl({ bucket, url }))
        );

        if (form.design_files.length > 0 || form.design_preview || form.reference_images.length > 0) {
          try {
            for (let i = 0; i < form.design_files.length; i += 1) {
              const file = form.design_files[i];
              const fileName = buildStorageSafeFileName(file, `${i}-`);
              const publicUrl = await uploadOrderAsset({
                bucket: "order-docs",
                path: `orders/${orderId}/files/${fileName}`,
                file,
              });

              if (publicUrl) {
                fileUrls.push(publicUrl);
                uploadedUrls.push({ bucket: "order-docs", url: publicUrl });
              }
            }
          } catch {
            await cleanupUploadedUrls();
            throw new Error("Error al subir los archivos. Verifica que no sean demasiado grandes y que tu conexión esté estable.");
          }

          if (form.design_preview) {
            try {
              const fileName = buildStorageSafeFileName(form.design_preview, "preview-");
              previewUrl = await uploadOrderAsset({
                bucket: "order-previews",
                path: `orders/${orderId}/preview/${fileName}`,
                file: form.design_preview,
              });
              if (previewUrl) uploadedUrls.push({ bucket: "order-previews", url: previewUrl });
            } catch (err) {
              console.error("Preview upload failed:", err);
              await cleanupUploadedUrls();
              const message = err?.message || "";
              if (/mime type/i.test(message)) {
                throw new Error("Formato de imagen no soportado para la previsualización. Usa JPG, PNG, WebP, SVG o PDF.");
              }
              if (/size|grande|large/i.test(message)) {
                throw new Error("La imagen de previsualización es demasiado grande. Máximo 10MB.");
              }
              throw new Error("Error al subir la imagen de previsualización. Verifica el formato y el tamaño.");
            }
          }

          if (form.reference_images.length > 0) {
            try {
              const validation = validateReferenceImages(form.reference_images);
              if (!validation.valid) {
                throw new Error(validation.errors.join(". "));
              }
              for (let i = 0; i < form.reference_images.length; i += 1) {
                const file = await compressImage(form.reference_images[i]);
                const fileName = buildStorageSafeFileName(file, `ref-${i}-`);
                const publicUrl = await uploadOrderAsset({
                  bucket: "order-docs",
                  path: `orders/${orderId}/ref-images/${fileName}`,
                  file,
                });
                if (publicUrl) {
                  refImageUrls.push(publicUrl);
                  uploadedUrls.push({ bucket: "order-docs", url: publicUrl });
                }
              }
            } catch {
              await cleanupUploadedUrls();
              throw new Error("Error al subir las imágenes de referencia. Verifica que no sean demasiado grandes.");
            }
          }
        }

        const payload = {
          id: orderId,
          client_id: form.client_id,
          client_name: form.client_name.trim(),
          client_contact: form.client_phone.trim() || null,
          invoice_number: form.invoice_number.trim(),
          description: form.description.trim(),
          material: form.materials.join(", "),
          termination_type: form.termination_type.trim() || null,
          order_type: form.order_type,
          order_design_type: form.design_type,
          delivery_date: nextIndefinido ? null : (form.delivery_date || null),
          status: ORDER_STATUS.PENDING,
          payment_status: "Pending_Payment",
          seller_id: userId,
          created_by: userId,
        };

        if (previewUrl) payload.preview_image = previewUrl;
        if (refImageUrls.length > 0) payload.reference_images = serializeReferenceImages(refImageUrls);

        const { error: insertError } = await supabase.from("orders").insert([payload]).select().single();
        if (insertError) {
          await cleanupUploadedUrls();
          throw new Error("No se pudo crear la orden. Intenta nuevamente.");
        }

        if (fileUrls.length > 0) {
          const productionRows = buildProductionFileRows({
            orderId,
            urls: fileUrls,
            files: form.design_files,
            areaCodes: form.design_file_areas,
            publicLabels: form.design_file_labels,
            userId,
          });

          const { error: productionFilesError } = await supabase
            .from("order_production_files")
            .insert(productionRows);

          if (productionFilesError) {
            await cleanupUploadedUrls();
            throw new Error("No se pudo guardar la clasificacion de produccion de los archivos.");
          }

          const { error: updateLegacyError } = await supabase
            .from("orders")
            .update({ order_file_url: JSON.stringify(fileUrls) })
            .eq("id", orderId);

          if (updateLegacyError) {
            await cleanupUploadedUrls();
            throw new Error("No se pudieron asociar los archivos a la orden.");
          }
        }
      })(), 60000);

      handleClose();
      onCreated?.();
    } catch (err) {
      if (err.message === "timeout") {
        setError("La orden está tardando más de lo normal. Verifica tu conexión a internet e intenta de nuevo.");
      } else {
        setError(err.message || "No se pudo crear la orden. Intenta nuevamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setError("");
    setFieldErrors({});
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Nueva Orden" stickyHeader>
      {error && <div className="ps-form-error">{error}</div>}

      <div className="ps-form-section-title">
        <span className="ps-form-section-num">1</span> Datos del cliente
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Cliente registrado" required hint="Busca y selecciona un cliente registrado." error={fieldErrors.client_id}>
            <ClientSelect
              clients={clients}
              loading={clientsLoading}
              value={form.client_id}
              onSelect={applySelectedClient}
              onSearch={onClientSearch}
              onAddNewClient={onAddNewClient}
              placeholder="Seleccionar cliente registrado"
            />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Nombre del cliente" required error={fieldErrors.client_name}>
            <input className="ps-form-input" placeholder="Seleccionar cliente"
              value={form.client_name} readOnly disabled />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Telefono / Contacto" required hint="Se completa desde el cliente registrado" error={fieldErrors.client_phone}>
            <div className="ps-input-icon-wrap">
              <span className="ps-input-icon"><Icons.Phone /></span>
              <input className="ps-form-input with-icon" placeholder={PHONE_PLACEHOLDER}
                value={form.client_phone} readOnly disabled maxLength="12" />
            </div>
          </Field>
        </div>
        <div className="col-full">
          <Field label="Número de Facturación" required error={fieldErrors.invoice_number}>
            <input className="ps-form-input" placeholder="Ej: FAC-001-2024"
              value={form.invoice_number} onChange={event => set("invoice_number", event.target.value)} />
          </Field>
        </div>
      </div>

      <div className="ps-form-section-title">
        <span className="ps-form-section-num">2</span> Detalles del trabajo
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Descripcion del trabajo" required error={fieldErrors.description}>
            <textarea className="ps-form-input textarea" placeholder="Describe el trabajo solicitado por el cliente..."
              value={form.description} onChange={event => set("description", event.target.value)} />
          </Field>
        </div>

        <div className="col-full">
          <Field label="Materiales" required hint="Puedes seleccionar más de un material" error={fieldErrors.materials}>
            <MultiMaterialSelector selected={form.materials} onChange={value => set("materials", value)} options={materialOptions} />
          </Field>
        </div>

        <div className="col-full">
          <Field label="Tipo de terminación" optional hint="Describe el tipo de terminación del trabajo">
            <input className="ps-form-input" placeholder="Ej: Brillante, Mate, Con marco..."
              value={form.termination_type} onChange={event => set("termination_type", event.target.value)} />
          </Field>
        </div>

        <div className="col-full">
          <Field label="Tipo de orden" required error={fieldErrors.order_type}>
            <div className="ps-order-type-group">
              {[
                { val: "orden normal", label: "Orden Normal", desc: "Flujo estándar de produccion" },
                { val: "orden 911", label: "Orden 911", desc: "Urgente — prioridad maxima", urgent: true },
              ].map(opt => (
                <label key={opt.val} className={`ps-order-type-card ${form.order_type === opt.val ? "selected" : ""} ${opt.urgent ? "urgent" : ""}`}>
                  <input type="radio" name="order_type" value={opt.val}
                    checked={form.order_type === opt.val}
                    onChange={() => set("order_type", opt.val)}
                    style={{ display: "none" }} />
                  <div className="ps-order-type-label">{opt.label}</div>
                  <div className="ps-order-type-desc">{opt.desc}</div>
                </label>
              ))}
            </div>
          </Field>
        </div>

        <div className="col-full">
          <Field label="Tipo de diseno" required error={fieldErrors.design_type}>
            <div className="ps-order-type-group">
              {[
                { val: "INTERNAL_DESING", label: "Diseño Interno", desc: "El diseno lo realiza NeonPrint" },
                { val: "EXTERNAL_DESING", label: "Diseño Externo", desc: "El cliente entrega su diseno" },
              ].map(opt => (
                <label key={opt.val} className={`ps-order-type-card ${form.design_type === opt.val ? "selected" : ""}`}>
                  <input type="radio" name="design_type" value={opt.val}
                    checked={form.design_type === opt.val}
                    onChange={() => set("design_type", opt.val)}
                    style={{ display: "none" }} />
                  <div className="ps-order-type-label">{opt.label}</div>
                  <div className="ps-order-type-desc">{opt.desc}</div>
                </label>
              ))}
            </div>
          </Field>
        </div>

        {form.design_type === "EXTERNAL_DESING" && (
          <>
            <div className="col-full">
              <Field label="Archivos de diseño" required error={fieldErrors.design_files} hint="Sube los archivos de diseño del cliente (obligatorio)">
                <FileUploadZone
                  mode="attachment"
                  multiple
                  inputRef={fileInputRef}
                  buttonLabel="Subir archivos"
                  hint="Archivos del diseño (PDF, AI, PNG, JPG...)"
                  onFilesAccepted={(files) => {
                    set("design_files", [...form.design_files, ...files]);
                    set("design_file_areas", [...form.design_file_areas, ...files.map(() => "")]);
                    set("design_file_labels", [...form.design_file_labels, ...files.map(() => "")]);
                    setFieldErrors(previous => ({ ...previous, design_files: "" }));
                  }}
                />
                {form.design_files.length > 0 && (
                  <div className="ps-files-list ps-files-list-designer">
                    {form.design_files.map((file, index) => (
                      <div key={`${file.name}-${index}`} className={missingLabelIndices.includes(index) || missingAreaIndices.includes(index) ? "ps-file-missing" : ""}>
                        <FileCard
                          name={file.name}
                          secondaryText={formatFileSize(file.size)}
                          onRemove={() => {
                            set("design_files", form.design_files.filter((_, currentIndex) => currentIndex !== index));
                            set("design_file_areas", form.design_file_areas.filter((_, currentIndex) => currentIndex !== index));
                            set("design_file_labels", form.design_file_labels.filter((_, currentIndex) => currentIndex !== index));
                          }}
                        >
                          <div className="production-file-meta ps-production-file-fields">
                            <label className="production-file-field">
                              <span className="production-file-field-label">Nombre visible en seguimiento</span>
                              <input
                                className={`ps-form-input${missingLabelIndices.includes(index) ? " ps-input-error" : ""}`}
                                value={form.design_file_labels[index] || ""}
                                onChange={(event) => {
                                  set("design_file_labels", form.design_file_labels.map((label, currentIndex) => currentIndex === index ? event.target.value : label));
                                  setMissingLabelIndices([]);
                                  setFieldErrors(previous => ({ ...previous, design_files: "" }));
                                }}
                                placeholder="Ej: Banner principal"
                                aria-label={`Nombre visible en seguimiento de ${file.name}`}
                              />
                            </label>
                            <label className="production-file-field">
                              <span className="production-file-field-label">Área de producción</span>
                              <ProductionAreaSelect
                                value={form.design_file_areas[index]}
                                isError={missingAreaIndices.includes(index)}
                                onChange={(value) => {
                                  set("design_file_areas", form.design_file_areas.map((area, currentIndex) => currentIndex === index ? value : area));
                                  setMissingAreaIndices([]);
                                  setFieldErrors(previous => ({ ...previous, design_files: "" }));
                                }}
                              />
                            </label>
                          </div>
                        </FileCard>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="col-full">
              <Field label="Imagen de la orden de trabajo" required error={fieldErrors.design_preview} hint="Vista previa del diseño (obligatorio)">
                {!form.design_preview ? (
                  <FileUploadZone
                    mode="image"
                    replaceMode
                    inputRef={previewInputRef}
                    buttonLabel="Subir imagen de preview"
                    hint="Imagen de la orden de trabajo (PNG, JPG...)"
                    onFilesAccepted={([file]) => {
                      setFieldErrors(previous => ({ ...previous, design_preview: "" }));
                      set("design_preview", file);
                    }}
                  />
                ) : (
                  <div className="ps-preview-showcase">
                    <FileUploadZone
                      mode="image"
                      replaceMode
                      inputRef={previewInputRef}
                      className="file-upload-zone--hidden-picker"
                      buttonLabel="Cambiar imagen"
                      onFilesAccepted={([file]) => {
                        setFieldErrors(previous => ({ ...previous, design_preview: "" }));
                        set("design_preview", file);
                      }}
                    />
                    <div className="ps-preview-card">
                      <img src={URL.createObjectURL(form.design_preview)} alt="Preview" className="ps-preview-img-main" />
                      <div className="ps-preview-card-overlay">
                        <span className="ps-preview-card-label">Vista previa del diseño</span>
                        <div className="ps-preview-card-actions">
                          <button className="ps-preview-change-btn" onClick={() => previewInputRef.current?.click()}>Cambiar</button>
                          <button className="ps-preview-del-btn" onClick={() => set("design_preview", null)}><Icons.Trash /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Field>
            </div>
          </>
        )}

        <div className="col-full">
          <Field label="Fecha de entrega" optional error={fieldErrors.delivery_date}>
            <div className="ps-date-row">
              <div className="ps-input-icon-wrap" style={{ flex: 1 }}>
                <span className="ps-input-icon"><Icons.Calendar /></span>
                <input
                  className="ps-form-input with-icon"
                  type="date"
                  value={form.delivery_date}
                  disabled={form.indefinido}
                  onChange={event => set("delivery_date", event.target.value)}
                  style={{ opacity: form.indefinido ? 0.4 : 1 }}
                />
              </div>
              <label className="ps-indefinido-check" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={form.indefinido}
                  onChange={event => set("indefinido", event.target.checked)}
                  style={{ width: "16px", height: "16px", margin: 0, cursor: "pointer" }}
                />
                <span style={{ fontSize: "13px", color: "#64748b" }}>Por definir</span>
              </label>
            </div>
          </Field>
        </div>

        <div className="col-full">
          <Field label="Imágenes de referencia" hint="Sube imágenes de referencia para la orden (opcional)">
            <FileUploadZone
              mode="image"
              multiple
              inputRef={refImagesInputRef}
              maxFiles={REF_IMAGE_CONFIG.MAX_COUNT}
              existingCount={form.reference_images.length}
              buttonLabel="Subir imágenes"
              hint="Imágenes de referencia (Máx 3, 20MB c/u. Soporta JPG, PNG, WebP, GIF, HEIC y HEIF)"
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
                const combined = [...form.reference_images, ...validFiles];
                const validation = validateReferenceImages(combined);
                const message = [
                  ...errors,
                  ...(!validation.valid ? validation.errors : []),
                ].join(". ");
                if (message) {
                  showError(message);
                }
                if (!validation.valid) {
                  return;
                }
                setFieldErrors(previous => {
                  const next = { ...previous };
                  delete next.reference_images;
                  return next;
                });
                set("reference_images", combined);
              }}
            />
            {form.reference_images.length > 0 && (
              <div className="ps-files-list">
                {form.reference_images.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="ps-file-item">
                    <img src={URL.createObjectURL(file)} alt={file.name} className="ps-ref-thumb" />
                    <span className="ps-file-name">{file.name}</span>
                    <button className="ps-file-remove" onClick={(event) => { event.stopPropagation(); set("reference_images", form.reference_images.filter((_, currentIndex) => currentIndex !== index)); }}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </div>
      </div>

      <div className="ps-form-actions">
        <button className="ps-btn-cancel" onClick={handleClose}>Cancelar</button>
        <button className="ps-btn-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Guardando..." : "Crear Orden →"}
        </button>
      </div>
    </Modal>
  );
}
