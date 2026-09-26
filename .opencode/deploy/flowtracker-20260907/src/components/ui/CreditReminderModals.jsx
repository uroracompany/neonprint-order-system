import { Icons } from "../../utils/icons";
import "./CreditReminderModals.css";

const defaultFormatCreditDate = (value) => value || "---";
const defaultIsOpenCreditReceivable = (item) => item?.status === "open";

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
  onClose,
  onSubmit,
  saving,
  minReminderAt,
  formatCreditDate = defaultFormatCreditDate,
  isOpenCreditReceivable = defaultIsOpenCreditReceivable,
}) {
  if (!open) return null;

  const invoices = target?.invoices || [];
  const openInvoices = invoices.filter(isOpenCreditReceivable);
  const hasOpenCreditOrders = openInvoices.length > 0;
  const hasReminderNote = Boolean((form.note || "").trim());
  const hasReminderAt = Boolean((form.remind_at || "").trim());
  const activeVisibilityScope = visibilityScope || form.visibilityScope || "creator";
  const hasValidVisibilityScope = visibilityOptions.length === 0
    || visibilityOptions.some(option => option.value === activeVisibilityScope);
  const canSubmitReminder = hasOpenCreditOrders && hasReminderNote && hasReminderAt && hasValidVisibilityScope;

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
            <span className="credit-reminder-section-title">Órdenes pendientes actuales</span>
            <div className="credit-reminder-invoices">
              {openInvoices.map((item) => (
                <div key={item.id || item.order_id} className="credit-reminder-invoice">
                  <div>
                    <strong>{item.invoiceNumber || "---"}</strong>
                    <span>Orden {item.order_id?.slice(0, 8) || "---"} - {formatCreditDate(item.creditIssuedAt)}</span>
                  </div>
                </div>
              ))}
              {openInvoices.length === 0 && (
                <div className="credit-reminder-empty">No hay órdenes disponibles para este recordatorio.</div>
              )}
            </div>
            {!hasOpenCreditOrders && (
              <small className="credit-reminder-help">El cliente ya no tiene órdenes a crédito pendientes.</small>
            )}
            {hasOpenCreditOrders && (
              <small className="credit-reminder-help">El seguimiento pertenece al cliente y siempre usa sus órdenes pendientes actuales.</small>
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
              placeholder="Ej. Llamar para confirmar seguimiento acordado."
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

export function CreditPendingAlertModal({ open, invoiceCount, clientCount, clients = [], saving, onClose, onReview }) {
  if (!open) return null;

  return (
    <div className="credit-reminder-overlay credit-reminder--quote" onClick={event => event.target === event.currentTarget && onClose?.()}>
      <div className="credit-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="credit-pending-alert-title">
        <div className="credit-reminder-header">
          <div>
            <span className="credit-reminder-kicker">Seguimiento de Caja</span>
            <h2 id="credit-pending-alert-title">Créditos pendientes</h2>
          </div>
          <button className="credit-reminder-close" onClick={onClose} aria-label="Cerrar resumen de créditos">
            <Icons.Close />
          </button>
        </div>
        <div className="credit-reminder-body">
          <div className="credit-reminder-hero credit-reminder-hero--due">
            <span className="credit-reminder-icon"><Icons.Receipt /></span>
            <div>
              <strong>{invoiceCount} orden{invoiceCount === 1 ? "" : "es"} pendiente{invoiceCount === 1 ? "" : "s"}</strong>
              <p>{clientCount} cliente{clientCount === 1 ? "" : "s"} tiene{clientCount === 1 ? "" : "n"} crédito abierto.</p>
            </div>
          </div>
          <div className="credit-reminder-section">
            <span className="credit-reminder-section-title">Clientes por revisar</span>
            <div className="credit-reminder-due-list">
              {clients.map(group => (
                <article key={group.client?.id || group.client?.name} className="credit-reminder-due-card">
                  <div className="credit-reminder-due-head">
                    <div>
                      <strong>{group.client?.name || "Cliente sin nombre"}</strong>
                      <span>{group.client?.phone || "Sin teléfono"}</span>
                    </div>
                    <span className="credit-reminder-status">{group.pendingCount} pendiente{group.pendingCount === 1 ? "" : "s"}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <p className="credit-reminder-help">Este resumen se mostrará nuevamente dentro de 30 días mientras existan órdenes pendientes.</p>
          <div className="credit-reminder-actions">
            <button className="credit-reminder-btn credit-reminder-btn--secondary" onClick={onClose} disabled={saving}>
              {saving ? "Guardando..." : "Entendido"}
            </button>
            <button className="credit-reminder-btn credit-reminder-btn--primary" onClick={onReview} disabled={saving}>
              Revisar pendientes
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
