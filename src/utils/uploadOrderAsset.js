/**
 * ============= UTILIDAD: SUBIR ARCHIVOS A SUPABASE STORAGE =============
 * 
 * Centraliza toda la lógica de upload de archivos de órdenes con:
 * - Validación de tamaño
 * - Manejo robusto de errores
 * - Generación de rutas seguras
 * - URLs públicas
 * 
 * Buckets disponibles:
 * - "order-docs": Límite 200MB (archivos de diseño, especificaciones)
 * - "order-previews": Límite 10MB (previsualizaciones)
 * - "payment-invoice": Límite 10MB (comprobantes de pago)
 */

import { supabase } from "../../supabaseClient";

const MB = 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL = 60 * 30;

// ============= LÍMITES POR BUCKET =============
// Estos límites se usan para validación en cliente (antes de subir)
export const ORDER_ASSET_BUCKET_LIMITS = {
  "order-docs": 200 * MB,
  "order-previews": 10 * MB,
  "payment-invoice": 10 * MB,
};

// ============= FUNCIÓN: FORMATEAR TAMAÑO DE ARCHIVO =============
// Convierte bytes a formato legible (12.5 MB, 256 KB, etc.)
export const formatFileSize = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";

  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

// ============= FUNCIÓN: OBTENER LÍMITE DEL BUCKET =============
export const getOrderAssetLimit = (bucket) => ORDER_ASSET_BUCKET_LIMITS[bucket] || null;

// ============= FUNCIÓN: GENERAR NOMBRE SEGURO PARA ALMACENAMIENTO =============
// Convierte nombres de archivo a formato seguro (sin caracteres especiales, tildes, espacios)
// Añade timestamp para evitar colisiones
export const buildStorageSafeFileName = (file, prefix = "") => {
  const safeName = String(file?.name || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quita acentos
    .toLowerCase()
    .replace(/\s+/g, "-") // Espacios a guiones
    .replace(/[^a-z0-9._-]/g, "") // Solo caracteres seguros
    .replace(/^-+|-+$/g, ""); // Quita guiones al inicio/final

  return `${prefix}${Date.now()}-${safeName || "archivo"}`;
};

// ============= FUNCIÓN: VALIDAR TAMAÑO DE ARCHIVO =============
// Comprueba que el archivo no supere el límite del bucket
export const validateOrderAssetSize = ({ bucket, file }) => {
  const limit = getOrderAssetLimit(bucket);
  if (!limit || !file?.size || file.size <= limit) return null;

  return `El archivo "${file.name}" pesa ${formatFileSize(file.size)} y supera el limite permitido de ${formatFileSize(limit)}.`;
};

// ============= FUNCIÓN INTERNA: CONSTRUIR ERROR DE UPLOAD =============
// Detecta si el error es por tamaño y proporciona mensajes útiles
const buildStorageUploadError = ({ bucket, file, error }) => {
  const message = error?.message || "No se pudo subir el archivo.";
  const isSizeError = /maximum allowed size|exceeded.*size|max.*size|file size|tamano|tama\u00f1o/i.test(message);

  if (!isSizeError) {
    return error instanceof Error ? error : new Error(message);
  }

  const appLimit = getOrderAssetLimit(bucket);
  const sizeLabel = file?.size ? ` Tamaño del archivo: ${formatFileSize(file.size)}.` : "";
  const limitLabel = appLimit ? ` Limite esperado en la app: ${formatFileSize(appLimit)}.` : "";

  return new Error(
    `Supabase rechazo "${file?.name || "el archivo"}" porque excede el limite real configurado en Storage para el bucket "${bucket}".${sizeLabel}${limitLabel} Revisa el limite global y el limite del bucket en Supabase.`
  );
};

/**
 * ============= FUNCIÓN PRINCIPAL: SUBIR ARCHIVO A STORAGE =============
 * Maneja toda la lógica de upload:
 * 1. Valida que los parámetros existan
 * 2. Valida el tamaño del archivo
 * 3. Sube a Supabase Storage
 * 4. Retorna URL pública del archivo
 * 
 * @param {Object} params
 * @param {string} params.bucket - Nombre del bucket ("order-docs", "payment-invoice", etc.)
 * @param {string} params.path - Ruta del archivo en el bucket (ej: "order-123/invoice.jpg")
 * @param {File} params.file - Archivo del navegador (de input type="file")
 * 
 * @returns {Promise<string|null>} URL pública del archivo o null si falla
 * @throws {Error} Si hay error en validación o upload
 */
export const uploadOrderAsset = async ({ bucket, path, file }) => {
  if (!bucket || !path || !file) {
    throw new Error("Faltan parametros requeridos: bucket, path, file");
  }

  // Validar tamaño antes de intentar subir
  const sizeError = validateOrderAssetSize({ bucket, file });
  if (sizeError) {
    throw new Error(sizeError);
  }

  try {
    // Subir archivo a Storage (upsert = sobrescribir si existe)
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });

    if (error) {
      throw buildStorageUploadError({ bucket, file, error });
    }

    // Obtener URL pública del archivo subido
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error(`Error uploading to bucket '${bucket}':`, err);
    throw err;
  }
};

// ============= FUNCIÓN: EXTRAER RUTA DE URL PÚBLICA =============
// Invierte getPublicUrl: de URL saca el path original
export const getStoragePathFromPublicUrl = ({ bucket, url }) => {
  if (!bucket || !url) return null;

  try {
    const parsed = new URL(url);
    const publicPrefix = `/storage/v1/object/public/${bucket}/`;
    const bucketIndex = parsed.pathname.indexOf(publicPrefix);

    if (bucketIndex === -1) return null;

    return decodeURIComponent(parsed.pathname.slice(bucketIndex + publicPrefix.length));
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
    { bucket: "order-previews", prefix: `orders/${orderId}/preview` },
    { bucket: "payment-invoice", prefix: orderId },
  ];

  const results = await Promise.all(tasks.map(listAndRemoveOrderAssets));
  return {
    removed: results.reduce((total, result) => total + result.removed, 0),
    errors: results.map((result) => result.error).filter(Boolean),
  };
};

/**
 * Construye la ruta de archivo estandar para comprobantes de pago.
 * @param {string} orderId - ID de la orden.
 * @param {string} fileName - Nombre del archivo original.
 * @returns {string} Ruta formateada.
 */
export const buildPaymentReceiptPath = (orderId, fileName) => {
  const timestamp = Date.now();
  return `${orderId}/payment-${timestamp}-${fileName}`;
};
