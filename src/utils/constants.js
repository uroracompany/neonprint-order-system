// LISTADO DE CONSTANTES Y CONFIGURACIONES PARA LA APLICACIÓN DE GESTIÓN DE ÓRDENES DE NEONPRINT

// Opciones de materiales disponibles para las órdenes
export const MATERIAL_OPTIONS =["Vinilo", "Banner", "Lona", "Papel Fotografico", "Carton", "Adhesivo", "PVC", "Acrilico", "Tela", "Foam", "Otro"];

/* Valores de estado de orden estandarizados para toda la aplicación
estos valores son usados en la base de datos, lógica de negocio y para normalizar entradas de usuario (alias) */
export const ORDER_STATUS = {
  PENDING: "Pending",
  IN_DESIGN: "in_Design",
  IN_QUOTE: "in_Quote",
  IN_PRODUCTION: "in_Production",
  IN_TERMINATION: "in_Termination",
  IN_COMPLETED: "in_Completed",
  IN_DELIVERED: "in_Delivered",
  CANCELLED: "cancelled",
};

export const PAYMENT_STATUS = {
  PENDING: "Pending_Payment",
  PARTIAL: "parcial",
  PAID: "pagado",
};

export const PRODUCTION_AREAS = [
  { code: "digital", label: "Digital", role: "digital_producer" },
  { code: "dtf", label: "DTF", role: "dtf_producer" },
  { code: "ploteo", label: "Ploteo", role: "ploteo_producer" },
];

export const PRODUCTION_AREA_ROLES = PRODUCTION_AREAS.reduce((acc, area) => {
  acc[area.role] = area.code;
  return acc;
}, {});

export const PRODUCTION_AREA_LABELS = PRODUCTION_AREAS.reduce((acc, area) => {
  acc[area.code] = area.label;
  return acc;
}, {});

export const PRODUCTION_FILE_STATUS = {
  PENDING: "pending",
  IN_PRODUCTION: "in_production",
  IN_TERMINATION: "in_termination",
  COMPLETED: "completed",
};

export const PRODUCTION_FILE_STATUS_LABELS = {
  [PRODUCTION_FILE_STATUS.PENDING]: "Pendiente",
  [PRODUCTION_FILE_STATUS.IN_PRODUCTION]: "En produccion",
  [PRODUCTION_FILE_STATUS.IN_TERMINATION]: "En terminacion",
  [PRODUCTION_FILE_STATUS.COMPLETED]: "Completado",
};

export const getProductionAreaForRole = (role) => PRODUCTION_AREA_ROLES[String(role || "").trim()] || null;
export const isProductionRole = (role) => Boolean(getProductionAreaForRole(role));
export const getProductionAreaLabel = (code) => PRODUCTION_AREA_LABELS[code] || "Sin clasificar";


/* Mapeo de alias para estados de orden, 
permite normalizar entradas de usuario en diferentes idiomas o formatos a los valores estandarizados definidos en ORDER_STATUS.
y permite manejrar estados unicos y especificos en la base de dtos, mientras se acepta una variedad de términos comunes para cada estado en la interfaz de usuario.*/
export const ORDER_STATUS_ALIASES = {
  pending: ORDER_STATUS.PENDING,
  pendiente: ORDER_STATUS.PENDING,
  in_design: ORDER_STATUS.IN_DESIGN,
  "in design": ORDER_STATUS.IN_DESIGN,
  diseño: ORDER_STATUS.IN_DESIGN,
  diseno: ORDER_STATUS.IN_DESIGN,
  in_quote: ORDER_STATUS.IN_QUOTE,
  in_quotation: ORDER_STATUS.IN_QUOTE,
  cotizacion: ORDER_STATUS.IN_QUOTE,
  cotización: ORDER_STATUS.IN_QUOTE,
  quote: ORDER_STATUS.IN_QUOTE,
  "en produccion": ORDER_STATUS.IN_PRODUCTION,
  "en producción": ORDER_STATUS.IN_PRODUCTION,
  produccion: ORDER_STATUS.IN_PRODUCTION,
  producción: ORDER_STATUS.IN_PRODUCTION,
  in_production: ORDER_STATUS.IN_PRODUCTION,
  terminacion: ORDER_STATUS.IN_TERMINATION,
  terminación: ORDER_STATUS.IN_TERMINATION,
  in_termination: ORDER_STATUS.IN_TERMINATION,
  "en entrega": ORDER_STATUS.IN_DELIVERED,
  entregado: ORDER_STATUS.IN_DELIVERED,
  entregada: ORDER_STATUS.IN_DELIVERED,
  in_delivered: ORDER_STATUS.IN_DELIVERED,
  completada: ORDER_STATUS.IN_COMPLETED,
  completado: ORDER_STATUS.IN_COMPLETED,
  completed: ORDER_STATUS.IN_COMPLETED,
  in_completed: ORDER_STATUS.IN_COMPLETED,
  cancelada: ORDER_STATUS.CANCELLED,
  cancelado: ORDER_STATUS.CANCELLED,
  cancelled: ORDER_STATUS.CANCELLED,
};

