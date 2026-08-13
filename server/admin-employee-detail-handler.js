import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import {
  getSupabaseAdminEnv,
  isMissingEmailColumnError,
  jsonResponse,
  normalizeUserProfile,
} from "./admin-user-utils.js";
import {
  PRODUCTION_ROLE_AREAS,
  applyEmployeeOrderAssignmentFilter,
  applyEmployeeOrderFilters,
  emptyEmployeeMetrics,
  isMissingColumnOrRelationError,
  isProductionEmployeeRole,
  normalizeAdminOrder,
} from "./admin-employee-utils.js";

const ORDER_PAGE_SIZE_DEFAULT = 7;
const ORDER_PAGE_SIZE_MAX = 50;
const COMPLETED_STATUS = "in_Completed";
const DELIVERED_STATUS = "in_Delivered";
const CANCELLED_STATUS = "cancelled";

const clampPageSize = (value) => {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return ORDER_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(size, 1), ORDER_PAGE_SIZE_MAX);
};

const resolveMonthBounds = (nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  return {
    from: new Date(safeNow.getFullYear(), safeNow.getMonth(), 1).toISOString(),
    to: new Date(safeNow.getFullYear(), safeNow.getMonth() + 1, 1).toISOString(),
  };
};

const calculateFirstTimeRight = (completedCount, reversions) => {
  if (!completedCount) return 100;
  return Math.max(0, +(((completedCount - reversions) / completedCount) * 100).toFixed(1));
};

