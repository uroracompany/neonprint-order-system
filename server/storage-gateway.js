import { createHmac, createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getEnvValue, getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";
import { isAllowedImageFile, validateUploadPolicy } from "../src/utils/fileValidation.js";

const MB = 1024 * 1024;
const DEFAULT_R2_THRESHOLD_MB = 25;
const DEFAULT_SIGNED_URL_TTL = 60 * 10;
const MAX_IMPORTED_URL_BYTES = 4 * MB;
const R2_SCHEME = "r2://";
const SUPABASE_SCHEME = "supabase://";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORDER_ASSIGNMENT_FIELDS = [
  "created_by",
  "seller_id",
  "designer_id",
  "quote_id",
  "production_id",
  "delivery_id",
];

const PRODUCER_AREA_BY_ROLE = {
  digital_producer: "digital",
  dtf_producer: "dtf",
  ploteo_producer: "ploteo",
};

const PREORDER_R2_ROLES = new Set(["admin", "seller", "designer"]);
// Preserve the established explicit Sales safeguard while the more precise
// category/stage policy below is rolled out.  It gives callers the same clear
// response instead of silently broadening the historical quote restriction.
const SELLER_FILE_WRITE_BLOCKED_STATUSES = new Set(["in_Quote"]);
const ORDER_ASSET_BUCKETS = new Set(["order-docs", "order-previews", "payment-invoice"]);
const TERMINAL_ORDER_STATUSES = new Set(["in_Completed", "in_Delivered", "cancelled"]);

const ORDER_FILE_BUCKET_LIMITS = {
  "order-docs": 200 * MB,
  "order-previews": 10 * MB,
  "payment-invoice": 10 * MB,
};

const IMAGE_EXTENSION_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const normalizePath = (path = "") =>
  String(path || "")
    .split("/")
    .filter(Boolean)
    .map(encodeRfc3986)
    .join("/");

const hmac = (key, value, encoding) => createHmac("sha256", key).update(value).digest(encoding);
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

const getSignatureKey = (secretAccessKey, dateStamp, region, service) => {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
};

const formatAmzDate = (date = new Date()) => {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
};

const parseJsonArrayLike = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return String(value)
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const normalizeAssetUrl = (item) => {
  if (!item) return null;
  if (typeof item === "string") return item.trim() || null;
  if (typeof item.url === "string") return item.url.trim() || null;
  return null;
};

const safeFileName = (fileName = "archivo") =>
  String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "") || "archivo";

const getOrderIdFromPath = (path = "") => {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts[0] === "orders" ? parts[1] : parts[0];
};

const isOrderScopedPath = ({ orderId, path }) => (
  Boolean(orderId) &&
  String(path || "").split("/").filter(Boolean).slice(0, 2).join("/") === `orders/${orderId}`
);

