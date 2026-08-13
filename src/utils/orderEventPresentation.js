import {
  STATUS_LABELS,
  getPaymentStatusLabel,
  normalizeOrderStatus,
} from "./constants";

const PAYMENT_FIELDS = new Set(["payment", "payment_status"]);
const STATUS_FIELDS = new Set(["status", "order_status"]);
const ASSIGNMENT_FIELDS = new Set(["assignment", "responsible", "assignee"]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const INTERNAL_VALUE_PATTERN = /^[a-z]+(?:[_-][a-z0-9]+)+$/i;

export const getSafeOrderStatusLabel = (value) => {
  const normalized = normalizeOrderStatus(value);
  return STATUS_LABELS[normalized] || "Estado no disponible";
};

export const getActivityChangeValue = (field, value) => {
  if (value == null || value === "") return "Sin definir";
  if (PAYMENT_FIELDS.has(field)) return getPaymentStatusLabel(value);
  if (STATUS_FIELDS.has(field)) return getSafeOrderStatusLabel(value);

  const text = String(value).trim();
  if (ASSIGNMENT_FIELDS.has(field) && UUID_PATTERN.test(text)) return "Responsable asignado";
  if (UUID_PATTERN.test(text) || INTERNAL_VALUE_PATTERN.test(text)) return "No disponible";
  return text;
};

export const getActivityChangeLabel = (field, label) => (
  String(label || "").trim() || "Campo actualizado"
);