async function loadEmployeeProfile(supabaseAdmin, userId) {
  let { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,name,email,role,employment_status,created_at")
    .eq("id", userId)
    .single();

  if (isMissingEmailColumnError(error)) {
    const fallback = await supabaseAdmin
      .from("profiles")
      .select("id,name,role,employment_status,created_at")
      .eq("id", userId)
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  return { data, error };
}

const buildStandardOrdersQuery = (supabaseAdmin, userId, role, options = {}) => {
  const {
    select = "*",
    count = "exact",
    head = false,
    filters = {},
    includeLegacyQuoteColumns = true,
  } = options;

  let query = supabaseAdmin.from("orders").select(select, { count, head });
  query = applyEmployeeOrderAssignmentFilter(query, userId, role, { includeLegacyQuoteColumns });
  return applyEmployeeOrderFilters(query, filters);
};

async function executeStandardOrdersQuery(supabaseAdmin, userId, role, options = {}) {
  const first = await buildStandardOrdersQuery(supabaseAdmin, userId, role, {
    ...options,
    includeLegacyQuoteColumns: true,
  });

  if (role === "quote" && isMissingColumnOrRelationError(first.error)) {
    return buildStandardOrdersQuery(supabaseAdmin, userId, role, {
      ...options,
      includeLegacyQuoteColumns: false,
    });
  }

  if (role === "printer" && isMissingColumnOrRelationError(first.error)) {
    return { data: [], error: null, count: 0 };
  }

  return first;
}

async function countStandardOrdersByStatus(supabaseAdmin, userId, role, status = null) {
  const filters = status ? { status } : {};
  const result = await executeStandardOrdersQuery(supabaseAdmin, userId, role, {
    select: "id",
    head: true,
    filters,
  });
  if (result.error) throw result.error;
  return result.count || 0;
}

async function loadStandardOrdersPage(supabaseAdmin, userId, role, { page, pageSize, filters }) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const paged = await buildStandardOrdersQuery(supabaseAdmin, userId, role, {
    filters,
    includeLegacyQuoteColumns: true,
  }).order("created_at", { ascending: false }).range(from, to);

  if (role === "quote" && isMissingColumnOrRelationError(paged.error)) {
    return buildStandardOrdersQuery(supabaseAdmin, userId, role, {
      filters,
      includeLegacyQuoteColumns: false,
    }).order("created_at", { ascending: false }).range(from, to);
  }

  if (role === "printer" && isMissingColumnOrRelationError(paged.error)) {
    return { data: [], error: null, count: 0 };
  }

  return paged;
}

async function loadProductionOrderIds(supabaseAdmin, userId, role) {
  const areaCode = PRODUCTION_ROLE_AREAS[role];
  const [filesResult, assignmentsResult] = await Promise.all([
    supabaseAdmin
      .from("order_production_files")
      .select("order_id")
      .eq("production_area_code", areaCode)
      .or(`assigned_to.eq.${userId},created_by.eq.${userId}`),
    supabaseAdmin
      .from("order_production_assignments")
      .select("order_id")
      .eq("production_area_code", areaCode)
      .eq("assigned_to", userId),
  ]);

  const fileError = filesResult.error && !isMissingColumnOrRelationError(filesResult.error)
    ? filesResult.error
    : null;
  const assignmentError = assignmentsResult.error && !isMissingColumnOrRelationError(assignmentsResult.error)
    ? assignmentsResult.error
    : null;

  if (fileError || assignmentError) {
    throw fileError || assignmentError;
  }

  return [...new Set([
    ...(filesResult.data || []).map((item) => item.order_id).filter(Boolean),
    ...(assignmentsResult.data || []).map((item) => item.order_id).filter(Boolean),
  ])];
}

const buildProductionOrdersQuery = (supabaseAdmin, orderIds, options = {}) => {
  const {
    select = "*",
    count = "exact",
    head = false,
    filters = {},
  } = options;

  if (!orderIds.length) return null;
  let query = supabaseAdmin.from("orders").select(select, { count, head }).in("id", orderIds);
  return applyEmployeeOrderFilters(query, filters);
};

async function countProductionOrdersByStatus(supabaseAdmin, orderIds, status = null) {
  if (!orderIds.length) return 0;
  const filters = status ? { status } : {};
  const { count, error } = await buildProductionOrdersQuery(supabaseAdmin, orderIds, {
    select: "id",
    head: true,
    filters,
  });
  if (error) throw error;
  return count || 0;
}

async function loadProductionOrdersPage(supabaseAdmin, orderIds, { page, pageSize, filters }) {
  if (!orderIds.length) return { data: [], error: null, count: 0 };
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return buildProductionOrdersQuery(supabaseAdmin, orderIds, { filters })
    .order("created_at", { ascending: false })
    .range(from, to);
}

async function buildOrderMetrics({ supabaseAdmin, userId, role, productionOrderIds = [] }) {
  const counter = isProductionEmployeeRole(role)
    ? (status) => countProductionOrdersByStatus(supabaseAdmin, productionOrderIds, status)
    : (status) => countStandardOrdersByStatus(supabaseAdmin, userId, role, status);

  const [total, completed, delivered, cancelled] = await Promise.all([
    counter(null),
    counter(COMPLETED_STATUS),
    counter(DELIVERED_STATUS),
    counter(CANCELLED_STATUS),
  ]);

  return {
    total_orders: total,
    active_orders: Math.max(0, total - completed - delivered - cancelled),
    completed_orders: completed,
    delivered_orders: delivered,
    cancelled_orders: cancelled,
  };
}

async function buildProductionMetrics(supabaseAdmin, userId, role, env) {
  if (!isProductionEmployeeRole(role)) return null;

  const areaCode = PRODUCTION_ROLE_AREAS[role];
  const { from, to } = resolveMonthBounds(env.now);
  const { data, error } = await supabaseAdmin
    .from("order_production_files")
    .select("id, order_id, production_area_code, status, started_at, in_termination_at, completed_at, created_at")
    .eq("production_area_code", areaCode)
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .gte("created_at", from)
    .lt("created_at", to);

  if (error && !isMissingColumnOrRelationError(error)) throw error;

  const files = data || [];
  const completed = files.filter((file) => file.status === "completed");
  const inProduction = files.filter((file) => file.status === "in_production");
  const inTermination = files.filter((file) => file.status === "in_termination");
  const pending = files.filter((file) => file.status === "pending");
  const reversions = files.filter((file) => file.status === "in_production" && file.in_termination_at).length;

  const completedTimes = completed
    .filter((file) => file.started_at && file.completed_at)
    .map((file) => (new Date(file.completed_at) - new Date(file.started_at)) / 86400000)
    .filter((value) => Number.isFinite(value));
  const avgTime = completedTimes.length > 0
    ? +(completedTimes.reduce((sum, value) => sum + value, 0) / completedTimes.length).toFixed(1)
    : 0;
  const periodDays = Math.max(1, (new Date(to) - new Date(from)) / 86400000);
  const filesPerDay = +(completed.length / periodDays).toFixed(2);
  const firstTimeRight = calculateFirstTimeRight(completed.length, reversions);
  const efficiencyScore = Math.min(100, Math.round(
    Math.min(filesPerDay * 20, 40) +
    Math.min(firstTimeRight * 0.3, 30) +
    Math.min(avgTime > 0 ? Math.max(0, 30 - avgTime * 3) : 15, 30)
  ));

  return {
    total_files: files.length,
    completed: completed.length,
    in_production: inProduction.length,
    in_termination: inTermination.length,
    pending: pending.length,
    avg_time_days: avgTime,
    reversions,
    reversion_rate: files.length > 0 ? +((reversions / files.length) * 100).toFixed(1) : 0,
    files_per_day: filesPerDay,
    first_time_right: firstTimeRight,
    efficiency_score: efficiencyScore,
    alerts: [],
  };
}

export async function handleAdminEmployeeDetail(payload = {}, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
  }

  const userId = String(payload?.userId || payload?.employeeId || "").trim();
  if (!userId) {
    return jsonResponse(400, { error: "El ID del empleado es obligatorio." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: profileData, error: profileError } = await loadEmployeeProfile(supabaseAdmin, userId);
  if (profileError || !profileData) {
    return jsonResponse(404, {
      error: "No se encontro el perfil del empleado.",
    });
  }

  const profile = normalizeUserProfile(profileData);
  const role = profile.role;
  const page = Math.max(Number.parseInt(payload?.page, 10) || 1, 1);
  const pageSize = clampPageSize(payload?.pageSize);
  const filters = {
    status: payload?.status || "all",
    paymentStatus: payload?.paymentStatus || payload?.payment_status || "all",
    search: payload?.search || "",
  };

  try {
    const productionOrderIds = isProductionEmployeeRole(role)
      ? await loadProductionOrderIds(supabaseAdmin, userId, role)
      : [];

    const [metrics, productionMetrics, ordersResult] = await Promise.all([
      buildOrderMetrics({ supabaseAdmin, userId, role, productionOrderIds }),
      buildProductionMetrics(supabaseAdmin, userId, role, env),
      isProductionEmployeeRole(role)
        ? loadProductionOrdersPage(supabaseAdmin, productionOrderIds, { page, pageSize, filters })
        : loadStandardOrdersPage(supabaseAdmin, userId, role, { page, pageSize, filters }),
    ]);

    if (ordersResult.error) {
      return jsonResponse(400, {
        error: "No se pudieron cargar las ordenes del empleado.",
        code: "EMPLOYEE_ORDERS_LOOKUP_FAILED",
      });
    }

    return jsonResponse(200, {
      profile,
      metrics: metrics || emptyEmployeeMetrics(),
      productionMetrics,
      orders: Array.isArray(ordersResult.data) ? ordersResult.data.map(normalizeAdminOrder) : [],
      page,
      pageSize,
      total: ordersResult.count || 0,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: "No se pudo calcular el detalle del empleado.",
      code: "EMPLOYEE_DETAIL_FAILED",
    });
  }
}
