import { createHmac, createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getEnvValue, getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";
import { isAllowedImageFile, validateUploadPolicy } from "../src/utils/fileValidation.js";

const MB = 1024 * 1024;
const DEFAULT_R2_THRESHOLD_MB = 25;
const DEFAULT_SIGNED_URL_TTL = 60 * 10;
const MAX_IMPORTED_URL_BYTES = 4 * MB;
const R2_SCHEME = "r2://";

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

const inferCategory = ({ bucket, path, category }) => {
  if (category) return category;
  if (bucket === "payment-invoice") return "payment";
  if (bucket === "order-previews" || /\/preview\//i.test(path)) return "preview";
  if (/\/ref-images\//i.test(path)) return "reference";
  return "design";
};

const getR2Config = (env = process.env) => {
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

const shouldUseR2 = ({ bucket, sizeBytes, env = process.env }) => {
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

export const parseR2Url = (url = "") => {
  if (!isR2Url(url)) return null;
  const rest = String(url).slice(R2_SCHEME.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;
  return {
    bucket: rest.slice(0, slashIndex),
    key: decodeURIComponent(rest.slice(slashIndex + 1)),
  };
};

export const buildR2Url = ({ bucket, key }) => `${R2_SCHEME}${bucket}/${encodeURI(key)}`;

const presignR2Url = ({ method, key, expiresIn = DEFAULT_SIGNED_URL_TTL, env = process.env }) => {
  const r2 = getR2Config(env);
  if (!r2.configured) {
    throw new Error("Cloudflare R2 no esta configurado en el servidor.");
  }

  const { amzDate, dateStamp } = formatAmzDate();
  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/${r2.region}/${r2.service}/aws4_request`;
  const credential = `${r2.accessKeyId}/${credentialScope}`;
  const canonicalUri = `/${normalizePath(r2.bucket)}/${normalizePath(key)}`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(Number(expiresIn) || DEFAULT_SIGNED_URL_TTL, 604800))),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyName, value]) => `${encodeRfc3986(keyName)}=${encodeRfc3986(value)}`)
    .join("&");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
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

const signedR2Fetch = async ({ method, key, env = process.env }) => {
  const r2 = getR2Config(env);
  if (!r2.configured) {
    throw new Error("Cloudflare R2 no esta configurado en el servidor.");
  }

  const { amzDate, dateStamp } = formatAmzDate();
  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${normalizePath(r2.bucket)}/${normalizePath(key)}`;
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
    "",
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

  const response = await fetch(`${r2.endpoint}${canonicalUri}`, {
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
    .select("id,name,email,role,employment_status")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { authorized: false, response: jsonResponse(403, { error: "No se encontro el perfil del usuario." }) };
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

const removeSupabaseTargets = async ({ supabaseAdmin, targets }) => {
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

const removeSupabasePrefix = async ({ supabaseAdmin, bucket, prefix }) => {
  const limit = 1000;
  let offset = 0;
  let removed = 0;
  const errors = [];

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(prefix, {
        limit,
        offset,
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
    offset += limit;
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

const removeR2Targets = async ({ targets, env = process.env }) => {
  let removed = 0;
  const errors = [];
  const r2 = getR2Config(env);
  const deduped = new Map();

  targets.forEach((target) => {
    const key = target?.object_key || target?.key;
    if (!key) return;
    deduped.set(`${target?.bucket || r2.bucket}:${key}`, key);
  });

  if (!deduped.size) return { removed, errors };
  if (!r2.configured) {
    return {
      removed,
      errors: [...deduped.values()].map((key) => ({
        provider: "r2",
        bucket: targetBucketName(targets, r2.bucket),
        key,
        message: "R2 no esta configurado.",
      })),
    };
  }

  for (const key of deduped.values()) {
    try {
      await signedR2Fetch({ method: "DELETE", key, env });
      removed += 1;
    } catch (error) {
      errors.push({ provider: "r2", bucket: r2.bucket, key, message: error?.message || "No se pudo borrar en R2." });
    }
  }

  return { removed, errors };
};

const targetBucketName = (targets, fallback) => targets.find((target) => target?.bucket)?.bucket || fallback || "";

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

  if (!orderId || !bucket || !path || !fileName) {
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
    // Some existing create-order flows upload files before the order row exists.
    // Keep those legacy flows on Supabase until the order creation flow is made transactional.
    if (access.error.status === 404) {
      return jsonResponse(200, {
        provider: "supabase",
        bucket,
        path,
        shouldRegister: false,
      });
    }
    return access.error;
  }

  if (!shouldUseR2({ bucket, sizeBytes, env })) {
    return jsonResponse(200, {
      provider: "supabase",
      bucket,
      path,
      shouldRegister: true,
    });
  }

  const r2 = getR2Config(env);
  const objectKey = `orders/${orderId}/${category}/${Date.now()}-${fileName}`;
  const uploadUrl = presignR2Url({ method: "PUT", key: objectKey, expiresIn: DEFAULT_SIGNED_URL_TTL, env });
  const storedUrl = buildR2Url({ bucket: r2.bucket, key: objectKey });

  const { data: fileRecord, error: insertError } = await supabaseAdmin
    .from("order_files")
    .insert({
      order_id: orderId,
      provider: "r2",
      bucket: r2.bucket,
      object_key: objectKey,
      original_filename: payload?.fileName || fileName,
      content_type: contentType,
      size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      category,
      status: "uploading",
      uploaded_by: user.id,
    })
    .select("*")
    .single();

  if (insertError) {
    return jsonResponse(500, { error: `No se pudo registrar el archivo: ${insertError.message}` });
  }

  return jsonResponse(200, {
    provider: "r2",
    upload: {
      method: "PUT",
      url: uploadUrl,
      headers: contentType ? { "Content-Type": contentType } : {},
    },
    storedUrl,
    file: fileRecord,
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

  if (provider === "r2") {
    const fileId = String(payload?.fileId || payload?.file?.id || "").trim();
    if (!fileId) return jsonResponse(400, { error: "Falta fileId." });

    const { data, error } = await supabaseAdmin
      .from("order_files")
      .update({ status: "uploaded", updated_at: new Date().toISOString() })
      .eq("id", fileId)
      .eq("order_id", orderId)
      .select("*")
      .single();

    if (error) return jsonResponse(500, { error: `No se pudo completar el archivo: ${error.message}` });
    return jsonResponse(200, { file: data, storedUrl: buildR2Url({ bucket: data.bucket, key: data.object_key }) });
  }

  const bucket = String(payload?.bucket || "").trim();
  const path = String(payload?.path || "").trim();
  if (!bucket || !path) return jsonResponse(400, { error: "Faltan bucket y path." });
  const category = inferCategory({ bucket, path, category: payload?.category });
  const fileName = payload?.fileName || path.split("/").pop();
  const contentType = payload?.contentType || null;
  const policyError = validateUploadRequestPolicy({ bucket, category, fileName, contentType });
  if (policyError) return policyError;

  const { data, error } = await supabaseAdmin
    .from("order_files")
    .upsert({
      order_id: orderId,
      provider: "supabase",
      bucket,
      object_key: path,
      original_filename: fileName,
      content_type: contentType,
      size_bytes: Number.isFinite(Number(payload?.sizeBytes)) ? Number(payload?.sizeBytes) : null,
      category,
      status: "uploaded",
      uploaded_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,bucket,object_key" })
    .select("*")
    .single();

  if (error) return jsonResponse(500, { error: `No se pudo registrar el archivo: ${error.message}` });
  return jsonResponse(200, { file: data });
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
  } catch (error) {
    return jsonResponse(400, {
      error: error?.message || "No se pudo importar el archivo remoto.",
    });
  }
}

export async function handleFileDownloadUrl(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader, env);
  if (!auth.authorized) return auth.response;
  const { supabaseAdmin, user, profile } = auth;

  const url = String(payload?.url || "").trim();
  const r2Ref = parseR2Url(url);
  if (!r2Ref) return jsonResponse(200, { url });

  const { data: fileRecord, error } = await supabaseAdmin
    .from("order_files")
    .select("*")
    .eq("provider", "r2")
    .eq("object_key", r2Ref.key)
    .maybeSingle();

  if (error) return jsonResponse(500, { error: `No se pudo consultar el archivo: ${error.message}` });
  if (!fileRecord) return jsonResponse(404, { error: "No se encontro el archivo." });

  const access = await loadOrderForAccess({ supabaseAdmin, orderId: fileRecord.order_id, userId: user.id, role: profile.role });
  if (access.error) return access.error;

  return jsonResponse(200, {
    url: presignR2Url({
      method: "GET",
      key: fileRecord.object_key,
      expiresIn: Number(payload?.expiresIn) || DEFAULT_SIGNED_URL_TTL,
      env,
    }),
    expiresIn: Number(payload?.expiresIn) || DEFAULT_SIGNED_URL_TTL,
  });
}

export async function handleAdminDeleteOrderWithFiles(payload = {}, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) return jsonResponse(auth.status || 403, { error: auth.error });

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
    return jsonResponse(500, { error: `No se pudieron consultar archivos: ${filesError.message}` });
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
      storage_errors: errors,
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
    return jsonResponse(500, { error: `Los archivos se borraron, pero no se pudo eliminar la orden: ${deleteError.message}` });
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
