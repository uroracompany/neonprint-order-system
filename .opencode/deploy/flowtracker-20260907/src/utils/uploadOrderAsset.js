import { supabase } from "../../supabaseClient";
import { adminApiFetch } from "./adminApi";

const MB = 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL = 60 * 30;
const R2_SCHEME = "r2://";
const SUPABASE_SCHEME = "supabase://";

export const ORDER_ASSET_BUCKET_LIMITS = {
  "order-docs": 200 * MB,
  "order-previews": 10 * MB,
  "payment-invoice": 10 * MB,
};

export const formatFileSize = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const getOrderAssetLimit = (bucket) => ORDER_ASSET_BUCKET_LIMITS[bucket] || null;
export const isR2OrderAssetUrl = (url = "") => String(url || "").startsWith(R2_SCHEME);
export const isSupabaseOrderAssetRef = (url = "") => String(url || "").startsWith(SUPABASE_SCHEME);

export const buildStorageSafeFileName = (file, prefix = "") => {
  const safeName = String(file?.name || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "");

  return `${prefix}${Date.now()}-${safeName || "archivo"}`;
};

export const validateOrderAssetSize = ({ bucket, file }) => {
  const limit = getOrderAssetLimit(bucket);
  if (!limit || !file?.size || file.size <= limit) return null;
  return `El archivo "${file.name}" pesa ${formatFileSize(file.size)} y supera el limite permitido de ${formatFileSize(limit)}.`;
};

const getOrderIdFromStoragePath = (path = "") => {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts[0] === "orders" ? parts[1] : parts[0];
};