const inferCategory = ({ bucket, path, category }) => {
  if (category) return category;
  if (bucket === "payment-invoice") return "payment";
  if (bucket === "order-previews" || /\/preview\//i.test(path)) return "preview";
  if (/\/ref-images\//i.test(path)) return "reference";
  return "design";
};

export const getR2Config = (env = process.env) => {
  const accountId = getEnvValue(env, "R2_ACCOUNT_ID");
  const accessKeyId = getEnvValue(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnvValue(env, "R2_SECRET_ACCESS_KEY");
  const bucket =
    getEnvValue(env, "R2_BUCKET") ||
    getEnvValue(env, "R2_BUCKET_PROD") ||
    getEnvValue(env, "R2_BUCKET_DEV");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return { configured: false };
  }

  return {
    configured: true,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    service: "s3",
  };
};

export const shouldUseR2 = ({ bucket, sizeBytes, env = process.env }) => {
  const provider = String(getEnvValue(env, "STORAGE_PROVIDER") || "supabase").toLowerCase();
  if (provider === "supabase") return false;
  if (bucket !== "order-docs") return false;

  const r2Config = getR2Config(env);
  if (!r2Config.configured) return false;
  if (provider === "r2") return true;

  const thresholdMb = Number(getEnvValue(env, "R2_UPLOAD_THRESHOLD_MB")) || DEFAULT_R2_THRESHOLD_MB;
  return Number(sizeBytes || 0) >= thresholdMb * MB;
};

const getStoragePathFromSupabaseUrl = ({ bucket, url }) => {
  if (!bucket || !url) return null;
  try {
    const parsed = new URL(url);
    const publicPrefix = `/storage/v1/object/public/${bucket}/`;
    const signedPrefix = `/storage/v1/object/sign/${bucket}/`;
    const objectPrefix = `/storage/v1/object/${bucket}/`;
    const matchedPrefix = [publicPrefix, signedPrefix, objectPrefix].find((prefix) =>
      parsed.pathname.includes(prefix)
    );
    if (!matchedPrefix) return null;
    const index = parsed.pathname.indexOf(matchedPrefix);
    return decodeURIComponent(parsed.pathname.slice(index + matchedPrefix.length));
  } catch {
    return null;
  }
};

export const isR2Url = (url = "") => String(url || "").startsWith(R2_SCHEME);
export const isSupabaseAssetRef = (value = "") => String(value || "").startsWith(SUPABASE_SCHEME);

export const buildSupabaseAssetRef = ({ bucket, key }) => `${SUPABASE_SCHEME}${bucket}/${encodeURI(key)}`;

export const parseSupabaseAssetRef = (value = "") => {
  if (!isSupabaseAssetRef(value)) return null;
  const rest = String(value).slice(SUPABASE_SCHEME.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;
  const bucket = rest.slice(0, slashIndex);
  const key = decodeURIComponent(rest.slice(slashIndex + 1));
  if (!ORDER_ASSET_BUCKETS.has(bucket) || !key) return null;
  return { bucket, key };
};

export const parseR2Url = (url = "", { allowedBucket } = {}) => {
  if (!isR2Url(url)) return null;
  const rest = String(url).slice(R2_SCHEME.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;
  const bucket = rest.slice(0, slashIndex);
  const key = decodeURIComponent(rest.slice(slashIndex + 1));
  if (!key || (allowedBucket && bucket !== allowedBucket)) return null;
  return {
    bucket,
    key,
  };
};

export const buildR2Url = ({ bucket, key }) => `${R2_SCHEME}${bucket}/${encodeURI(key)}`;

export const presignR2Url = ({
  method,
  key,
  bucket,
  expiresIn = DEFAULT_SIGNED_URL_TTL,
  downloadName = "archivo",
  contentType = "",
  env = process.env,
}) => {
  const r2 = getR2Config(env);
  if (!r2.configured) {
    throw new Error("Cloudflare R2 no esta configurado en el servidor.");
  }

  const targetBucket = bucket || r2.bucket;
  const { amzDate, dateStamp } = formatAmzDate();
  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/${r2.region}/${r2.service}/aws4_request`;
  const credential = `${r2.accessKeyId}/${credentialScope}`;
  const canonicalUri = `/${normalizePath(targetBucket)}/${normalizePath(key)}`;
  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(Number(expiresIn) || DEFAULT_SIGNED_URL_TTL, 604800))),
    "X-Amz-SignedHeaders": normalizedContentType ? "content-type;host" : "host",
  };

  if (method.toUpperCase() === "GET") {
    params["response-content-disposition"] = `attachment; filename="${safeFileName(downloadName)}"`;
    params["response-content-type"] = "application/octet-stream";
  }

  const canonicalQueryString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([keyName, value]) => `${encodeRfc3986(keyName)}=${encodeRfc3986(value)}`)
    .join("&");

  const canonicalHeaders = [
    ...(normalizedContentType ? [`content-type:${normalizedContentType}`] : []),
    `host:${host}`,
    "",
  ].join("\n");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    params["X-Amz-SignedHeaders"],
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(r2.secretAccessKey, dateStamp, r2.region, r2.service);
  const signature = hmac(signingKey, stringToSign, "hex");
  return `${r2.endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
};

const buildCanonicalQueryString = (params = {}) => Object.entries(params)
  .filter(([, value]) => value !== undefined && value !== null && value !== "")
  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
  .join("&");

const decodeXmlValue = (value = "") => String(value)
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'");

const signedR2Fetch = async ({ method, key = "", bucket, query = {}, env = process.env }) => {
  const r2 = getR2Config(env);
  if (!r2.configured) {
    throw new Error("Cloudflare R2 no esta configurado en el servidor.");
  }

  const targetBucket = bucket || r2.bucket;
  const { amzDate, dateStamp } = formatAmzDate();
  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const normalizedKey = normalizePath(key);
  const canonicalUri = normalizedKey
    ? `/${normalizePath(targetBucket)}/${normalizedKey}`
    : `/${normalizePath(targetBucket)}`;
  const canonicalQueryString = buildCanonicalQueryString(query);
  const payloadHash = sha256Hex("");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const credentialScope = `${dateStamp}/${r2.region}/${r2.service}/aws4_request`;
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(r2.secretAccessKey, dateStamp, r2.region, r2.service);
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(`${r2.endpoint}${canonicalUri}${canonicalQueryString ? `?${canonicalQueryString}` : ""}`, {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 ${method} fallo (${response.status}): ${text || response.statusText}`);
  }

  return response;
};

export const listR2OrderObjects = async ({
  bucket,
  prefix = "orders/",
  continuationToken = "",
  maxKeys = 250,
  env = process.env,
} = {}) => {
  const response = await signedR2Fetch({
    method: "GET",
    bucket,
    query: {
      "list-type": "2",
      "max-keys": String(Math.max(1, Math.min(Number(maxKeys) || 250, 1000))),
      prefix,
      "continuation-token": continuationToken,
    },
    env,
  });
  const xml = await response.text();
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, contents]) => ({
    key: decodeXmlValue(contents.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || ""),
    lastModified: decodeXmlValue(contents.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || ""),
  })).filter((item) => item.key);
  const nextContinuationToken = decodeXmlValue(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || "");

  return { objects, nextContinuationToken: nextContinuationToken || null };
};

const requireAuthenticated = async (authHeader = "", env = process.env) => {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return { authorized: false, response: envResult.error };
  const { supabaseUrl, serviceRoleKey } = envResult;
  const accessToken = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return { authorized: false, response: jsonResponse(401, { error: "Token de autenticacion requerido." }) };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  const user = authData?.user;
  if (authError || !user?.id) {
    return { authorized: false, response: jsonResponse(401, { error: "Tu sesion expiro o no es valida." }) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,name,email,role,employment_status,deleted_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { authorized: false, response: jsonResponse(403, { error: "No se encontro el perfil del usuario." }) };
  }
  if (profile.employment_status === false || profile.deleted_at) {
    return { authorized: false, response: jsonResponse(403, { error: "Tu perfil ya no tiene acceso al sistema." }) };
  }

  return { authorized: true, supabaseAdmin, user, profile };
};

const userCanAccessOrder = async ({ supabaseAdmin, order, userId, role }) => {
  if (!order?.id || !userId) return false;
  if (role === "admin") return true;
  if (ORDER_ASSIGNMENT_FIELDS.some((field) => order[field] === userId)) return true;
  if (role === "delivery" && ["in_Completed", "in_Delivered"].includes(order.status)) return true;

  const areaCode = PRODUCER_AREA_BY_ROLE[role];
  if (!areaCode) return false;

  const { data, error } = await supabaseAdmin
    .from("order_production_files")
    .select("id")
    .eq("order_id", order.id)
    .eq("production_area_code", areaCode)
    .limit(1);

  return !error && Array.isArray(data) && data.length > 0;
};

const loadOrderForAccess = async ({ supabaseAdmin, orderId, userId, role }) => {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    return { error: jsonResponse(404, { error: "No se encontro la orden." }) };
  }

  const allowed = await userCanAccessOrder({ supabaseAdmin, order, userId, role });
  if (!allowed) {
    return { error: jsonResponse(403, { error: "No tienes acceso a esta orden." }) };
  }

  return { order };
};

const validateOrderAssetAction = ({ order, role, category, action }) => {
  if (!order || !role) return jsonResponse(403, { error: "No se pudo validar el acceso al archivo." });
  if (action === "read") return null;
  if (TERMINAL_ORDER_STATUSES.has(order.status) || order.is_archived_admin) {
    return jsonResponse(409, { error: "No se pueden modificar archivos de una orden cerrada o archivada." });
  }
  if (role === "seller" && SELLER_FILE_WRITE_BLOCKED_STATUSES.has(order?.status)) {
    return jsonResponse(409, { error: "No se pueden modificar archivos de una orden en cotizacion." });
  }
  if (order.operational_status === "blocked") {
    return jsonResponse(409, { error: "La orden esta bloqueada. Resuelve el bloqueo antes de modificar archivos." });
  }
  if (role === "admin") return null;
  if (role === "quote") {
    return category === "payment" && order.status === "in_Quote"
      ? null
      : jsonResponse(403, { error: "Caja solo puede administrar comprobantes durante la cotizacion." });
  }
  if (role === "designer") {
    return category !== "payment" && order.status === "in_Design" && order.order_design_type === "INTERNAL_DESING"
      ? null
      : jsonResponse(403, { error: "Diseño solo puede modificar archivos de diseño interno en su etapa." });
  }
  if (role === "seller") {
    const sellerStage = order.status === "Pending" && order.order_design_type === "EXTERNAL_DESING";
    return category !== "payment" && sellerStage
      ? null
      : jsonResponse(403, { error: "Ventas solo puede modificar archivos de diseño externo mientras la orden esta en Ventas." });
  }
  return jsonResponse(403, { error: "Tu rol solo tiene acceso de lectura a los archivos de esta orden." });
};

const buildAssetReference = ({ provider, bucket, objectKey }) => (
  provider === "r2" ? buildR2Url({ bucket, key: objectKey }) : buildSupabaseAssetRef({ bucket, key: objectKey })
);

const reserveOrderAsset = async ({ supabaseAdmin, orderId, provider, bucket, objectKey, fileName, contentType, sizeBytes, category, userId }) => {
  const record = {
    order_id: orderId,
    provider,
    bucket,
    object_key: objectKey,
    original_filename: fileName,
    content_type: contentType,
    size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    category,
    status: "uploading",
    uploaded_by: userId,
  };
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("order_files")
    .select("*")
    .eq("provider", provider)
    .eq("bucket", bucket)
    .eq("object_key", objectKey)
    .maybeSingle();
  if (existingError) return { error: existingError };
  if (existing) {
    if (existing.order_id !== orderId || existing.uploaded_by !== userId || existing.status === "uploaded") {
      return { conflict: true };
    }
    return { fileRecord: existing };
  }
  const { data: fileRecord, error } = await supabaseAdmin.from("order_files").insert(record).select("*").single();
  return { fileRecord, error };
};

// A pre-order object has no order_files row yet.  Reserve it in its own
// server-only table before issuing a signed URL so it remains bound to both
// the authenticated actor and the creation idempotency key.
const reservePreorderAsset = async ({ supabaseAdmin, orderId, idempotencyKey, provider, bucket, objectKey, fileName, contentType, sizeBytes, category, userId }) => {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("order_asset_preupload_reservations")
    .select("*")
    .eq("provider", provider)
    .eq("bucket", bucket)
    .eq("object_key", objectKey)
    .maybeSingle();
  if (existingError) return { error: existingError };
  if (existing) {
    const stillValid = existing.status === "reserved" && new Date(existing.expires_at).getTime() > Date.now();
    if (!stillValid || existing.actor_id !== userId || existing.order_id !== orderId || existing.idempotency_key !== idempotencyKey) {
      return { conflict: true };
    }
    return { reservation: existing };
  }
  const { data: reservation, error } = await supabaseAdmin
    .from("order_asset_preupload_reservations")
    .insert({
      order_id: orderId,
      actor_id: userId,
      idempotency_key: idempotencyKey,
      provider,
      bucket,
      object_key: objectKey,
      original_filename: fileName,
      content_type: contentType,
      size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      category,
      status: "reserved",
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select("*")
    .single();
  return { reservation, error };
};

const collectLegacySupabaseTargets = (order) => {
  const targets = [];
  const addUrl = (bucket, url) => {
    const cleanUrl = normalizeAssetUrl(url);
    if (!cleanUrl || isR2Url(cleanUrl)) return;
    const path = getStoragePathFromSupabaseUrl({ bucket, url: cleanUrl });
    if (path) targets.push({ bucket, path });
  };

  parseJsonArrayLike(order?.order_file_url).forEach((url) => addUrl("order-docs", url));
  parseJsonArrayLike(order?.reference_images).forEach((url) => addUrl("order-docs", url));
  addUrl("order-previews", order?.preview_image);
  addUrl("payment-invoice", order?.invoice_payment);
  return targets;
};

const collectLegacyR2Targets = (order) => {
  const urls = [
    ...parseJsonArrayLike(order?.order_file_url),
    ...parseJsonArrayLike(order?.reference_images),
    order?.preview_image,
    order?.invoice_payment,
  ].map(normalizeAssetUrl).filter(Boolean);

  return urls.map(parseR2Url).filter(Boolean);
};

export const removeSupabaseTargets = async ({ supabaseAdmin, targets }) => {
  let removed = 0;
  const errors = [];
  const grouped = new Map();

  targets.forEach((target) => {
    if (!target?.bucket || !target?.path) return;
    if (!grouped.has(target.bucket)) grouped.set(target.bucket, new Set());
    grouped.get(target.bucket).add(target.path);
  });

  for (const [bucket, pathSet] of grouped) {
    const paths = [...pathSet];
    if (!paths.length) continue;
    const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (error) {
      errors.push({ provider: "supabase", bucket, paths, message: error.message });
    } else {
      removed += paths.length;
    }
  }

  return { removed, errors };
};

const storagePrefixesForOrder = (orderId) => [
  { bucket: "order-docs", prefix: `orders/${orderId}/files` },
  { bucket: "order-docs", prefix: `orders/${orderId}/ref-images` },
  { bucket: "order-previews", prefix: `orders/${orderId}/preview` },
  { bucket: "payment-invoice", prefix: orderId },
];

export const removeSupabasePrefix = async ({ supabaseAdmin, bucket, prefix }) => {
  const limit = 1000;
  let removed = 0;
  const errors = [];

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(prefix, {
        limit,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      errors.push({ provider: "supabase", bucket, prefix, message: error.message });
      break;
    }

    const items = data || [];
    const paths = items
      .filter((item) => item?.name && item.name !== ".emptyFolderPlaceholder")
      .map((item) => `${prefix}/${item.name}`);

    if (paths.length > 0) {
      const { error: removeError } = await supabaseAdmin.storage.from(bucket).remove(paths);
      if (removeError) {
        errors.push({ provider: "supabase", bucket, prefix, message: removeError.message });
        break;
      }
      removed += paths.length;
    }

    if (items.length < limit) break;
  }

  return { removed, errors };
};

const removeSupabasePrefixesForOrder = async ({ supabaseAdmin, orderId }) => {
  let removed = 0;
  const errors = [];

  for (const target of storagePrefixesForOrder(orderId)) {
    const result = await removeSupabasePrefix({ supabaseAdmin, ...target });
    removed += result.removed;
    errors.push(...result.errors);
  }

  return { removed, errors };
};

export const removeR2Targets = async ({ targets, env = process.env }) => {
  let removed = 0;
  const errors = [];
  const r2 = getR2Config(env);
  const deduped = new Map();

  targets.forEach((target) => {
    const key = target?.object_key || target?.key;
    if (!key) return;
    const bucket = target?.bucket || r2.bucket;
    deduped.set(`${bucket}:${key}`, { bucket, key });
  });

  if (!deduped.size) return { removed, errors };
  if (!r2.configured) {
    return {
      removed,
      errors: [...deduped.values()].map(({ bucket, key }) => ({
        provider: "r2",
        bucket,
        key,
        message: "R2 no esta configurado.",
      })),
    };
  }

  for (const { bucket, key } of deduped.values()) {
    try {
      await signedR2Fetch({ method: "DELETE", bucket, key, env });
      removed += 1;
    } catch (error) {
      errors.push({ provider: "r2", bucket, key, message: error?.message || "No se pudo borrar en R2." });
    }
  }

  return { removed, errors };
};

const buildR2UploadResponse = ({ bucket, key, contentType, fileRecord = null, shouldRegister = true, preorder = null, env = process.env }) => ({
  provider: "r2",
  shouldRegister,
  upload: {
    method: "PUT",
    url: presignR2Url({
      method: "PUT",
      bucket,
      key,
      contentType,
      expiresIn: DEFAULT_SIGNED_URL_TTL,
      env,
    }),
    headers: contentType ? { "Content-Type": String(contentType).trim().toLowerCase() } : {},
  },
  storedUrl: buildR2Url({ bucket, key }),
  file: fileRecord,
  ...(preorder ? { preorder } : {}),
});

const isPrivateAddress = (address = "") => {
  const ipVersion = isIP(address);
  if (!ipVersion) return false;

  if (ipVersion === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    );
  }

  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
};

const assertSafeRemoteUrl = async (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("URL de imagen invalida.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Solo se permiten imagenes remotas http/https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("No se permiten URLs locales.");
  }

  if (isPrivateAddress(hostname)) {
    throw new Error("No se permiten URLs privadas o locales.");
  }

  const addresses = await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("No se permiten URLs privadas o locales.");
  }

  return parsed;
};

const fetchRemoteImage = async (url, redirectCount = 0) => {
  if (redirectCount > 3) throw new Error("La URL remota redirige demasiadas veces.");
  const parsed = await assertSafeRemoteUrl(url);

  const response = await fetch(parsed.toString(), {
    redirect: "manual",
    headers: {
      Accept: "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,*/*;q=0.8",
      "User-Agent": "NeonPrint-FileImporter/1.0",
    },
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("La imagen remota redirige sin destino valido.");
    return fetchRemoteImage(new URL(location, parsed).toString(), redirectCount + 1);
  }

  if (!response.ok) {
    throw new Error("No se pudo descargar la imagen remota.");
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_IMPORTED_URL_BYTES) {
    throw new Error(`La imagen remota supera el limite de ${Math.round(MAX_IMPORTED_URL_BYTES / MB)} MB.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMPORTED_URL_BYTES) {
    throw new Error(`La imagen remota supera el limite de ${Math.round(MAX_IMPORTED_URL_BYTES / MB)} MB.`);
  }

  const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const rawName = safeFileName(parsed.pathname.split("/").filter(Boolean).pop() || "imagen-arrastrada");
  const extension = IMAGE_EXTENSION_BY_TYPE[contentType];
  const fileName = extension && !/\.[a-z0-9]{2,5}$/i.test(rawName) ? `${rawName}.${extension}` : rawName;
  const fileLike = { name: fileName, type: contentType };
  if (!isAllowedImageFile(fileLike)) {
    throw new Error("La URL arrastrada no corresponde a una imagen permitida.");
  }

  return {
    fileName,
    contentType,
    base64: Buffer.from(arrayBuffer).toString("base64"),
  };
};

const validateUploadRequestPolicy = ({ bucket, category, fileName, contentType }) => {
  const validation = validateUploadPolicy({ bucket, category, fileName, contentType });
  if (validation.valid) return null;
  return jsonResponse(415, { error: validation.error || "Tipo de archivo no permitido para este destino." });
};

export async function handleInitiateFileUpload(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader, env);
  if (!auth.authorized) return auth.response;
  const { supabaseAdmin, user, profile } = auth;

  const orderId = String(payload?.orderId || getOrderIdFromPath(payload?.path) || "").trim();
  const bucket = String(payload?.bucket || "order-docs").trim();
  const path = String(payload?.path || "").trim();
  const fileName = safeFileName(payload?.fileName || path.split("/").pop());
  const sizeBytes = Number(payload?.sizeBytes || payload?.size || 0);
  const contentType = String(payload?.contentType || "application/octet-stream").trim();
  const category = inferCategory({ bucket, path, category: payload?.category });
  const idempotencyKey = String(payload?.idempotencyKey || "").trim();

  if (!orderId || !ORDER_ASSET_BUCKETS.has(bucket) || !path || !fileName || !isOrderScopedPath({ orderId, path })) {
    return jsonResponse(400, { error: "Faltan datos requeridos para iniciar la subida." });
  }

  const policyError = validateUploadRequestPolicy({ bucket, category, fileName, contentType });
  if (policyError) return policyError;

  const limit = ORDER_FILE_BUCKET_LIMITS[bucket];
  if (limit && sizeBytes > limit && !shouldUseR2({ bucket, sizeBytes, env })) {
    return jsonResponse(413, { error: `El archivo supera el limite permitido de ${Math.round(limit / MB)} MB.` });
  }

  const access = await loadOrderForAccess({ supabaseAdmin, orderId, userId: user.id, role: profile.role });
  if (access.error) {
    if (access.error.status === 404) {
      if (
        PREORDER_R2_ROLES.has(profile.role) &&
        UUID_PATTERN.test(orderId) &&
        UUID_PATTERN.test(idempotencyKey) &&
        idempotencyKey === orderId &&
        isOrderScopedPath({ orderId, path })
      ) {
        const provider = shouldUseR2({ bucket, sizeBytes, env }) ? "r2" : "supabase";
        const r2 = getR2Config(env);
        const targetBucket = provider === "r2" ? r2.bucket : bucket;
        const reservation = await reservePreorderAsset({
          supabaseAdmin,
          orderId,
          idempotencyKey,
          provider,
          bucket: targetBucket,
          objectKey: path,
          fileName: payload?.fileName || fileName,
          contentType,
          sizeBytes,
          category,
          userId: user.id,
        });
        if (reservation.conflict) return jsonResponse(409, { error: "La ruta de este archivo previo ya está reservada." });
        if (reservation.error || !reservation.reservation) return internalError("No se pudo reservar el archivo previo.", "PREORDER_RESERVATION_FAILED");
        if (shouldUseR2({ bucket, sizeBytes, env })) {
          return jsonResponse(200, buildR2UploadResponse({
            bucket: r2.bucket,
            key: path,
            contentType,
            shouldRegister: false,
            preorder: {
              provider: "r2",
              bucket: r2.bucket,
              objectKey: path,
              category,
              originalFilename: payload?.fileName || fileName,
              contentType,
              sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
              reservationId: reservation.reservation.id,
            },
            env,
          }));
        }

        const { data: signedUpload, error: signedUploadError } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUploadUrl(path);
        if (signedUploadError || !signedUpload?.token) {
          return internalError("No se pudo autorizar la subida segura.", "SIGNED_UPLOAD_CREATE_FAILED");
        }
        return jsonResponse(200, {
          provider: "supabase",
          bucket,
          objectKey: path,
          assetRef: buildSupabaseAssetRef({ bucket, key: path }),
          shouldRegister: false,
          upload: { path, token: signedUpload.token },
          preorder: {
            provider: "supabase",
            bucket,
            objectKey: path,
            category,
            originalFilename: payload?.fileName || fileName,
            contentType,
            sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
            reservationId: reservation.reservation.id,
          },
        });
      }
      return jsonResponse(404, { error: "La orden aun no existe o no admite archivos previos." });
    }
    return access.error;
  }

  const writeAccessError = validateOrderAssetAction({ order: access.order, role: profile.role, category, action: "initiate" });
  if (writeAccessError) return writeAccessError;

  if (!shouldUseR2({ bucket, sizeBytes, env })) {
    const reservation = await reserveOrderAsset({
      supabaseAdmin,
      orderId,
      provider: "supabase",
      bucket,
      objectKey: path,
      fileName: payload?.fileName || fileName,
      contentType,
      sizeBytes,
      category,
      userId: user.id,
    });
    if (reservation.conflict) return jsonResponse(409, { error: "Ya existe un archivo con esta ruta. Selecciona nuevamente el archivo." });
    if (reservation.error || !reservation.fileRecord) return internalError("No se pudo reservar el archivo.", "FILE_RESERVATION_FAILED");
    const { data: signedUpload, error: signedUploadError } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path);
    if (signedUploadError || !signedUpload?.token) {
      return internalError("No se pudo autorizar la subida segura.", "SIGNED_UPLOAD_CREATE_FAILED");
    }
    return jsonResponse(200, {
      provider: "supabase",
      bucket,
      objectKey: path,
      assetRef: buildSupabaseAssetRef({ bucket, key: path }),
      shouldRegister: true,
      file: reservation.fileRecord,
      upload: { path, token: signedUpload.token },
    });
  }

  const r2 = getR2Config(env);
  const objectKey = `orders/${orderId}/${category}/${Date.now()}-${fileName}`;

  const reservation = await reserveOrderAsset({
    supabaseAdmin, orderId, provider: "r2", bucket: r2.bucket, objectKey,
    fileName: payload?.fileName || fileName, contentType, sizeBytes, category, userId: user.id,
  });
  if (reservation.conflict) return jsonResponse(409, { error: "Ya existe un archivo con esta ruta. Intenta nuevamente." });
  if (reservation.error || !reservation.fileRecord) {
    return internalError("No se pudo registrar el archivo.", "FILE_RECORD_CREATE_FAILED");
  }

  return jsonResponse(200, buildR2UploadResponse({
    bucket: r2.bucket,
    key: objectKey,
    contentType,
    fileRecord: reservation.fileRecord,
    env,
  }));
}

export async function handleBindPreorderFileUpload(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader, env);
  if (!auth.authorized) return auth.response;
  const { supabaseAdmin, user, profile } = auth;

  const orderId = String(payload?.orderId || "").trim();
  const provider = String(payload?.provider || "").trim();
  const bucket = String(payload?.bucket || "").trim();
  const objectKey = String(payload?.objectKey || "").trim();
  const fileName = safeFileName(payload?.fileName || objectKey.split("/").pop());
  const contentType = String(payload?.contentType || "application/octet-stream").trim();
  const sizeBytes = Number(payload?.sizeBytes || 0);
  const category = inferCategory({ bucket, path: objectKey, category: payload?.category });

  if (!orderId || !["r2", "supabase"].includes(provider) || !ORDER_ASSET_BUCKETS.has(bucket) || !objectKey || !fileName) {
    return jsonResponse(400, { error: "Los datos del archivo previo no son validos." });
  }
  if (!isOrderScopedPath({ orderId, path: objectKey })) {
    return jsonResponse(400, { error: "El archivo no pertenece a la orden indicada." });
  }

  const policyError = validateUploadRequestPolicy({ bucket, category, fileName, contentType });
  if (policyError) return policyError;
  const r2 = getR2Config(env);
  if (provider === "r2" && (!r2.configured || bucket !== r2.bucket)) {
    return jsonResponse(400, { error: "El bucket R2 indicado no es valido." });
  }

  const access = await loadOrderForAccess({ supabaseAdmin, orderId, userId: user.id, role: profile.role });
  if (access.error) return access.error;
  const writeAccessError = validateOrderAssetAction({ order: access.order, role: profile.role, category, action: "complete" });
  if (writeAccessError) return writeAccessError;

  const reservation = await reserveOrderAsset({
    supabaseAdmin, orderId, provider, bucket, objectKey,
    fileName: payload?.fileName || fileName, contentType, sizeBytes, category, userId: user.id,
  });
  if (reservation.conflict || reservation.error || !reservation.fileRecord) {
    return reservation.conflict
      ? jsonResponse(409, { error: "Este archivo ya fue asociado a una orden." })
      : internalError("No se pudo asociar el archivo previo a la orden.", "PREORDER_FILE_BIND_FAILED");
  }
  const { data: fileRecord, error } = await supabaseAdmin
    .from("order_files")
    .update({ status: "uploaded", updated_at: new Date().toISOString() })
    .eq("id", reservation.fileRecord.id)
    .eq("uploaded_by", user.id)
    .select("*")
    .single();
  if (error || !fileRecord) return internalError("No se pudo completar el archivo previo.", "PREORDER_FILE_BIND_FAILED");

  return jsonResponse(200, {
    file: fileRecord,
    storedUrl: buildAssetReference({ provider: fileRecord.provider, bucket: fileRecord.bucket, objectKey: fileRecord.object_key }),
  });
}

export async function handleCompleteFileUpload(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader, env);
  if (!auth.authorized) return auth.response;
  const { supabaseAdmin, user, profile } = auth;

  const provider = String(payload?.provider || "supabase").trim();
  const orderId = String(payload?.orderId || getOrderIdFromPath(payload?.path || payload?.objectKey) || "").trim();
  if (!orderId) return jsonResponse(400, { error: "Falta orderId." });

  const access = await loadOrderForAccess({ supabaseAdmin, orderId, userId: user.id, role: profile.role });
  if (access.error) return access.error;
  const category = inferCategory({ bucket: payload?.bucket, path: payload?.path || payload?.objectKey, category: payload?.category });
  const writeAccessError = validateOrderAssetAction({ order: access.order, role: profile.role, category, action: "complete" });
  if (writeAccessError) return writeAccessError;

  if (provider === "r2") {
    const fileId = String(payload?.fileId || payload?.file?.id || "").trim();
    if (!fileId) return jsonResponse(400, { error: "Falta fileId." });
    const nextStatus = payload?.status === "failed" ? "failed" : "uploaded";

    const { data, error } = await supabaseAdmin
      .from("order_files")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", fileId)
      .eq("order_id", orderId)
      .eq("uploaded_by", user.id)
      .select("*")
      .single();

    if (error) return internalError("No se pudo actualizar el archivo.", "FILE_RECORD_UPDATE_FAILED");
    return jsonResponse(200, { file: data, storedUrl: buildR2Url({ bucket: data.bucket, key: data.object_key }) });
  }

  const bucket = String(payload?.bucket || "").trim();
  const path = String(payload?.path || "").trim();
  const fileId = String(payload?.fileId || payload?.file?.id || "").trim();
  if (!ORDER_ASSET_BUCKETS.has(bucket) || !path || !fileId) return jsonResponse(400, { error: "Faltan datos de la reserva del archivo." });
  const fileName = payload?.fileName || path.split("/").pop();
  const contentType = payload?.contentType || null;
  const policyError = validateUploadRequestPolicy({ bucket, category, fileName, contentType });
  if (policyError) return policyError;

  const { data, error } = await supabaseAdmin
    .from("order_files")
    .update({ status: payload?.status === "failed" ? "failed" : "uploaded", updated_at: new Date().toISOString() })
    .eq("id", fileId)
    .eq("order_id", orderId)
    .eq("provider", "supabase")
    .eq("bucket", bucket)
    .eq("object_key", path)
    .eq("uploaded_by", user.id)
    .select("*")
    .single();

  if (error) return internalError("No se pudo registrar el archivo.", "FILE_RECORD_CREATE_FAILED");
  return jsonResponse(200, { file: data, storedUrl: buildSupabaseAssetRef({ bucket: data.bucket, key: data.object_key }) });
}

export async function handleImportRemoteFile(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader, env);
  if (!auth.authorized) return auth.response;

  const mode = String(payload?.mode || "image").trim();
  if (mode !== "image") {
    return jsonResponse(400, { error: "Por ahora solo se pueden importar imagenes remotas." });
  }

  try {
    const imported = await fetchRemoteImage(payload?.url);
    return jsonResponse(200, imported);
  } catch {
    return jsonResponse(400, {
      error: "No se pudo importar el archivo remoto.",
      code: "REMOTE_FILE_IMPORT_FAILED",
    });
  }
}

const findCanonicalAssetRecord = async ({ supabaseAdmin, assetRef, bucket: requestedBucket, env = process.env }) => {
  const r2Bucket = getR2Config(env).bucket;
  const r2Ref = parseR2Url(assetRef, { allowedBucket: r2Bucket });
  const supabaseRef = parseSupabaseAssetRef(assetRef);
  if (r2Ref || supabaseRef) {
    const ref = r2Ref || supabaseRef;
    const provider = r2Ref ? "r2" : "supabase";
    const { data, error } = await supabaseAdmin
      .from("order_files")
      .select("*")
      .eq("provider", provider)
      .eq("bucket", ref.bucket)
      .eq("object_key", ref.key)
      .eq("status", "uploaded")
      .is("deleted_at", null);
    return { records: data, error };
  }

  const candidateBuckets = requestedBucket && ORDER_ASSET_BUCKETS.has(requestedBucket)
    ? [requestedBucket]
    : [...ORDER_ASSET_BUCKETS];
  const candidates = candidateBuckets
    .map((bucket) => ({ bucket, path: getStoragePathFromSupabaseUrl({ bucket, url: assetRef }) }))
    .filter((candidate) => candidate.path);
  if (candidates.length !== 1) return { records: [], error: null };
  const candidate = candidates[0];
  const { data, error } = await supabaseAdmin
    .from("order_files")
    .select("*")
    .eq("provider", "supabase")
    .eq("bucket", candidate.bucket)
    .eq("object_key", candidate.path)
    .eq("status", "uploaded")
    .is("deleted_at", null);
  return { records: data, error };
};

export async function handleResolveOrderAssetDownload(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader, env);
  if (!auth.authorized) return auth.response;
  const { supabaseAdmin, user, profile } = auth;

  const assetRef = String(payload?.assetRef || payload?.url || "").trim();
  const assetId = String(payload?.assetId || "").trim();
  if (!assetRef && !assetId) return jsonResponse(400, { error: "Falta la referencia segura del archivo." });

  let fileRecords;
  let error;
  if (assetId) {
    ({ data: fileRecords, error } = await supabaseAdmin
      .from("order_files")
      .select("*")
      .eq("id", assetId)
      .eq("status", "uploaded")
      .is("deleted_at", null));
  } else {
    ({ records: fileRecords, error } = await findCanonicalAssetRecord({
      supabaseAdmin,
      assetRef,
      bucket: String(payload?.bucket || "").trim(),
      env,
    }));
  }

  if (error) return internalError("No se pudo consultar el archivo.", "FILE_LOOKUP_FAILED");
  if (!Array.isArray(fileRecords) || fileRecords.length !== 1) {
    return jsonResponse(404, { error: "No se encontro el archivo." });
  }
  const fileRecord = fileRecords[0];
  const orderId = fileRecord.order_id;

  const access = await loadOrderForAccess({ supabaseAdmin, orderId, userId: user.id, role: profile.role });
  if (access.error) return access.error;

  const readAccessError = validateOrderAssetAction({ order: access.order, role: profile.role, category: fileRecord.category, action: "read" });
  if (readAccessError) return readAccessError;

  const expiresIn = Math.max(60, Math.min(Number(payload?.expiresIn) || DEFAULT_SIGNED_URL_TTL, DEFAULT_SIGNED_URL_TTL));
  if (fileRecord.provider === "supabase") {
    const { data: signed, error: signedError } = await supabaseAdmin.storage
      .from(fileRecord.bucket)
      .createSignedUrl(fileRecord.object_key, expiresIn, { download: payload?.download === true });
    if (signedError || !signed?.signedUrl) return internalError("No se pudo generar el enlace temporal.", "SIGNED_DOWNLOAD_CREATE_FAILED");
    return jsonResponse(200, { url: signed.signedUrl, expiresIn, assetRef: buildSupabaseAssetRef({ bucket: fileRecord.bucket, key: fileRecord.object_key }) });
  }

  return jsonResponse(200, {
    url: presignR2Url({
      method: "GET",
      bucket: fileRecord.bucket,
      key: fileRecord.object_key,
      expiresIn,
      downloadName: fileRecord.original_filename || fileRecord.object_key.split("/").pop() || "archivo",
      env,
    }),
    expiresIn,
    assetRef: buildR2Url({ bucket: fileRecord.bucket, key: fileRecord.object_key }),
  });
}