// Función para normalizar el estado de orden, convierte cualquier alias o formato a los valores estandarizados definidos en ORDER_STATUS
export const normalizeOrderStatus = (value) => {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  return ORDER_STATUS_ALIASES[rawValue.toLowerCase()] || rawValue;
};

// Funciones de utilidad para validar estados de orden, usadas en validaciones de formularios, lógica de negocio y componentes de UI
export const isOrderStatus = (value, expectedStatus) => normalizeOrderStatus(value) === expectedStatus;
export const isOrderStatusIn = (value, expectedStatuses) => expectedStatuses.includes(normalizeOrderStatus(value));

// Lista completa de estados de orden para uso en filtros, validaciones y lógica de negocio
export const STATUS_OPTIONS = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_DESIGN,
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
  ORDER_STATUS.CANCELLED,
];

// Estados que representan cualquier fase activa del flujo de trabajo, usados para filtrar órdenes activas en vistas generales
export const ACTIVE_WORKFLOW_STATUSES = [
  ORDER_STATUS.IN_DESIGN,
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
];

// Estados que representan la fase de cotización, usados para filtrar órdenes en la vista de cotización
export const QUOTE_STATUS_OPTIONS = [
  ORDER_STATUS.IN_DESIGN,
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.IN_COMPLETED,
];

// Estados que representan la fase de producción, usados para filtrar órdenes en la vista de producción y para validar transiciones de estado relacionadas con la producción
export const PRODUCTION_STATUS_OPTIONS = [
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
];

// Estados que representan la fase de producción, usados para filtrar órdenes en la vista de producción y para validar transiciones de estado
export const PRODUCTION_TRACKING_STATUS_OPTIONS = [
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
];

// Estados que representan la fase de entrega, usados para filtrar órdenes en la vista de entrega y para validar transiciones de estado relacionadas con la entrega
export const DELIVERY_STATUS_OPTIONS = [
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
];

export const PAYMENT_STATUS_ALIASES = {
  pending_payment: PAYMENT_STATUS.PENDING,
  "pending payment": PAYMENT_STATUS.PENDING,
  pendiente: PAYMENT_STATUS.PENDING,
  parcial: PAYMENT_STATUS.PARTIAL,
  partial: PAYMENT_STATUS.PARTIAL,
  pagado: PAYMENT_STATUS.PAID,
  paid: PAYMENT_STATUS.PAID,
};

export const normalizePaymentStatus = (value) => {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  return PAYMENT_STATUS_ALIASES[rawValue.toLowerCase()] || rawValue;
};

export const isPaymentStatus = (value, expectedStatus) => normalizePaymentStatus(value) === expectedStatus;

export const PAYMENT_OPTIONS = [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIAL, PAYMENT_STATUS.PAID];

export const UI_TERMS = {
  cotizacion: "Caja",
  delivery: "Entrega",
};

const UI_TERM_REPLACEMENTS = [
  [/\bCotización\b/g, UI_TERMS.cotizacion],
  [/\bCotizacion\b/g, UI_TERMS.cotizacion],
  [/\bcotización\b/g, UI_TERMS.cotizacion],
  [/\bcotizacion\b/g, UI_TERMS.cotizacion],
  [/\bCotizador(?:a|es|as)?\b/g, "Responsable de caja"],
  [/\bcotizador(?:a|es|as)?\b/g, "responsable de caja"],
  [/\bQuote\b/g, UI_TERMS.cotizacion],
  [/\bquote\b/g, UI_TERMS.cotizacion],
  [/\bDelivery\b/g, UI_TERMS.delivery],
  [/\bdelivery\b/g, UI_TERMS.delivery],
  [/\bEntregador(?:a|es|as)?\b/g, UI_TERMS.delivery],
  [/\bentregador(?:a|es|as)?\b/g, UI_TERMS.delivery.toLowerCase()],
  [/\bRepartidor(?:a|es|as)?\b/g, UI_TERMS.delivery],
  [/\brepartidor(?:a|es|as)?\b/g, UI_TERMS.delivery.toLowerCase()],
];

