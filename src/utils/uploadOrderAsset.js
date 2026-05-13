/**
 * Utilidad para subir archivos de órdenes a Supabase Storage
 * Centraliza la lógica de upload con manejo de errores
 */

import { supabase } from "../../supabaseClient";

/**
 * Sube un archivo a un bucket específico de Supabase Storage
 * @param {Object} params - Parámetros de upload
 * @param {string} params.bucket - Nombre del bucket
 * @param {string} params.path - Ruta dentro del bucket
 * @param {File} params.file - Archivo a subir
 * @returns {Promise<string|null>} URL pública del archivo o null si falla
 * @throws {Error} Si hay error en el upload
 */
export const uploadOrderAsset = async ({ bucket, path, file }) => {
  if (!bucket || !path || !file) {
    throw new Error("Faltan parámetros requeridos: bucket, path, file");
  }

  try {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });

    if (error) {
      throw new Error(error.message || "No se pudo subir el archivo.");
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error(`Error uploading to bucket '${bucket}':`, err);
    throw err;
  }
};

/**
 * Construye la ruta de archivo estándar para comprobantes de pago
 * @param {string} orderId - ID de la orden
 * @param {string} fileName - Nombre del archivo original
 * @returns {string} Ruta formateada
 */
export const buildPaymentReceiptPath = (orderId, fileName) => {
  const timestamp = Date.now();
  return `${orderId}/payment-${timestamp}-${fileName}`;
};