// Kept during the release window for callers which still send a legacy URL.
// Unlike the old implementation it never returns caller-controlled URLs.
export async function handleFileDownloadUrl(payload = {}, env = process.env) {
  return handleResolveOrderAssetDownload(payload, env);
}

export async function handleAdminDeleteOrderWithFiles(payload = {}, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });

  const orderId = String(payload?.orderId || "").trim();
  if (!orderId) return jsonResponse(400, { error: "Falta orderId." });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) return jsonResponse(404, { error: "No se encontro la orden." });

  const { data: orderFiles, error: filesError } = await supabaseAdmin
    .from("order_files")
    .select("*")
    .eq("order_id", orderId)
    .is("deleted_at", null);

  if (filesError) {
    return internalError("No se pudieron consultar los archivos de la orden.", "ORDER_FILES_LOOKUP_FAILED");
  }

  const supabaseTargets = [
    ...collectLegacySupabaseTargets(order),
    ...(orderFiles || [])
      .filter((file) => file.provider === "supabase")
      .map((file) => ({ bucket: file.bucket, path: file.object_key })),
  ];
  const r2Targets = [
    ...collectLegacyR2Targets(order),
    ...(orderFiles || []).filter((file) => file.provider === "r2"),
  ];

  const supabasePrefixResult = await removeSupabasePrefixesForOrder({ supabaseAdmin, orderId });
  const supabaseResult = await removeSupabaseTargets({ supabaseAdmin, targets: supabaseTargets });
  const r2Result = await removeR2Targets({ targets: r2Targets, env });
  const errors = [...supabasePrefixResult.errors, ...supabaseResult.errors, ...r2Result.errors];
  const filesDeleted = supabasePrefixResult.removed + supabaseResult.removed + r2Result.removed;

  if (errors.length > 0) {
    await supabaseAdmin.from("order_delete_audit").insert({
      order_id: orderId,
      deleted_by: auth.user.id,
      client_name: order.client_name,
      order_created_at: order.created_at,
      files_deleted: filesDeleted,
      storage_errors: errors,
      delete_status: "skipped_storage_error",
    });
    return jsonResponse(409, {
      error: "No se elimino la orden porque hubo errores borrando archivos.",
      code: "ORDER_FILE_DELETE_FAILED",
    });
  }

  await supabaseAdmin
    .from("order_files")
    .update({ status: "deleted", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("order_id", orderId);

  await supabaseAdmin.from("notifications").delete().eq("order_id", orderId);

  const { error: deleteError } = await supabaseAdmin
    .from("orders")
    .delete()
    .eq("id", orderId);

  if (deleteError) {
    await supabaseAdmin.from("order_delete_audit").insert({
      order_id: orderId,
      deleted_by: auth.user.id,
      client_name: order.client_name,
      order_created_at: order.created_at,
      files_deleted: filesDeleted,
      storage_errors: [{ provider: "database", message: deleteError.message }],
      delete_status: "failed",
    });
    return internalError("Los archivos se borraron, pero no se pudo eliminar la orden.", "ORDER_DELETE_FAILED");
  }

  await supabaseAdmin.from("order_delete_audit").insert({
    order_id: orderId,
    deleted_by: auth.user.id,
    client_name: order.client_name,
    order_created_at: order.created_at,
    files_deleted: filesDeleted,
    storage_errors: [],
    delete_status: "deleted",
  });

  return jsonResponse(200, { deleted: true, order_id: orderId, files_deleted: filesDeleted });
}