export const formatUiTerms = (value) => {
  if (typeof value !== "string") return value;
  return UI_TERM_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  );
};

export const STATUS_LABELS = {
  [ORDER_STATUS.PENDING]: "Pendiente",
  [ORDER_STATUS.IN_DESIGN]: "Diseño",
  [ORDER_STATUS.IN_QUOTE]: UI_TERMS.cotizacion,
  [ORDER_STATUS.IN_PRODUCTION]: "Producción",
  [ORDER_STATUS.IN_TERMINATION]: "Terminación",
  [ORDER_STATUS.IN_DELIVERED]: "Entregado",
  [ORDER_STATUS.IN_COMPLETED]: "Completada",
  [ORDER_STATUS.CANCELLED]: "Cancelada",
};

// Etiquetas legibles para estados de pago, mapeados a los valores de PAYMENT_OPTIONS
export const PAYMENT_LABELS = {
  [PAYMENT_STATUS.PENDING]: "Pendiente",
  [PAYMENT_STATUS.PARTIAL]: "Parcial",
  [PAYMENT_STATUS.PAID]: "Pagado",
};

// Campos relevantes para asignación de cotizaciones, usados en lógica de negocio y formularios de asignación
export const QUOTE_ASSIGNMENT_FIELDS = ["quote_id", "quotation_id", "quote_user_id"];

// Flujo de seguimiento para clientes (FlowTrack público) — diseño interno
export const CLIENT_FLOW_STEPS = [
  { key: ORDER_STATUS.PENDING, label: "Pendiente" },
  { key: ORDER_STATUS.IN_DESIGN, label: "Diseño" },
  { key: ORDER_STATUS.IN_QUOTE, label: UI_TERMS.cotizacion },
  { key: ORDER_STATUS.IN_PRODUCTION, label: "Producción" },
  { key: ORDER_STATUS.IN_TERMINATION, label: "Terminación" },
  { key: ORDER_STATUS.IN_COMPLETED, label: "Lista para entrega" },
  { key: ORDER_STATUS.IN_DELIVERED, label: "Entregada" },
];

// Flujo de seguimiento para clientes — diseño externo (salta Diseño)
export const CLIENT_FLOW_STEPS_EXTERNAL = [
  { key: ORDER_STATUS.PENDING, label: "Pendiente" },
  { key: ORDER_STATUS.IN_QUOTE, label: UI_TERMS.cotizacion },
  { key: ORDER_STATUS.IN_PRODUCTION, label: "Producción" },
  { key: ORDER_STATUS.IN_TERMINATION, label: "Terminación" },
  { key: ORDER_STATUS.IN_COMPLETED, label: "Lista para entrega" },
  { key: ORDER_STATUS.IN_DELIVERED, label: "Entregada" },
];

export const CLIENT_STATUS_MAP = {
  [ORDER_STATUS.PENDING]: ORDER_STATUS.PENDING,
  [ORDER_STATUS.IN_DESIGN]: ORDER_STATUS.IN_DESIGN,
  [ORDER_STATUS.IN_QUOTE]: ORDER_STATUS.IN_QUOTE,
  [ORDER_STATUS.IN_PRODUCTION]: ORDER_STATUS.IN_PRODUCTION,
  [ORDER_STATUS.IN_TERMINATION]: ORDER_STATUS.IN_TERMINATION,
  [ORDER_STATUS.IN_DELIVERED]: ORDER_STATUS.IN_DELIVERED,
  [ORDER_STATUS.IN_COMPLETED]: ORDER_STATUS.IN_COMPLETED,
  [ORDER_STATUS.CANCELLED]: null,
};

