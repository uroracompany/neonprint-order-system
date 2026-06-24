import { useEffect, useState } from "react";
import { Icons } from "../../utils/icons";
import { formatDominicanPhone, normalizeClientPhone, normalizeClientText, searchClients } from "../../utils/clients";
import "./CreateClientModal.css";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "", notes: "" };

export default function CreateClientModal({ open, onClose, onCreated, supabase, userId, initialValues = null }) {
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
          key === "phone" ? formatDominicanPhone(value || "") : value || "",
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

  const validate = () => {
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
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Completa los campos obligatorios para guardar el cliente.");
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});

    try {
      const payload = {
        name: form.name.trim(),
        phone: formatDominicanPhone(form.phone.trim()),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        created_by: userId || null,
      };

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

      const { data, error: insertError } = await supabase
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
    <div className="crm-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="crm-modal" onClick={e => e.stopPropagation()}>
        <div className="crm-stripe" />
        <div className="crm-header">
          <span className="crm-title">Agregar cliente</span>
          <button className="crm-close" onClick={handleClose}><Icons.Close /></button>
        </div>
        <div className="crm-body">
          <div className="crm-subtitle">
            Cliente registrado
            <strong>Nombre y teléfono son obligatorios</strong>
          </div>

          {error && <p className="crm-form-error">{error}</p>}

          <label className="crm-field">
            <span className="crm-field-label">Nombre <strong className="crm-required">*</strong></span>
            <input
              className={`crm-input ${fieldErrors.name ? "has-error" : ""}`}
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="Nombre del cliente"
              autoComplete="name"
              autoFocus
            />
            {fieldErrors.name && <p className="crm-field-error">{fieldErrors.name}</p>}
            {!fieldErrors.name && matchingNameClient && (
              <p className="crm-field-warning">
                Ya existe un cliente con este nombre: {matchingNameClient.name} - {formatDominicanPhone(matchingNameClient.phone) || "sin telefono"}. Puedes continuar si es otra persona.
              </p>
            )}
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Teléfono <strong className="crm-required">*</strong></span>
            <input
              type="tel"
              className={`crm-input ${fieldErrors.phone ? "has-error" : ""}`}
              value={form.phone}
              onChange={e => set("phone", formatDominicanPhone(e.target.value))}
              placeholder="809-555-1234"
              maxLength="12"
              autoComplete="tel"
            />
            {fieldErrors.phone && <p className="crm-field-error">{fieldErrors.phone}</p>}
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Correo <span className="crm-optional">Opcional</span></span>
            <input
              type="email"
              className="crm-input"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="cliente@empresa.com"
              autoComplete="email"
            />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Dirección <span className="crm-optional">Opcional</span></span>
            <input
              className="crm-input"
              value={form.address}
              onChange={e => set("address", e.target.value)}
              placeholder="Dirección opcional"
              autoComplete="street-address"
            />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Notas <span className="crm-optional">Opcional</span></span>
            <textarea
              className="crm-input crm-textarea"
              rows={3}
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Notas internas opcionales"
            />
          </label>
        </div>
        <div className="crm-footer">
          <button className="crm-btn crm-btn-secondary" onClick={handleClose}>Cancelar</button>
          <button className="crm-btn crm-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : "Agregar cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}
