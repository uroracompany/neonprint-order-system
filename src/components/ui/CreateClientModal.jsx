import { useEffect, useState } from "react";
import { Icons } from "../../utils/icons";
import { Modal, Field } from "../orders/CreateOrderModal";
import {
  formatPhone,
  normalizeClientPhone,
  normalizeClientText,
  searchClients,
  validateClientForm,
} from "../../utils/clients";
import "./CreateClientModal.css";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "", notes: "" };

export default function CreateClientModal({ open, onClose, onCreated, supabase, userId, initialValues = null, createWithSemiAdminCommand = false }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [matchingNameClient, setMatchingNameClient] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY_FORM,
      ...Object.fromEntries(
        Object.entries(initialValues || {}).map(([key, value]) => [
          key,
          key === "phone" ? formatPhone(value || "") : value || "",
        ])
      ),
    });
    setError("");
    setFieldErrors({});
    setMatchingNameClient(null);
  }, [initialValues, open]);

  useEffect(() => {
    if (!open) return undefined;

    const normalizedName = normalizeClientText(form.name);
    if (normalizedName.length < 2) {
      setMatchingNameClient(null);
      return undefined;
    }

    let active = true;
    const timeout = setTimeout(async () => {
      try {
        const matches = await searchClients(supabase, form.name, 10);
        if (!active) return;

        const exactMatch = matches.find((client) => normalizeClientText(client?.name) === normalizedName) || null;
        setMatchingNameClient(exactMatch);
      } catch (err) {
        if (active) {
          console.warn("No se pudo validar el nombre del cliente:", err?.message || err);
          setMatchingNameClient(null);
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [form.name, open, supabase]);

  if (!open) return null;

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    if (fieldErrors[k]) setFieldErrors(p => ({ ...p, [k]: "" }));
    if (error) setError("");
  };

  const _validate = () => {
    const errors = {};
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) errors.name = "Escribe el nombre del cliente.";
    else if (name.length < 2) errors.name = "El nombre debe tener al menos 2 caracteres.";
    if (!phone) errors.phone = "Escribe el número de teléfono del cliente.";
    else if (phone.length < 3) errors.phone = "El teléfono debe tener al menos 3 caracteres.";
    return errors;
  };

  const handleSubmit = async () => {
    const { payload, errors } = validateClientForm(form, {
      userId,
      includeCreatedBy: !createWithSemiAdminCommand,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Completa los campos obligatorios para guardar el cliente.");
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});

    try {
      const phoneDigits = normalizeClientPhone(payload.phone);
      if (phoneDigits.length >= 3) {
        const existingClients = await searchClients(supabase, payload.phone, 10);
        const existingClient = existingClients.find(client => normalizeClientPhone(client.phone) === phoneDigits);

        if (existingClient) {
          setForm(EMPTY_FORM);
          await onCreated?.(existingClient, { reusedExisting: true });
          onClose();
          return;
        }
      }

      const { data, error: insertError } = createWithSemiAdminCommand
        ? await supabase.rpc("semi_admin_create_client", {
          p_client: {
            name: payload.name,
            phone: payload.phone,
            email: payload.email,
            address: payload.address,
            notes: payload.notes,
          },
        })
        : await supabase
          .from("clients")
          .insert(payload)
          .select()
          .single();

      if (insertError) throw insertError;

      setForm(EMPTY_FORM);
      await onCreated?.(data, { reusedExisting: false });
      onClose();
    } catch (err) {
      setError(err.message || "No se pudo guardar el cliente.");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setError("");
    setFieldErrors({});
    setMatchingNameClient(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Agregar cliente"
      hideStripe
      className="ps-file-details-modal"
      headerContent={
        <h3 className="ps-file-details-title">Agregar cliente</h3>
      }
      footer={
        <div className="pq-dialog-actions">
          <button type="button" className="pq-btn pq-btn-secondary" onClick={handleClose} disabled={saving}>Cancelar</button>
          <button type="button" className="pq-btn pq-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : <><Icons.Plus /> Agregar cliente</>}
          </button>
        </div>
      }
    >
      <div className="ps-file-details-content">
        {error && <p className="ps-form-error-banner" role="alert">{error}</p>}

        <Field label="Nombre" required error={fieldErrors.name}>
          <input
            className="ps-form-input"
            value={form.name}
            onChange={e => set("name", e.target.value)}
            placeholder="Nombre del cliente"
            autoComplete="name"
            autoFocus
          />
          {!fieldErrors.name && matchingNameClient && (
            <p className="crm-field-warning">
              Ya existe un cliente con este nombre: {matchingNameClient.name} - {formatPhone(matchingNameClient.phone) || "sin telefono"}. Puedes continuar si es otra persona.
            </p>
          )}
        </Field>

        <Field label="Teléfono" required error={fieldErrors.phone}>
          <input
            type="tel"
            className="ps-form-input"
            value={form.phone}
            onChange={e => set("phone", formatPhone(e.target.value))}
            placeholder="+1 555 123 4567"
            autoComplete="tel"
          />
        </Field>

        <Field label="Correo" optional>
          <input
            type="email"
            className="ps-form-input"
            value={form.email}
            onChange={e => set("email", e.target.value)}
            placeholder="cliente@empresa.com"
            autoComplete="email"
          />
        </Field>

        <Field label="Dirección" optional>
          <input
            className="ps-form-input"
            value={form.address}
            onChange={e => set("address", e.target.value)}
            placeholder="Dirección opcional"
            autoComplete="street-address"
          />
        </Field>

        <Field label="Notas" optional>
          <textarea
            className="ps-form-input ps-termination-custom-textarea"
            rows={3}
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            placeholder="Notas internas opcionales"
          />
        </Field>
      </div>
    </Modal>
  );
}