// Flujo simplificado para vistas Internas (sin diseño, solo etapas clave)
export const FLOW_STEPS = [
  { key: ORDER_STATUS.PENDING, label: "Pendiente" },
  { key: ORDER_STATUS.IN_DESIGN, label: "Diseño" },
  { key: ORDER_STATUS.IN_QUOTE, label: UI_TERMS.cotizacion },
  { key: ORDER_STATUS.IN_PRODUCTION, label: "Producción" },
  { key: ORDER_STATUS.IN_TERMINATION, label: "Terminación" },
  { key: ORDER_STATUS.IN_COMPLETED, label: "Completada" },
  { key: ORDER_STATUS.IN_DELIVERED, label: "Entregado" },
];

// Flujo simplificado para vistas externas (sin diseño, solo etapas clave)
export const FLOW_STEPS_EXTERNAL = [
  { key: ORDER_STATUS.PENDING, label: "Pendiente" },
  { key: ORDER_STATUS.IN_QUOTE, label: UI_TERMS.cotizacion },
  { key: ORDER_STATUS.IN_PRODUCTION, label: "Producción" },
  { key: ORDER_STATUS.IN_TERMINATION, label: "Terminación" },
  { key: ORDER_STATUS.IN_COMPLETED, label: "Completada" },
  { key: ORDER_STATUS.IN_DELIVERED, label: "Entregado" },
];

// Colores y estilos para estados de orden
// Estos colores se muestran en los badges de estado en toda la aplicación
export const STATUS_COLORS = {
  [ORDER_STATUS.PENDING]: { label: "Pendiente", color: "#92620A", bg: "#FEF3C7", dot: "#F59E0B" },
  [ORDER_STATUS.IN_DESIGN]: { label: "Diseño", color: "#5B21B6", bg: "#EDE9FE", dot: "#8B5CF6" },
  [ORDER_STATUS.IN_QUOTE]: { label: UI_TERMS.cotizacion, color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  [ORDER_STATUS.IN_PRODUCTION]: { label: "Producción", color: "#9A3412", bg: "#FFF7ED", dot: "#F97316" },
  [ORDER_STATUS.IN_TERMINATION]: { label: "Terminación", color: "#0369A1", bg: "#E0F2FE", dot: "#0284C7" },
  [ORDER_STATUS.IN_DELIVERED]: { label: "Entregado", color: "#065F46", bg: "#ECFDF5", dot: "#10B981" },
  [ORDER_STATUS.IN_COMPLETED]: { label: "Completada", color: "#14532D", bg: "#DCFCE7", dot: "#22C55E" },
  [ORDER_STATUS.CANCELLED]: { label: "Cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
};

// Obtiene el label legible de un estado de orden (normalizado)
export const getOrderStatusLabel = (value) => STATUS_LABELS[normalizeOrderStatus(value)] || value || "Sin estado";
// Obtiene la configuración de colores para un estado de orden (bg, color, label)
export const getOrderStatusConfig = (value) => STATUS_COLORS[normalizeOrderStatus(value)] || STATUS_COLORS[ORDER_STATUS.PENDING];

// COLORES Y ESTILOS PARA ESTADOS DE PAGO
// Estos colores se muestran en los badges de pago en toda la aplicación
export const PAYMENT_COLORS = {
  [PAYMENT_STATUS.PAID]: { label: "Pagado", color: "#14532D", bg: "#DCFCE7" },
  [PAYMENT_STATUS.PENDING]: { label: "Pago Pendiente", color: "#92620A", bg: "#FEF3C7" },
  [PAYMENT_STATUS.PARTIAL]: { label: "Parcial", color: "#0369A1", bg: "#E0F2FE" },
};

// FUNCIONES UTILIDAD PARA FORMATEO
export const normalizeText = (value) => String(value || "").trim().toLowerCase();
export const formatDate = (value) => value ? new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "Sin fecha";
// Parsea URLs de archivos (puede ser JSON array o string)
export const parseFileUrls = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return String(value).split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  }
};
// Serializa URLs de archivos a JSON string
export const serializeFileUrls = (value) => JSON.stringify(parseFileUrls(value));
// Extrae el nombre de archivo de una URL (sin parámetros de query)
export const getFileNameFromUrl = (value) => {
  if (!value) return "Archivo";
  try {
    return decodeURIComponent(String(value).split("/").pop().split("?")[0]);
  } catch {
    return String(value).split("/").pop() || "Archivo";
  }
};
export const resolveSellerId = (order) => order?.seller_id || order?.created_by || null;
// Determina si una orden puede ser archivada por el admin (debe estar completada o cancelada)
export const isAdminArchivable = (order) => isOrderStatusIn(order?.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED]);
