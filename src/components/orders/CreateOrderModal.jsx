import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { ClientSelect } from "../ui/ClientCombobox";
import FileUploadZone from "../ui/FileUploadZone";
import FileCard from "../FileCard";
import { ORDER_STATUS, PRODUCTION_AREAS } from "../../utils/constants";
import { serializeReferenceImages } from "../../utils/orderAssets";
import { buildProductionFileRows } from "../../utils/production";
import { buildStorageSafeFileName, formatFileSize, uploadOrderAsset } from "../../utils/uploadOrderAsset";
import { canDecodeAsImage, compressImage, REF_IMAGE_CONFIG, validateReferenceImages } from "../../utils/imageValidation";
import { formatPhone, getSelectedClientOrderFields } from "../../utils/clients";
import { getMinimumDeliveryDate, isDeliveryDateInPast } from "../../utils/deliveryDate";

export const PHONE_PLACEHOLDER = "Seleccionar Cliente";

const EMPTY_FORM = {
  design_file_areas: [],
  design_file_labels: [],
  design_file_materials: [],
  design_file_terminations: [],
  client_id: null,
  client_name: "",
  client_phone: "",
  invoice_number: "",
  invoice_assignment_mode: "seller",
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

const ORDER_DRAFT_STORAGE_PREFIX = "neonprint:create-order-draft:v1";
const modalStack = [];
let modalScrollLockDepth = 0;
let modalScrollRestore = null;

const isTopModal = (modalId) => modalStack[modalStack.length - 1] === modalId;

const acquireModalLayer = (modalId) => {
  modalStack.push(modalId);
  if (modalScrollLockDepth === 0) {
    modalScrollRestore = {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow,
    };
  }
  modalScrollLockDepth += 1;
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
};

const releaseModalLayer = (modalId) => {
  const index = modalStack.lastIndexOf(modalId);
  if (index === -1) return;
  modalStack.splice(index, 1);
  modalScrollLockDepth = Math.max(0, modalScrollLockDepth - 1);

  if (modalScrollLockDepth === 0 && modalScrollRestore) {
    document.body.style.overflow = modalScrollRestore.body;
    document.documentElement.style.overflow = modalScrollRestore.html;
    modalScrollRestore = null;
  }
};

const getOrderDraftStorageKey = (userId) => (
  userId ? `${ORDER_DRAFT_STORAGE_PREFIX}:${userId}` : null
);

const clearOrderDraft = (userId) => {
  const key = getOrderDraftStorageKey(userId);
  if (!key) return;

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
};

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  stickyHeader = false,
  className = "",
  closeOnBackdrop = false,
  closeOnEscape = false,
  hideStripe = false,
  overlayClassName = "",
  headerContent = null,
  footer = null,
}) {
  const titleId = useId();
  const overlayRef = useRef(null);
  const modalRef = useRef(null);
  const closeButtonRef = useRef(null);
  const modalIdRef = useRef(Symbol("neonprint-modal"));
  const onCloseRef = useRef(onClose);
  const closeOnBackdropRef = useRef(closeOnBackdrop);
  const closeOnEscapeRef = useRef(closeOnEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnBackdropRef.current = closeOnBackdrop;
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnBackdrop, closeOnEscape, onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const modalId = modalIdRef.current;
    const previousActiveElement = document.activeElement;
    acquireModalLayer(modalId);

    const focusCloseButton = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event) => {
      if (!isTopModal(modalId)) return;

      if (event.key === "Escape" && closeOnEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab" || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const focusable = Array.from(focusableElements).filter(
        (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true"
      );

      if (focusable.length === 0) {
        event.preventDefault();
        modalRef.current.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleNativeBackdropPointerDown = (event) => {
      if (closeOnBackdropRef.current && event.target === overlayRef.current) {
        onCloseRef.current?.();
      }
    };

    const overlayNode = overlayRef.current;

    document.addEventListener("keydown", handleKeyDown);
    overlayNode?.addEventListener("pointerdown", handleNativeBackdropPointerDown);

    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.removeEventListener("keydown", handleKeyDown);
      overlayNode?.removeEventListener("pointerdown", handleNativeBackdropPointerDown);
      releaseModalLayer(modalId);
      if (previousActiveElement && typeof previousActiveElement.focus === "function") {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (event) => {
    if (closeOnBackdropRef.current && event.target === event.currentTarget) {
      onCloseRef.current?.();
    }
  };

  const handleCloseClick = () => {
    onCloseRef.current?.();
  };

  const modalElement = (
    <div ref={overlayRef} className={`ps-modal-overlay ${overlayClassName}`.trim()} onClick={handleBackdropClick}>
      <div
        ref={modalRef}
        className={`ps-modal ${wide ? "wide" : "narrow"} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {!hideStripe && <div className="ps-modal-stripe" aria-hidden="true" />}
        <div className={`ps-modal-header ${stickyHeader ? "is-sticky" : ""}`}>
          {headerContent ? (
            <div className="ps-modal-header-custom" id={titleId}>{headerContent}</div>
          ) : (
            <span id={titleId} className="ps-modal-title">{title}</span>
          )}
          <button ref={closeButtonRef} type="button" className="ps-modal-close" onClick={handleCloseClick} aria-label="Cerrar modal"><Icons.Close /></button>
        </div>
        <div className="ps-modal-body">{children}</div>
        {footer && <div className="ps-modal-footer">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(modalElement, document.body);
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

export function ProductionAreaSelect({ value, onChange, className = "ps-form-input", isError, disabled = false, ariaLabelledBy }) {
  return (
    <select aria-labelledby={ariaLabelledBy} className={`${className}${isError ? " ps-input-error" : ""}`} value={value || ""} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      <option value="">Tipo de produccion</option>
      {PRODUCTION_AREAS.map((area) => (
        <option key={area.code} value={area.code}>{area.label}</option>
      ))}
    </select>
  );
}

function useCatalogDropdown(disabled) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  const toggle = () => {
    if (!disabled) setOpen((current) => !current);
  };

  return { open, setOpen, ref, toggle };
}

function CatalogOption({ children, selected = false, onClick, className = "" }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`ps-multimat-option ${selected ? "selected" : ""} ${className}`.trim()}
      onClick={onClick}
    >
      <span className="ps-multimat-check">{selected ? "✓" : ""}</span>
      {children}
    </button>
  );
}

const areCatalogValuesEqual = (left = [], right = []) => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

export function CatalogSelector({
  value,
  onChange,
  options = [],
  multiple = false,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  placeholder,
  listboxLabel,
  emptyMessage = "No hay elementos registrados",
  customActionLabel,
  customInputPlaceholder,
  customInputAriaLabel,
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const normalizeValue = useCallback((nextValue) => {
    if (multiple) return Array.isArray(nextValue) ? nextValue : [];
    return nextValue ? [nextValue] : [];
  }, [multiple]);
  const initialValue = normalizeValue(value);
  const [committedSelected, setCommittedSelected] = useState(initialValue);
  const [draftSelected, setDraftSelected] = useState(initialValue);
  const [draftActive, setDraftActive] = useState(false);
  const customInputRef = useRef(null);
  const selectedRef = useRef(initialValue);
  const pendingCommitRef = useRef(null);
  const { open, setOpen, ref } = useCatalogDropdown(disabled);

  useEffect(() => {
    const nextValue = normalizeValue(value);
    if (pendingCommitRef.current) {
      if (areCatalogValuesEqual(nextValue, pendingCommitRef.current)) {
        pendingCommitRef.current = null;
      } else if (!draftActive) {
        return;
      }
    }
    selectedRef.current = nextValue;
    if (!draftActive) {
      setCommittedSelected(nextValue);
      setDraftSelected(nextValue);
    }
  }, [draftActive, normalizeValue, value]);

  const startDraftSession = () => {
    if (draftActive) return;
    setDraftActive(true);
    setDraftSelected([...selectedRef.current]);
    setCustomMode(false);
    setCustomValue("");
  };

  const toggleDropdown = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    startDraftSession();
    setOpen(true);
  };

  const displayedSelected = draftActive ? draftSelected : committedSelected;

  const selectOption = (option) => {
    if (disabled) return;
    setDraftSelected((current) => {
      if (multiple) return current.includes(option) ? current : [...current, option];
      return [option];
    });
  };
  const remove = (option) => {
    if (disabled) return;
    const currentValues = draftActive ? draftSelected : selectedRef.current;
    setDraftActive(true);
    setCustomMode(false);
    setCustomValue("");
    setDraftSelected(currentValues.filter((valueItem) => valueItem !== option));
    setOpen(true);
  };

  const openCustomMode = () => {
    if (disabled) return;
    const currentValue = draftSelected[0] || "";
    const customDraft = currentValue && !options.includes(currentValue) ? currentValue : "";
    setCustomValue(customDraft);
    if (!multiple && !customDraft) setDraftSelected([]);
    setCustomMode(true);
  };

  const handleCustomInputChange = (event) => {
    const nextValue = event.target.value;
    setCustomValue(nextValue);
    if (!multiple) setDraftSelected(nextValue.trim() ? [nextValue] : []);
  };

  const handleAddCustom = () => {
    if (disabled) return;
    const nextValue = customValue.trim();
    if (!nextValue) return;
    setDraftSelected((current) => {
      if (!multiple) return [nextValue];
      return current.includes(nextValue) ? current : [...current, nextValue];
    });
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

  const handleCancel = () => {
    setDraftActive(false);
    setCommittedSelected([...selectedRef.current]);
    setDraftSelected([...selectedRef.current]);
    setCustomMode(false);
    setCustomValue("");
    setOpen(false);
  };

  const handleCommit = () => {
    const nextSelected = draftSelected
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (disabled || nextSelected.length === 0) return;
    pendingCommitRef.current = nextSelected;
    selectedRef.current = nextSelected;
    setCommittedSelected(nextSelected);
    setDraftSelected(nextSelected);
    onChange(multiple ? nextSelected : nextSelected[0]);
    setDraftActive(false);
    setOpen(false);
  };

  useEffect(() => {
    if (customMode && customInputRef.current) customInputRef.current.focus();
  }, [customMode]);

  const isCustomValue = (item) => !options.includes(item);
  const hasDraftValue = draftSelected.some((item) => String(item || "").trim());
  const triggerProps = {
    className: `ps-multimat-box ${open ? "focused" : ""}`,
    role: multiple ? "combobox" : "button",
    "aria-label": ariaLabelledBy ? undefined : ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-expanded": open,
    "aria-haspopup": "listbox",
    tabIndex: disabled ? -1 : 0,
    onClick: toggleDropdown,
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleDropdown();
      }
      if (event.key === "Escape" && open) handleCancel();
    },
  };
  const triggerContent = (
    <>
      {displayedSelected.length === 0
        ? <span className="ps-multimat-placeholder">{placeholder}</span>
        : displayedSelected.map((item) => (
          <span key={item} className={`ps-chip ${isCustomValue(item) ? "ps-chip--custom" : ""}`}>
            {isCustomValue(item) && <span className="ps-chip-custom-icon"><Icons.Plus /></span>}
            {item}
            {multiple ? (
              <button type="button" className="ps-chip-remove" aria-label={`Quitar ${item}`} onClick={(event) => { event.stopPropagation(); remove(item); }}><Icons.X /></button>
            ) : (
              <span
                className="ps-chip-remove"
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label={`Quitar ${item}`}
                onClick={(event) => { event.stopPropagation(); remove(item); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    remove(item);
                  }
                }}
              ><Icons.X /></span>
            )}
          </span>
        ))
      }
      <span className="ps-multimat-arrow"><Icons.ChevronDown /></span>
    </>
  );

  return (
    <div className={`ps-multimat${disabled ? " ps-multimat--disabled" : ""}`} ref={ref}>
      {multiple ? <div {...triggerProps}>{triggerContent}</div> : <button type="button" disabled={disabled} {...triggerProps}>{triggerContent}</button>}

      {open && !disabled && (
        <div className="ps-multimat-dropdown" role="listbox" aria-label={listboxLabel} aria-multiselectable={multiple ? "true" : undefined} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") handleCancel(); }}>
          {!customMode ? (
            <button type="button" className="ps-multimat-option ps-multimat-add" onClick={openCustomMode}>
              <span className="ps-multimat-add-icon"><Icons.Plus /></span>
              {customActionLabel}
            </button>
          ) : (
            <div className="ps-multimat-custom-form">
              <input
                ref={customInputRef}
                className="ps-multimat-custom-input"
                placeholder={customInputPlaceholder}
                aria-label={customInputAriaLabel}
                value={customValue}
                onChange={handleCustomInputChange}
                onKeyDown={handleCustomKeyDown}
              />
              <button type="button" className="ps-multimat-custom-btn" onClick={handleAddCustom} disabled={!customValue.trim()}>
                Preparar
              </button>
            </div>
          )}

          <div className="ps-multimat-divider" />

          {options.length === 0 ? (
            <div className="ps-multimat-option ps-multimat-empty">{emptyMessage}</div>
          ) : (
            options.map((option) => (
              <CatalogOption key={option} selected={draftSelected.includes(option)} onClick={() => selectOption(option)}>{option}</CatalogOption>
            ))
          )}
          <div className="ps-multimat-actions">
            <button type="button" className="ps-multimat-cancel" onClick={handleCancel}>Cancelar</button>
            <button type="button" className="ps-multimat-confirm" onClick={handleCommit} disabled={!hasDraftValue}>Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MultiMaterialSelector({ selected = [], onChange, options = [], disabled = false, ariaLabel = "Materiales", ariaLabelledBy }) {
  return (
    <CatalogSelector
      value={selected}
      onChange={onChange}
      options={options}
      multiple
      disabled={disabled}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      placeholder="Seleccionar materiales..."
      listboxLabel="Materiales disponibles"
      customActionLabel="Agregar material personalizado"
      customInputPlaceholder="Escribe el nombre del material..."
      customInputAriaLabel="Material personalizado"
    />
  );
}

export function TerminationSelector({ value = "", onChange, options = [], disabled = false, ariaLabel = "Terminación", ariaLabelledBy, emptyMessage = "Sin terminaciones disponibles" }) {
  return (
    <CatalogSelector
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      placeholder="Seleccionar terminación"
      listboxLabel="Terminaciones disponibles"
      emptyMessage={emptyMessage}
      customActionLabel="Agregar terminación personalizada"
      customInputPlaceholder="Describe la terminación personalizada..."
      customInputAriaLabel="Terminación personalizada"
    />
  );
}

export function ProductionFileSpecifications({
  areaCode,
  materialNames = [],
  terminationName = "",
  onAreaChange,
  onMaterialsChange,
  onTerminationChange,
  onAreaSpecificationsChange,
  catalog = {},
  isError = false,
  areaDisabled = false,
  materialsDisabled = false,
  terminationDisabled = false,
}) {
  const areaLabelId = useId();
  const materialsLabelId = useId();
  const terminationLabelId = useId();
  const materialOptions = catalog.materials?.[areaCode] || [];
  const terminationOptions = catalog.terminations?.[areaCode] || [];

  return (
    <div className="production-file-meta ps-production-file-fields">
      <label className="production-file-field">
        <span id={areaLabelId} className="production-file-field-label">Área de producción</span>
        <ProductionAreaSelect
          value={areaCode}
          isError={isError && !areaCode}
          disabled={areaDisabled}
          ariaLabelledBy={areaLabelId}
          onChange={(nextArea) => {
            const nextMaterialOptions = catalog.materials?.[nextArea] || [];
            const nextTerminationOptions = catalog.terminations?.[nextArea] || [];
            const nextMaterials = (materialNames || []).filter((name) => (
              !materialOptions.includes(name) || nextMaterialOptions.includes(name)
            ));
            const nextTermination = (
              terminationOptions.includes(terminationName) && !nextTerminationOptions.includes(terminationName)
                ? ""
                : terminationName
            );
            if (onAreaSpecificationsChange) {
              onAreaSpecificationsChange({ areaCode: nextArea, materialNames: nextMaterials, terminationName: nextTermination });
              return;
            }
            onAreaChange(nextArea);
            onMaterialsChange(nextMaterials);
            onTerminationChange(nextTermination);
          }}
        />
      </label>
      <label className="production-file-field">
        <span id={materialsLabelId} className="production-file-field-label">Materiales</span>
        <MultiMaterialSelector selected={materialNames} onChange={onMaterialsChange} options={materialOptions} disabled={materialsDisabled} ariaLabelledBy={materialsLabelId} />
      </label>
      <label className="production-file-field">
        <span id={terminationLabelId} className="production-file-field-label">Terminación</span>
        <TerminationSelector value={terminationName} onChange={onTerminationChange} options={terminationOptions} disabled={terminationDisabled} ariaLabelledBy={terminationLabelId} />
      </label>
    </div>
  );
}

export function ProductionFileDetailsModal({
  open,
  fileName,
  value,
  catalog = {},
  onClose,
  onSave,
  saving = false,
  orderId = null,
  fileKey = "",
}) {
  const [draft, setDraft] = useState(value || {});
  const [errors, setErrors] = useState({});
  const incomingValueRef = useRef(value);

  useEffect(() => {
    incomingValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const incomingValue = incomingValueRef.current;
    setDraft({
      publicLabel: incomingValue?.publicLabel || "",
      areaCode: incomingValue?.areaCode || "",
      materialNames: incomingValue?.materialNames || [],
      terminationName: incomingValue?.terminationName || "",
    });
    setErrors({});
  }, [open, fileKey]);

  const update = (key, nextValue) => setDraft((current) => ({ ...current, [key]: nextValue }));
  const handleSave = async () => {
    const nextErrors = {};
    const materialNames = (draft.materialNames || [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    if (!draft.publicLabel?.trim()) nextErrors.publicLabel = "Indica el nombre visible en seguimiento.";
    if (!draft.areaCode) nextErrors.areaCode = "Selecciona el área de producción.";
    if (!materialNames.length) nextErrors.materials = "Selecciona al menos un material.";
    if (!draft.terminationName?.trim()) nextErrors.terminationName = "Selecciona o escribe una terminación.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      await onSave?.({
        publicLabel: draft.publicLabel.trim(),
        areaCode: draft.areaCode,
        materialNames,
        terminationName: draft.terminationName.trim(),
      });
      onClose?.();
    } catch (error) {
      setErrors({ form: error?.message || "No se pudieron guardar los detalles del archivo." });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Detalles: ${fileName || "archivo"}`}
      hideStripe
      className="ps-file-details-modal"
      overlayClassName="ps-file-details-overlay"
      headerContent={
        <>
          {orderId && <span className="ps-file-details-order-code">#{String(orderId).slice(0, 8).toUpperCase()}</span>}
          <h3 className="ps-file-details-title">Detalles de Archivo</h3>
        </>
      }
    >
      <div className="ps-file-details-content">
        {errors.form && <p className="ps-form-error-banner" role="alert">{errors.form}</p>}
        <Field label="Nombre visible en seguimiento" required error={errors.publicLabel}>
          <input
            className="ps-form-input"
            value={draft.publicLabel || ""}
            onChange={(event) => update("publicLabel", event.target.value)}
            placeholder="Ej: Banner principal"
            aria-label="Nombre visible en seguimiento"
          />
        </Field>
        <ProductionFileSpecifications
          areaCode={draft.areaCode}
          materialNames={draft.materialNames}
          terminationName={draft.terminationName}
          catalog={catalog}
          isError={Boolean(errors.areaCode || errors.materials || errors.terminationName)}
          areaDisabled={!draft.publicLabel?.trim()}
          materialsDisabled={!draft.publicLabel?.trim() || !draft.areaCode}
          terminationDisabled={!draft.publicLabel?.trim() || !draft.areaCode}
          onAreaChange={(value) => update("areaCode", value)}
          onMaterialsChange={(value) => update("materialNames", value)}
          onTerminationChange={(value) => update("terminationName", value)}
          onAreaSpecificationsChange={(nextSpecifications) => setDraft((current) => ({ ...current, ...nextSpecifications }))}
        />
        {(errors.areaCode || errors.materials || errors.terminationName) && (
          <p className="ps-field-error-message" role="alert">
            {errors.areaCode || errors.materials || errors.terminationName}
          </p>
        )}
        <div className="ps-form-actions ps-file-details-actions">
          <button type="button" className="ps-btn-cancel ps-file-details-btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="ps-btn-submit ps-file-details-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? (
              <><span className="ps-btn-spinner" /> Guardando...</>
            ) : (
              <><Icons.Check /> Guardar Detalles</>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function CreateOrderModal({
  open,
  onClose,
  onCreated,
  userId,
  productionCatalog = {},
  clients = [],
  clientsLoading = false,
  onClientSearch,
  onAddNewClient,
  clientToSelect = null,
  onClientToSelectConsumed,
  clientFieldDisabled = false,
  isSemiAdmin = false,
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
  const [detailsFileIndex, setDetailsFileIndex] = useState(null);
  // A retry after an uncertain network response must address the same command.
  const createRequestIdRef = useRef(null);

  const resetForm = useCallback(() => {
    clearOrderDraft(userId);
    createRequestIdRef.current = null;
    setForm(EMPTY_FORM);
    setError("");
    setFieldErrors({});
    setMissingLabelIndices([]);
    setMissingAreaIndices([]);
    setDetailsFileIndex(null);
  }, [userId]);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

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
    if (fields.client_phone) fields.client_phone = formatPhone(fields.client_phone);

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
    if (!form.order_type) {
      errors.order_type = "Selecciona el tipo de orden.";
    }
    if (!form.design_type) {
      errors.design_type = "Indica si el diseño es interno o externo.";
    }
    if (form.invoice_assignment_mode !== "cashier" && !form.invoice_number.trim()) {
      errors.invoice_number = "El número de facturación es requerido.";
    }
    if (!form.indefinido && !form.delivery_date) {
      errors.delivery_date = "Selecciona una fecha de entrega o marca 'Por definir'.";
    }
    if (!form.indefinido && isDeliveryDateInPast(form.delivery_date)) {
      errors.delivery_date = "La fecha de entrega no puede ser anterior a hoy.";
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

      const missingSpecifications = form.design_file_areas
        .map((_, index) => (
          !form.design_file_materials[index]?.some((name) => String(name || "").trim()) || !form.design_file_terminations[index]?.trim() ? index : -1
        ))
        .filter(index => index !== -1);

      const messages = [];
      if (missingAreas.length > 0) messages.push("un tipo de producción");
      if (missingLabels.length > 0) messages.push("un nombre de representación");
      if (missingSpecifications.length > 0) messages.push("materiales y terminación");
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
      await (async () => {
        const nextIndefinido = form.indefinido || !form.delivery_date;
        const orderId = createRequestIdRef.current || crypto.randomUUID();
        createRequestIdRef.current = orderId;

        let fileUrls = [];
        let previewUrl = null;
        let refImageUrls = [];
        const preorderAssets = [];
        const uploadedUrls = [];
        const leaveUploadedUrlsForReconciliation = () => Promise.resolve();

        if (form.design_files.length > 0 || form.design_preview || form.reference_images.length > 0) {
          try {
            for (let i = 0; i < form.design_files.length; i += 1) {
              const file = form.design_files[i];
              const fileName = buildStorageSafeFileName(file, `${i}-`);
              const uploadedAsset = await uploadOrderAsset({
                bucket: "order-docs",
                path: `orders/${orderId}/files/${fileName}`,
                file,
                deferR2Binding: true,
              });

              if (typeof uploadedAsset === "string" && uploadedAsset) {
                fileUrls[i] = uploadedAsset;
                uploadedUrls.push({ bucket: "order-docs", url: uploadedAsset });
              } else if (uploadedAsset?.preorder) {
                preorderAssets.push({ target: "design", index: i, descriptor: uploadedAsset });
                const preorder = uploadedAsset.preorder;
                fileUrls[i] = preorder?.provider === "supabase"
                  ? `supabase://${preorder.bucket}/${preorder.objectKey}`
                  : preorder?.bucket && preorder?.objectKey
                    ? `r2://${preorder.bucket}/${preorder.objectKey}`
                    : null;
              }
            }
          } catch {
            await leaveUploadedUrlsForReconciliation();
            throw new Error("Error al subir los archivos. Verifica que no sean demasiado grandes y que tu conexión esté estable.");
          }

          if (form.design_preview) {
            try {
              const fileName = buildStorageSafeFileName(form.design_preview, "preview-");
              const uploadedPreview = await uploadOrderAsset({
                bucket: "order-previews",
                path: `orders/${orderId}/preview/${fileName}`,
                file: form.design_preview,
                deferR2Binding: true,
              });
              if (typeof uploadedPreview === "string" && uploadedPreview) {
                previewUrl = uploadedPreview;
                uploadedUrls.push({ bucket: "order-previews", url: previewUrl });
              } else if (uploadedPreview?.preorder) {
                const preorder = uploadedPreview.preorder;
                previewUrl = preorder?.provider === "supabase"
                  ? `supabase://${preorder.bucket}/${preorder.objectKey}`
                  : preorder?.bucket && preorder?.objectKey
                    ? `r2://${preorder.bucket}/${preorder.objectKey}`
                    : null;
                preorderAssets.push({ target: "preview", descriptor: uploadedPreview });
              }
            } catch (err) {
              console.error("Preview upload failed:", err);
              await leaveUploadedUrlsForReconciliation();
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
                const uploadedAsset = await uploadOrderAsset({
                  bucket: "order-docs",
                  path: `orders/${orderId}/ref-images/${fileName}`,
                  file,
                  deferR2Binding: true,
                });
                if (typeof uploadedAsset === "string" && uploadedAsset) {
                  refImageUrls[i] = uploadedAsset;
                  uploadedUrls.push({ bucket: "order-docs", url: uploadedAsset });
                } else if (uploadedAsset?.preorder) {
                  preorderAssets.push({ target: "reference", index: i, descriptor: uploadedAsset });
                  const preorder = uploadedAsset.preorder;
                  refImageUrls[i] = preorder?.provider === "supabase"
                    ? `supabase://${preorder.bucket}/${preorder.objectKey}`
                    : preorder?.bucket && preorder?.objectKey
                      ? `r2://${preorder.bucket}/${preorder.objectKey}`
                      : null;
                }
              }
            } catch {
              await leaveUploadedUrlsForReconciliation();
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
          invoice_assignment_mode: form.invoice_assignment_mode === "cashier" ? "cashier" : "seller",
          description: form.description.trim(),
          material: "",
          termination_type: null,
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

        // R2 preorder records are intentionally bound only after the command
        // returns an order id. The SQL command keeps order + file metadata atomic;
        // a failed/uncertain bind is retained for reconciliation rather than deleted.
        const productionRows = buildProductionFileRows({
          orderId,
          urls: fileUrls.filter(Boolean),
          files: form.design_files.filter((_, index) => Boolean(fileUrls[index])),
          areaCodes: form.design_file_areas.filter((_, index) => Boolean(fileUrls[index])),
          publicLabels: form.design_file_labels.filter((_, index) => Boolean(fileUrls[index])),
          materialNames: form.design_file_materials.filter((_, index) => Boolean(fileUrls[index])),
          terminationNames: form.design_file_terminations.filter((_, index) => Boolean(fileUrls[index])),
          userId,
        });
        payload.order_file_url = fileUrls.length > 0 ? JSON.stringify(fileUrls.filter(Boolean)) : null;
        const createCommand = isSemiAdmin
          ? "semi_admin_create_order_with_client"
          : "create_seller_order_with_file_specifications";
        const { data: createdOrder, error: createError } = await supabase.rpc(createCommand, {
          p_idempotency_key: orderId,
          p_order: payload,
          ...(isSemiAdmin ? { p_client: null } : {}),
          p_production_files: productionRows,
          p_asset_refs: preorderAssets.map((asset) => ({
            ...(asset.descriptor?.preorder || asset.descriptor),
            target: asset.target,
          })),
        });
        if (createError || !createdOrder) {
          await leaveUploadedUrlsForReconciliation();
          throw new Error(createError?.message || "No se pudo crear la orden. Intenta nuevamente.");
        }

        if (preorderAssets.length > 0) {
          preorderAssets.forEach((asset) => {
            const descriptor = asset.descriptor?.preorder || asset.descriptor;
            const url = descriptor?.bucket && descriptor?.objectKey
              ? `${descriptor?.provider === "supabase" ? "supabase" : "r2"}://${descriptor.bucket}/${descriptor.objectKey}`
              : null;
            if (asset.target === "design") fileUrls[asset.index] = url;
            if (asset.target === "reference") refImageUrls[asset.index] = url;
          });
        }
      })();

      handleClose();
      onCreated?.();
    } catch (err) {
      setError(err.message || "No se pudo crear la orden. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const selectedDetailsFile = detailsFileIndex === null ? null : form.design_files[detailsFileIndex];

  return (
    <>
    <Modal open={open} onClose={handleClose} title="Nueva Orden" stickyHeader hideStripe>
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
              disabled={clientFieldDisabled}
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
          <Field
            label="Número de Facturación"
            required={form.invoice_assignment_mode !== "cashier"}
            hint={form.invoice_assignment_mode === "cashier" ? "Caja asignará el código antes de completar el pago." : undefined}
            error={fieldErrors.invoice_number}
          >
            <input className="ps-form-input" placeholder="Ej: FAC-001-2024"
              value={form.invoice_number}
              onChange={event => set("invoice_number", event.target.value)}
              disabled={form.invoice_assignment_mode === "cashier"}
            />
          </Field>
          <label className="ps-invoice-assignment-toggle">
            <input
              type="checkbox"
              checked={form.invoice_assignment_mode === "cashier"}
              onChange={(event) => {
                const nextMode = event.target.checked ? "cashier" : "seller";
                set("invoice_assignment_mode", nextMode);
                if (nextMode === "cashier") set("invoice_number", "");
              }}
            />
            <span>Asignar código de facturación en Caja</span>
          </label>
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
          <Field label="Tipo de diseño" required error={fieldErrors.design_type}>
            <div className="ps-order-type-group">
              {[
                { val: "INTERNAL_DESING", label: "Diseño Interno", desc: "El diseño lo realiza NeonPrint" },
                { val: "EXTERNAL_DESING", label: "Diseño Externo", desc: "El cliente entrega su diseño" },
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
                    set("design_file_materials", [...form.design_file_materials, ...files.map(() => [])]);
                    set("design_file_terminations", [...form.design_file_terminations, ...files.map(() => "")]);
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
                          detailText={form.design_file_labels[index] ? `Seguimiento: ${form.design_file_labels[index]}` : "Seguimiento pendiente"}
                          actions={[{
                            title: `Ver detalles de ${file.name}`,
                            label: "Detalles",
                            icon: <Icons.Edit />,
                            onClick: () => setDetailsFileIndex(index),
                          }]}
                          removeIcon={<Icons.Trash />}
                          removeTitle={`Eliminar ${file.name}`}
                          onRemove={() => {
                            set("design_files", form.design_files.filter((_, currentIndex) => currentIndex !== index));
                            set("design_file_areas", form.design_file_areas.filter((_, currentIndex) => currentIndex !== index));
                            set("design_file_labels", form.design_file_labels.filter((_, currentIndex) => currentIndex !== index));
                            set("design_file_materials", form.design_file_materials.filter((_, currentIndex) => currentIndex !== index));
                            set("design_file_terminations", form.design_file_terminations.filter((_, currentIndex) => currentIndex !== index));
                          }}
                        />
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
                  min={getMinimumDeliveryDate()}
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
          {loading ? (<><span className="ps-btn-spinner" /> Guardando...</>) : "Crear Orden →"}
        </button>
      </div>
    </Modal>
    <ProductionFileDetailsModal
      open={Boolean(selectedDetailsFile)}
      fileName={selectedDetailsFile?.name}
      fileKey={selectedDetailsFile ? `new-${detailsFileIndex}-${selectedDetailsFile.name}` : ""}
      value={selectedDetailsFile ? {
        publicLabel: form.design_file_labels[detailsFileIndex] || "",
        areaCode: form.design_file_areas[detailsFileIndex] || "",
        materialNames: form.design_file_materials[detailsFileIndex] || [],
        terminationName: form.design_file_terminations[detailsFileIndex] || "",
      } : null}
      catalog={productionCatalog}
      onClose={() => setDetailsFileIndex(null)}
      onSave={async (details) => {
        const index = detailsFileIndex;
        if (index === null) return;
        set("design_file_labels", form.design_file_labels.map((label, currentIndex) => currentIndex === index ? details.publicLabel : label));
        set("design_file_areas", form.design_file_areas.map((area, currentIndex) => currentIndex === index ? details.areaCode : area));
        set("design_file_materials", form.design_file_materials.map((materials, currentIndex) => currentIndex === index ? details.materialNames : materials));
        set("design_file_terminations", form.design_file_terminations.map((termination, currentIndex) => currentIndex === index ? details.terminationName : termination));
        setMissingLabelIndices([]);
        setMissingAreaIndices([]);
        setFieldErrors(previous => ({ ...previous, design_files: "" }));
      }}
    />
    </>
  );
}