const inferCategoryFromPath = ({ bucket, path }) => {
  if (bucket === "payment-invoice") return "payment";
  if (bucket === "order-previews" || /\/preview\//i.test(path)) return "preview";
  if (/\/ref-images\//i.test(path)) return "reference";
  return "design";
};

const buildStorageUploadError = ({ bucket, file, error }) => {
  const message = error?.message || "No se pudo subir el archivo.";
  const isSizeError = /maximum allowed size|exceeded.*size|max.*size|file size|tamano|tama\u00f1o/i.test(message);
  if (!isSizeError) return new Error("No se pudo subir el archivo. Intentalo nuevamente.");

  const appLimit = getOrderAssetLimit(bucket);
  const sizeLabel = file?.size ? ` Tamano del archivo: ${formatFileSize(file.size)}.` : "";
  const limitLabel = appLimit ? ` Limite esperado en la app: ${formatFileSize(appLimit)}.` : "";
  return new Error(
    `Supabase rechazo "${file?.name || "el archivo"}" porque excede el limite real configurado en Storage para el bucket "${bucket}".${sizeLabel}${limitLabel} Revisa el limite global y el limite del bucket en Supabase.`
  );
};

const putFileToSignedUrl = async ({ upload, file }) => {
  const response = await fetch(upload.url, {
    method: upload.method || "PUT",
    headers: upload.headers || {},
    body: file,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`No se pudo subir el archivo a Cloudflare R2 (${response.status}). ${text}`.trim());
  }
};

const putFileToSupabaseSignedUrl = async ({ bucket, upload, file }) => {
  if (!upload?.path || !upload?.token) throw new Error("La autorización de subida segura no es válida.");
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, {
      contentType: file?.type || undefined,
      cacheControl: "3600",
    });
  if (error) throw buildStorageUploadError({ bucket, file, error });
};

const registerCompletedUpload = async ({ provider, bucket, path, file, storedUrl, fileId, status = "uploaded" }) => {
  const orderId = getOrderIdFromStoragePath(path);
  if (!orderId || orderId === "new") return null;

  const { response, result } = await adminApiFetch("/api/files", {
    action: "complete-upload",
    provider,
    orderId,
    bucket,
    path,
    fileId,
    storedUrl,
    status,
    fileName: file?.name || path.split("/").pop(),
    contentType: file?.type || null,
    sizeBytes: file?.size || null,
    category: inferCategoryFromPath({ bucket, path }),
  });

  if (!response.ok) {
    throw new Error(result?.error || "No se pudo registrar el archivo subido.");
  }

  return result;
};

const markR2UploadFailed = async ({ orderId, fileId }) => {
  if (!orderId || !fileId) return;

  try {
    await adminApiFetch("/api/files", {
      action: "complete-upload",
      provider: "r2",
      orderId,
      fileId,
      status: "failed",
    });
  } catch (error) {
    console.warn("No se pudo marcar el archivo R2 como fallido:", error);
  }
};

export const uploadOrderAsset = async ({ bucket, path, file, deferR2Binding = false }) => {
  if (!bucket || !path || !file) {
    throw new Error("Faltan parametros requeridos: bucket, path, file");
  }

  const sizeError = bucket === "order-docs" ? null : validateOrderAssetSize({ bucket, file });
  if (sizeError) throw new Error(sizeError);

  try {
    const orderId = getOrderIdFromStoragePath(path);

    if (orderId && orderId !== "new") {
      const { response, result } = await adminApiFetch("/api/files", {
        action: "initiate-upload",
        orderId,
        idempotencyKey: orderId,
        bucket,
        path,
        fileName: file?.name || path.split("/").pop(),
        contentType: file?.type || "application/octet-stream",
        sizeBytes: file?.size || 0,
        category: inferCategoryFromPath({ bucket, path }),
      });

      if (!response.ok) {
        throw new Error(result?.error || "No se pudo iniciar la subida del archivo.");
      }

      if (result?.provider === "supabase") {
        try {
          await putFileToSupabaseSignedUrl({ bucket: result.bucket || bucket, upload: result.upload, file });
        } catch (uploadError) {
          if (result.file?.id) await registerCompletedUpload({ provider: "supabase", bucket, path, file, fileId: result.file.id, status: "failed" }).catch(() => null);
          throw uploadError;
        }
        if (result.shouldRegister === false || !result.file?.id) {
          if (deferR2Binding && result.preorder) return { preorder: result.preorder, bucket, path };
          return result.assetRef || null;
        }
        const completed = await registerCompletedUpload({
          provider: "supabase",
          bucket: result.bucket || bucket,
          path: result.objectKey || path,
          file,
          fileId: result.file.id,
        });
        return completed?.storedUrl || result.assetRef || null;
      }

      if (result?.provider === "r2") {
        try {
          await putFileToSignedUrl({ upload: result.upload, file });
        } catch (uploadError) {
          await markR2UploadFailed({ orderId, fileId: result.file?.id });
          throw uploadError;
        }

        if (result.shouldRegister === false || !result.file?.id) {
          if (deferR2Binding && result.preorder) {
            return { preorder: result.preorder, bucket, path };
          }
          return result.storedUrl || null;
        }

        const completed = await registerCompletedUpload({
          provider: "r2",
          bucket: result.file.bucket || bucket,
          path: result.file.object_key || path,
          file,
          storedUrl: result.storedUrl,
          fileId: result.file.id,
        });

        return completed?.storedUrl || result.storedUrl || null;
      }
    }

    throw new Error("No se pudo determinar la orden asociada al archivo.");
  } catch (err) {
    console.error(`Error uploading to bucket '${bucket}':`, err);
    throw err;
  }
};

export const getStoragePathFromPublicUrl = ({ bucket, url }) => {
  if (!bucket || !url || isR2OrderAssetUrl(url)) return null;

  try {
    const parsed = new URL(url);
    const prefixes = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/${bucket}/`,
    ];
    const matchedPrefix = prefixes.find((prefix) => parsed.pathname.includes(prefix));
    if (!matchedPrefix) return null;
    const bucketIndex = parsed.pathname.indexOf(matchedPrefix);
    return decodeURIComponent(parsed.pathname.slice(bucketIndex + matchedPrefix.length));
  } catch {
    return null;
  }
};

export const createSignedOrderAssetUrl = async ({ bucket, path, expiresIn = DEFAULT_SIGNED_URL_TTL }) => {
  if (!bucket || !path) return null;
  const { response, result } = await adminApiFetch("/api/files", {
    action: "resolve-download",
    assetRef: `${SUPABASE_SCHEME}${bucket}/${encodeURI(path)}`,
    expiresIn,
  });
  return response.ok ? result?.url || null : null;
};

export const createSignedOrderAssetUrlFromStoredUrl = async ({ bucket, url, expiresIn = DEFAULT_SIGNED_URL_TTL }) => {
  if (!url) return null;
  const { response, result } = await adminApiFetch("/api/files", {
    action: "resolve-download",
    assetRef: url,
    bucket,
    expiresIn,
  });
  return response.ok ? result?.url || null : null;
};


export const buildPaymentReceiptPath = (orderId, fileName) => {
  const timestamp = Date.now();
  return `orders/${orderId}/payment-${timestamp}-${fileName}`;
};
