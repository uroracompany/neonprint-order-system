import { Icons } from "../../utils/icons";
import { Modal } from "../orders/CreateOrderModal";

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
  areasLoading = false,
  insertedAwaitingRefresh = false,
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
        <div className="ps-field">
          <label className="ps-label" htmlFor="material-form-name">Nombre del material<span className="ps-label-req">*</span></label>
          <input
            id="material-form-name"
            className="ps-form-input"
            value={name}
            onChange={(event) => {
              if (!insertedAwaitingRefresh) onNameChange?.(event.target.value);
            }}
            disabled={saving || insertedAwaitingRefresh}
            placeholder="Ej. Vinilo, Banner, Lona..."
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && isReady && !saving && !insertedAwaitingRefresh) onSave?.();
            }}
          />
        </div>
        <div className="ps-field">
          <label className="ps-label" htmlFor="material-form-production-area">Área de producción<span className="ps-label-req">*</span></label>
          <select
            id="material-form-production-area"
            className="ps-form-input"
            value={areaCode}
            onChange={(event) => {
              if (!insertedAwaitingRefresh) onAreaChange?.(event.target.value);
            }}
            disabled={areasLoading || saving || insertedAwaitingRefresh}
          >
            <option value="">{areasLoading ? "Cargando áreas…" : areas.length ? "Seleccionar área" : "No hay áreas activas"}</option>
            {areas.map((area) => (
              <option key={area.code} value={area.code}>{area.label}</option>
            ))}
          </select>
          {areasLoading && <p className="ps-field-hint" role="status">Cargando áreas de producción…</p>}
        </div>
        {insertedAwaitingRefresh && (
          <p className="ps-field-hint" role="status">
            El material ya se guardó. Reintenta para actualizar el catálogo.
          </p>
        )}
        <div className="ps-form-actions ps-file-details-actions">
          <button type="button" className="ps-btn-cancel ps-file-details-btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className="ps-btn-submit ps-file-details-btn-save"
            onClick={onSave}
            disabled={!isReady || saving}
          >
            <Icons.Check />
            {saving ? "Guardando..." : insertedAwaitingRefresh ? "Reintentar actualización" : editingMaterial ? "Guardar cambios" : "Agregar material"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
