import { Icons } from "./icons";

const PRESENTATION = {
  route_quote: ["Enviar a Caja", "Mover la orden al flujo de Caja", Icons.Money],
  set_quote_assignee: ["Gestionar responsable de Caja", "Asignar, cambiar o quitar responsable", Icons.Users],
  route_sales: ["Regresar a Ventas", "Elegir el vendedor que retomará la orden", Icons.ArrowLeft],
  register_payment: ["Registrar pago", "Registrar o actualizar el pago de la orden", Icons.Receipt],
  route_production: ["Enviar a Producción", "Asignar responsables por área", Icons.Package],
  return_to_quote: ["Regresar a Caja", "Regresar la orden a Caja", Icons.ArrowLeft],
  reassign_production: ["Reasignar Producción", "Cambiar responsables de áreas de Producción", Icons.Users],
  manage_files: ["Gestionar archivos", "Administrar únicamente los archivos permitidos en esta etapa", Icons.File],
  mark_delivered: ["Marcar como entregado", "Pasar la orden a estado Entregado", Icons.CheckCircle],
  return_to_completed: ["Volver a Completado", "Regresar la orden de Entregado a Completado", Icons.ArrowLeft],
  route_design: ["Enviar a Diseño", "Mover la orden al flujo de Diseño", Icons.Brush],
  set_designer_assignee: ["Gestionar diseñador", "Asignar, cambiar o quitar responsable", Icons.Users],
  return_to_design: ["Regresar a Diseño", "Regresar la orden de Caja a Diseño", Icons.ArrowLeft],
  assign_seller: ["Asignar vendedor", "Asignar o cambiar el vendedor responsable", Icons.Users],
  block_order: ["Bloquear temporalmente", "Detener avances mientras se resuelve una incidencia", Icons.AlertCircle],
  update_block: ["Actualizar bloqueo", "Cambiar responsable o fecha estimada", Icons.Clock],
  resume_order: ["Reanudar orden", "Retirar el bloqueo operativo", Icons.CheckCircle],
  set_priority: ["Cambiar prioridad", "Alternar entre orden Normal y 911", Icons.AlertCircle],
  reclassify_design: ["Reclasificar diseño", "Corregir el tipo y su impacto autorizado", Icons.Brush],
  update_requirements: ["Cambiar requisitos", "Registrar una revisión del cliente", Icons.File],
  cancel_order: ["Cancelar orden", "Cancelar con motivo y conservar la etapa de origen", Icons.Trash],
  reopen_cancelled: ["Reabrir orden", "Restaurar la última etapa segura", Icons.ArrowLeft],
  approve_commercial_review: ["Aprobar revisión comercial", "Confirmar la revisión de Caja", Icons.CheckCircle],
};

// These labels are part of the Spanish UI vocabulary.  A legacy or cached
// catalogue can omit accents, but it must not downgrade the visible copy.
const CANONICAL_TITLE_KEYS = new Set(["reassign_production"]);

const ROLE_SELECTOR = {
  quote: { label: "Responsable de Caja", users: "quote", optional: true, hint: "Sin asignar, la orden queda bajo control de Administración." },
  seller: { label: "Vendedor responsable", users: "seller", optional: true, hint: "Sin asignar, la orden queda bajo control de Administración." },
  designer: { label: "Diseñador responsable", users: "designer", optional: false },
};

const DEFAULT_REASONS = [
  ["client_request", "Solicitud del cliente"],
  ["assignment_correction", "Corrección de responsable"],
  ["workflow_correction", "Corrección de flujo"],
  ["quality_rework", "Retrabajo o calidad"],
  ["operational_priority", "Prioridad operativa"],
  ["other", "Otro"],
];

export function getAdminActionPresentation(action = {}) {
  const [fallbackTitle, fallbackDescription, Icon] = PRESENTATION[action.key] || [action.key || "Acción administrativa", "", Icons.Settings];
  return {
    title: CANONICAL_TITLE_KEYS.has(action.key) ? fallbackTitle : action.label || fallbackTitle,
    description: action.description || fallbackDescription,
    Icon,
  };
}

export function getAdminTargetSelector(action = {}) {
  const requirements = action.requirements || {};
  const selector = ROLE_SELECTOR[requirements.target_role];
  if (!selector) return null;
  return {
    ...selector,
    optional: requirements.target_required === false || selector.optional,
    label: requirements.target_label || selector.label,
    hint: requirements.target_hint || selector.hint,
  };
}

export function getAdminReasonOptions(action = {}) {
  const allowed = action.requirements?.reason_categories;
  if (!Array.isArray(allowed) || allowed.length === 0) return DEFAULT_REASONS;
  return DEFAULT_REASONS.filter(([key]) => allowed.includes(key));
}

export function hasAdminCapability(action = {}, capability) {
  const requirements = action.requirements || {};
  return requirements.capability === capability || requirements.capabilities?.includes(capability);
}

export function getAdminOrderActionVisibility({ order, catalog = null } = {}) {
  const allowed = new Set((catalog?.actions || []).map((item) => item.key));
  const hasCatalog = catalog !== null;
  const isBlocked = order?.operational_status === "blocked" || catalog?.operational_status === "blocked";
  const isTerminal = ["cancelled", "in_Delivered"].includes(order?.status);
  return {
    isBlocked,
    edit: !isTerminal && !isBlocked,
    // Advanced Settings is the safe route to resume or update a block.  It is
    // not itself a mutation, so keep it when the catalogue exposes a next
    // step while hiding the direct actions that would be rejected.
    advanced: hasCatalog ? allowed.size > 0 : true,
    payment: !isBlocked && (hasCatalog ? allowed.has("register_payment") : order?.status === "in_Quote"),
    cancel: !isBlocked && (hasCatalog ? allowed.has("cancel_order") : !isTerminal),
  };
}
