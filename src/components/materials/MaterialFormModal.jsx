import { Icons } from "../../utils/icons";
import { Field, Modal } from "../orders/CreateOrderModal";

/**
 * Shared material form used by Administration and Semi-Administration.
 * The parent owns persistence and permissions; this component only handles
 * the common presentation and input contract.
 */
export default function MaterialFormModal({
  open,
  onClose,
  editingMaterial = null,
  name = "",
  areaCode = "",
  areas = [],
  error = "",
  onNameChange,
  onAreaChange,
  onSave,
  saving = false,
}) {
  const isReady = Boolean(name.trim() && areaCode);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingMaterial ? "Editar material" : "Agregar material"}
      closeOnBackdrop
      closeOnEscape={false}
      hideStripe
      className="ps-file-details-modal"
      overlayClassName="ps-file-details-overlay"
      headerContent={<h3 className="ps-file-details-title">{editingMaterial ? "Editar material" : "Agregar material"}</h3>}
    >
      <div className="ps-file-details-content">
        {error && <p className="ps-form-error-banner" role="alert">{error}</p>}
        <Field label="Nombre del material" required>
          <input
            className="ps-form-input"
            value={name}
            onChange={(event) => onNameChange?.(event.target.value)}
            placeholder="Ej. Vinilo, Banner, Lona..."
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && isReady && !saving) onSave?.();
            }}
          />
        </Field>
        <Field label="Área de producción" required>
          <select
            className="ps-form-input"
            value={areaCode}
            onChange={(event) => onAreaChange?.(event.target.value)}
          >
            <option value="">Seleccionar área</option>
            {areas.map((area) => (
              <option key={area.code} value={area.code}>{area.label}</option>
            ))}
          </select>
        </Field>
        <div className="ps-form-actions ps-file-details-actions">
          <button type="button" className="ps-btn-cancel ps-file-details-btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className="ps-btn-submit ps-file-details-btn-save"
            onClick={onSave}
            disabled={!isReady || saving}
          >
            <Icons.Check />
            {saving ? "Guardando..." : editingMaterial ? "Guardar cambios" : "Agregar material"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
