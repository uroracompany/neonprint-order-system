import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import {
  ADMIN_USER_ROLE_SET,
  getSupabaseAdminEnv,
  isMissingEmailColumnError,
  jsonResponse,
  normalizeUserProfile,
} from "./admin-user-utils.js";

const clampPageSize = (value) => {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return 200;
  return Math.min(Math.max(size, 1), 500);
};

const sanitizeSearch = (value) =>
  String(value || "")
    .replace(/[,%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function handleAdminListUsers(payload = {}, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const page = Math.max(Number.parseInt(payload?.page, 10) || 1, 1);
  const pageSize = clampPageSize(payload?.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const role = String(payload?.role || "all").trim();
  const search = sanitizeSearch(payload?.search);

  let query = supabaseAdmin
    .from("profiles")
    .select("id,name,email,role,employment_status,created_at", { count: "exact" });

  if (role !== "all" && ADMIN_USER_ROLE_SET.has(role)) {
    query = query.eq("role", role);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,role.ilike.%${search}%`);
  }

  let { data, error, count } = await query.order("name", { ascending: true }).range(from, to);

  if (isMissingEmailColumnError(error)) {
    let fallbackQuery = supabaseAdmin
      .from("profiles")
      .select("id,name,role,employment_status,created_at", { count: "exact" });

    if (role !== "all" && ADMIN_USER_ROLE_SET.has(role)) {
      fallbackQuery = fallbackQuery.eq("role", role);
    }

    if (search) {
      fallbackQuery = fallbackQuery.or(`name.ilike.%${search}%,role.ilike.%${search}%`);
    }

    const fallback = await fallbackQuery.order("name", { ascending: true }).range(from, to);
    data = fallback.data;
    error = fallback.error;
    count = fallback.count;
  }

  if (error) {
    return jsonResponse(400, {
      error: `No se pudieron cargar usuarios: ${error.message}`,
    });
  }

  return jsonResponse(200, {
    users: Array.isArray(data) ? data.map((item) => normalizeUserProfile(item)).filter(Boolean) : [],
    page,
    pageSize,
    total: count || 0,
  });
}
