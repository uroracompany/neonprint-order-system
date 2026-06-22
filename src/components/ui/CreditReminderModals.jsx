import { Icons } from "../../utils/icons";
import "./CreditReminderModals.css";

const defaultFormatCreditDate = (value) => value || "---";
const defaultIsOpenCreditReceivable = (item) => ["open", "partial"].includes(item?.status);

function getVariantClass(variant) {
  return variant === "quote" ? "credit-reminder--quote" : "credit-reminder--admin";
}

export function CreditReminderCreateModal({
  open,
  variant = "admin",
  target,
  form = {},
  visibilityOptions = [],
  visibilityScope,
  onVisibilityScopeChange,
  onFormChange,
  onToggleOrder,
  onClose,
  onSubmit,
  saving,
  minReminderAt,
  formatCreditDate = defaultFormatCreditDate,
  isOpenCreditReceivable = defaultIsOpenCreditReceivable,
}) {
  if (!open) return null;

  const invoices = target?.invoices || [];
  const selectedOrderIds = new Set(form.orderIds || []);
  const hasSelectedCreditOrder = invoices.some(item => (
    item?.order_id
    && selectedOrderIds.has(item.order_id)
    && isOpenCreditReceivable(item)
  ));
  const hasReminderNote = Boolean((form.note || "").trim());
  const hasReminderAt = Boolean((form.remind_at || "").trim());
  const activeVisibilityScope = visibilityScope || form.visibilityScope || "creator";
  const hasValidVisibilityScope = visibilityOptions.length === 0
    || visibilityOptions.some(option => option.value === activeVisibilityScope);
  const canSubmitReminder = hasSelectedCreditOrder && hasReminderNote && hasReminderAt && hasValidVisibilityScope;

  const handleReminderAtChange = (event) => {
    const selectedValue = event.target.value;
    const nextReminderAt = minReminderAt && selectedValue && selectedValue < minReminderAt
      ? minReminderAt
      : selectedValue;

    onFormChange?.(prev => ({ ...prev, remind_at: nextReminderAt }));
  };

  return (
    <div className={`credit-reminder-overlay ${getVariantClass(variant)}`} onClick={event => event.target === event.currentTarget && onClose?.()}>
      <div className="credit-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="credit-reminder-create-title">
        <div className="credit-reminder-header">
          <div>
            <span className="credit-reminder-kicker">Seguimiento personalizado</span>
            <h2 id="credit-reminder-create-title">Crear recordatorio de credito</h2>
          </div>
          <button className="credit-reminder-close" onClick={onClose} aria-label="Cerrar recordatorio">
            <Icons.Close />
          </button>
        </div>

        <div className="credit-reminder-body">
          <div className="credit-reminder-hero">
            <span className="credit-reminder-icon"><Icons.Clock /></span>
            <div>
              <strong>{target?.client?.name || "Cliente sin nombre"}</strong>
              <p>{target?.client?.phone || "Sin telefono"}</p>
            </div>
          </div>

          <label className="credit-reminder-field">
            <span>Fecha y hora del recordatorio</span>
            <input
              type="datetime-local"
              value={form.remind_at || ""}
              min={minReminderAt || undefined}
              onChange={handleReminderAtChange}
              required
              aria-required="true"
            />
            <small>Selecciona una fecha futura antes de continuar.</small>
          </label>

          <div className="credit-reminder-section">
            <span className="credit-reminder-section-title">Facturas asociadas</span>
            <div className="credit-reminder-invoices">
              {invoices.map((item) => (
                <label key={item.id || item.order_id} className="credit-reminder-invoice">
                  <input
                    type="checkbox"
                    checked={selectedOrderIds.has(item.order_id)}
                    onChange={() => onToggleOrder?.(item.order_id)}
                    disabled={!item.order_id || !isOpenCreditReceivable(item)}
                  />
                  <div>
                    <strong>{item.invoiceNumber || "---"}</strong>
                    <span>Orden {item.order_id?.slice(0, 8) || "---"} - {formatCreditDate(item.creditIssuedAt)}</span>
                  </div>
                </label>
              ))}
              {invoices.length === 0 && (
                <div className="credit-reminder-empty">No hay facturas a credito disponibles para este recordatorio.</div>
              )}
            </div>
            {!hasSelectedCreditOrder && (
              <small className="credit-reminder-help">Los recordatorios personalizados solo pueden crearse para ordenes a credito.</small>
            )}
          </div>

          {visibilityOptions.length > 0 && (
            <div className="credit-reminder-section">
              <span className="credit-reminder-section-title">Visibilidad del recordatorio</span>
              <div className="credit-reminder-visibility-options">
                {visibilityOptions.map((option) => (
                  <label
                    key={option.value}
                    className={`credit-reminder-visibility-option ${activeVisibilityScope === option.value ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="credit-reminder-visibility"
                      value={option.value}
                      checked={activeVisibilityScope === option.value}
                      onChange={() => {
                        onVisibilityScopeChange?.(option.value);
                        onFormChange?.(prev => ({ ...prev, visibilityScope: option.value }));
                      }}
                    />
                    <div>
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="credit-reminder-field">
            <span>Nota u observacion</span>
            <textarea
              rows={3}
              value={form.note || ""}
              onChange={(event) => onFormChange?.(prev => ({ ...prev, note: event.target.value }))}
              placeholder="Ej. Llamar para confirmar pago acordado."
              required
              aria-required="true"
            />
            <small>Describe la razon del recordatorio antes de continuar.</small>
          </label>

          <div className="credit-reminder-actions">
            <button className="credit-reminder-btn credit-reminder-btn--secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className="credit-reminder-btn credit-reminder-btn--primary" onClick={onSubmit} disabled={saving || !canSubmitReminder}>
              {saving ? "Guardando..." : "Guardar recordatorio"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CreditCustomReminderDueModal({
  open,
  variant = "admin",
  reminders = [],
  completingId,
  onClose,
  onAcknowledge,
  onReview,
  formatCreditDate = defaultFormatCreditDate,
}) {
  if (!open) return null;

  return (
    <div className={`credit-reminder-overlay ${getVariantClass(variant)}`} onClick={event => event.target === event.currentTarget && onClose?.()}>
      <div className="credit-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="credit-reminder-due-title">
        <div className="credit-reminder-header">
          <div>
            <span className="credit-reminder-kicker">Atencion requerida</span>
            <h2 id="credit-reminder-due-title">Recordatorios de credito</h2>
          </div>
          <button className="credit-reminder-close" onClick={onClose} aria-label="Cerrar recordatorios">
            <Icons.Close />
          </button>
        </div>

        <div className="credit-reminder-body">
          <div className="credit-reminder-hero credit-reminder-hero--due">
            <span className="credit-reminder-icon"><Icons.Bell /></span>
            <div>
              <strong>{reminders.length} recordatorio{reminders.length === 1 ? "" : "s"} pendiente{reminders.length === 1 ? "" : "s"}</strong>
              <p>Estos avisos fueron configurados manualmente para seguimiento de creditos.</p>
            </div>
          </div>

          <div className="credit-reminder-due-list">
            {reminders.map((reminder) => (
              <article key={reminder.id} className="credit-reminder-due-card">
                <div className="credit-reminder-due-head">
                  <div>
                    <strong>{reminder.client?.name || "Cliente sin nombre"}</strong>
                    <span>{formatCreditDate(reminder.remind_at)}</span>
                  </div>
                  <span className="credit-reminder-status">Pendiente</span>
                </div>

                {reminder.note && <p>{reminder.note}</p>}

                {reminder.invoices?.length > 0 && (
                  <div className="credit-reminder-due-invoices">
                    {reminder.invoices.slice(0, 4).map((item) => (
                      <span key={item.id || item.order_id}>{item.invoiceNumber || "---"}</span>
                    ))}
                    {reminder.invoices.length > 4 && <span>+{reminder.invoices.length - 4}</span>}
                  </div>
                )}

                <div className="credit-reminder-due-actions">
                  <button className="credit-reminder-btn credit-reminder-btn--secondary credit-reminder-btn--sm" onClick={() => onReview?.(reminder)}>
                    Ver credito
                  </button>
                  <button
                    className="credit-reminder-btn credit-reminder-btn--primary credit-reminder-btn--sm"
                    onClick={() => onAcknowledge?.(reminder.id)}
                    disabled={completingId === reminder.id}
                  >
                    {completingId === reminder.id ? "Guardando..." : "Marcar atendido"}
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="credit-reminder-actions">
            <button className="credit-reminder-btn credit-reminder-btn--secondary" onClick={onClose}>
              Entendido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
