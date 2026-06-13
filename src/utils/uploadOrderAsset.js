import { supabase } from "../../supabaseClient";
import { adminApiFetch } from "./adminApi";

const MB = 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL = 60 * 30;
const R2_SCHEME = "r2://";

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
  if (!isSizeError) return error instanceof Error ? error : new Error(message);

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

const registerCompletedUpload = async ({ provider, bucket, path, file, storedUrl, fileId }) => {
  const orderId = getOrderIdFromStoragePath(path);
  if (!orderId || orderId === "new") return null;

  const { response, result } = await adminApiFetch("/api/files-complete-upload", {
    provider,
    orderId,
    bucket,
    path,
    fileId,
    storedUrl,
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

export const uploadOrderAsset = async ({ bucket, path, file }) => {
  if (!bucket || !path || !file) {
    throw new Error("Faltan parametros requeridos: bucket, path, file");
  }

  const sizeError = bucket === "order-docs" ? null : validateOrderAssetSize({ bucket, file });
  if (sizeError) throw new Error(sizeError);

  try {
    const orderId = getOrderIdFromStoragePath(path);

    if (orderId && orderId !== "new") {
      const { response, result } = await adminApiFetch("/api/files-initiate-upload", {
        orderId,
        bucket,
        path,
        fileName: file?.name || path.split("/").pop(),
        contentType: file?.type || "application/octet-stream",
        sizeBytes: file?.size || 0,
        category: inferCategoryFromPath({ bucket, path }),
      });

      if (response.ok && result?.provider === "supabase") {
        const fallbackSizeError = validateOrderAssetSize({ bucket, file });
        if (fallbackSizeError) throw new Error(fallbackSizeError);
      }

      if (response.ok && result?.provider === "r2") {
        await putFileToSignedUrl({ upload: result.upload, file });
        const completed = await registerCompletedUpload({
          provider: "r2",
          bucket: result.file?.bucket || bucket,
          path: result.file?.object_key || path,
          file,
          storedUrl: result.storedUrl,
          fileId: result.file?.id,
        });

        return completed?.storedUrl || result.storedUrl || null;
      }
    }

    const fallbackSizeError = validateOrderAssetSize({ bucket, file });
    if (fallbackSizeError) throw new Error(fallbackSizeError);

    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw buildStorageUploadError({ bucket, file, error });

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    const publicUrl = data?.publicUrl || null;

    registerCompletedUpload({
      provider: "supabase",
      bucket,
      path,
      file,
      storedUrl: publicUrl,
    }).catch((registerError) => {
      console.warn("No se pudo registrar metadata del archivo:", registerError);
    });

    return publicUrl;
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

export const removeOrderAsset = async ({ bucket, path }) => {
  if (!bucket || !path) return { removed: false, error: null };

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    console.error(`Error removing from bucket '${bucket}':`, error);
    return { removed: false, error };
  }

  return { removed: true, error: null };
};

export const removeOrderAssetByPublicUrl = async ({ bucket, url }) => {
  if (isR2OrderAssetUrl(url)) return { removed: false, error: null };

  const path = getStoragePathFromPublicUrl({ bucket, url });
  if (!path) return { removed: false, error: null };
  return removeOrderAsset({ bucket, path });
};

export const createSignedOrderAssetUrl = async ({ bucket, path, expiresIn = DEFAULT_SIGNED_URL_TTL }) => {
  if (!bucket || !path) return null;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) {
    console.error(`Error creating signed URL for '${bucket}/${path}':`, error);
    return null;
  }

  return data?.signedUrl || null;
};

export const createSignedOrderAssetUrlFromStoredUrl = async ({ bucket, url, expiresIn = DEFAULT_SIGNED_URL_TTL }) => {
  if (isR2OrderAssetUrl(url)) {
    const { response, result } = await adminApiFetch("/api/files-download-url", { url, expiresIn });
    if (!response.ok) return null;
    return result?.url || null;
  }

  const path = getStoragePathFromPublicUrl({ bucket, url });
  if (!path) return null;
  return createSignedOrderAssetUrl({ bucket, path, expiresIn });
};

const listAndRemoveOrderAssets = async ({ bucket, prefix }) => {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) {
    console.error(`Error listing '${prefix}' in bucket '${bucket}':`, error);
    return { removed: 0, error };
  }

  const paths = (data || [])
    .filter((item) => item?.name && item.name !== ".emptyFolderPlaceholder")
    .map((item) => `${prefix}/${item.name}`);

  if (!paths.length) return { removed: 0, error: null };

  const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
  if (removeError) {
    console.error(`Error removing files from bucket '${bucket}':`, removeError);
    return { removed: 0, error: removeError };
  }

  return { removed: paths.length, error: null };
};

export const removeOrderAssetsForOrder = async (orderId) => {
  if (!orderId) return { removed: 0, errors: [] };

  const tasks = [
    { bucket: "order-docs", prefix: `orders/${orderId}/files` },
    { bucket: "order-docs", prefix: `orders/${orderId}/ref-images` },
    { bucket: "order-previews", prefix: `orders/${orderId}/preview` },
    { bucket: "payment-invoice", prefix: orderId },
  ];

  const results = await Promise.all(tasks.map(listAndRemoveOrderAssets));
  return {
    removed: results.reduce((total, result) => total + result.removed, 0),
    errors: results.map((result) => result.error).filter(Boolean),
  };
};

export const buildPaymentReceiptPath = (orderId, fileName) => {
  const timestamp = Date.now();
  return `${orderId}/payment-${timestamp}-${fileName}`;
};
