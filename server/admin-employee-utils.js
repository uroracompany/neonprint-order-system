export const PRODUCTION_ROLE_AREAS = {
  digital_producer: "digital",
  dtf_producer: "dtf",
  ploteo_producer: "ploteo",
};

export const isProductionEmployeeRole = (role) =>
  Boolean(PRODUCTION_ROLE_AREAS[String(role || "").trim()]);

export const isMissingColumnOrRelationError = (error) =>
  error?.code === "42703" ||
  error?.code === "42P01" ||
  /column .* does not exist|relation .* does not exist/i.test(error?.message || "");

export const sanitizeAdminSearch = (value) =>
  String(value || "")
    .replace(/[,%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeAdminOrder = (order) => ({
  ...order,
  is_archived_admin: Boolean(order?.is_archived_admin),
});

export const applyEmployeeOrderAssignmentFilter = (query, userId, role, options = {}) => {
  const normalizedRole = String(role || "").trim();
  const includeLegacyQuoteColumns = options.includeLegacyQuoteColumns !== false;

  if (["seller", "admin"].includes(normalizedRole)) {
    return query.or(`seller_id.eq.${userId},created_by.eq.${userId}`);
  }

  if (normalizedRole === "designer") {
    return query.eq("designer_id", userId);
  }

  if (normalizedRole === "quote") {
    if (includeLegacyQuoteColumns) {
      return query.or(`quote_id.eq.${userId},quotation_id.eq.${userId},quote_user_id.eq.${userId}`);
    }
    return query.eq("quote_id", userId);
  }

  if (normalizedRole === "delivery") {
    return query.eq("delivery_id", userId);
  }

  if (normalizedRole === "printer") {
    return query.eq("production_id", userId);
  }

  return query.eq("id", "__no_employee_role_match__");
};

export const applyEmployeeOrderFilters = (query, filters = {}) => {
  const status = String(filters.status || "all").trim();
  const paymentStatus = String(filters.paymentStatus || "all").trim();
  const search = sanitizeAdminSearch(filters.search);

  let nextQuery = query;

  if (status !== "all") {
    nextQuery = nextQuery.eq("status", status);
  }

  if (paymentStatus !== "all") {
    nextQuery = nextQuery.eq("payment_status", paymentStatus);
  }

  if (search) {
    nextQuery = nextQuery.or(`client_name.ilike.%${search}%,invoice_number.ilike.%${search}%,status.ilike.%${search}%`);
  }

  return nextQuery;
};

export const emptyEmployeeMetrics = () => ({
  total_orders: 0,
  active_orders: 0,
  completed_orders: 0,
  delivered_orders: 0,
  cancelled_orders: 0,
});
