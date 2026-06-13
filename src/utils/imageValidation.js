/**
 * ============= VALIDACIÓN DE IMÁGENES PARA COMPROBANTES DE PAGO =============
 * 
 * FILOSOFÍA:
 * En lugar de mantener una lista de formatos permitidos (JPG, PNG, etc.),
 * delegamos la validación al navegador. Si el navegador puede decodificar
 * y renderizar el archivo como imagen, entonces es una imagen válida.
 *
 * ¿Por qué este enfoque?
 * - Soporta HEIC (iPhone), WebP, AVIF y cualquier formato futuro
 * - No requiere mantener una lista de extensiones que se vuelve obsoleta
 * - El navegador ya sabe qué puede renderizar — confiamos en su decodificador
 * - Es más robusto contra archivos malicioso renombrados
 *
 * SEGURIDAD:
 * Si alguien intenta subir un archivo malicioso renombrado como imagen,
 * el navegador fallará al decodificarlo y la validación lo rechazará.
 * El decodificador de imágenes del navegador corre en un entorno aislado
 * (sandbox), lo que lo hace seguro contra ataques.
 */

const IMAGE_CONFIG = {
  // 10MB es suficiente para fotos de recibos en alta resolución
  MAX_SIZE: 10 * 1024 * 1024, // 10MB en bytes
};

/**
 * ============= FUNCIÓN PRINCIPAL: VALIDAR IMAGEN =============
 * 
 * Valida que un archivo sea una imagen genuina y de tamaño aceptable.
 *
 * @param {File} file - Archivo seleccionado por el usuario (de input type="file")
 * @returns {Promise<Object>} { isValid: boolean, error?: string }
 *
 * EJEMPLO DE USO:
 * const validation = await validateImage(fileInput.files[0]);
 * if (!validation.isValid) {
 *   console.error(validation.error);
 *   return;
 * }
 * // Proceder a subir archivo
 *
 * ¿CÓMO FUNCIONA?
 * 1️⃣ Revisa que exista un archivo
 * 2️⃣ Revisa que no pese más de 10MB
 * 3️⃣ Le pide al navegador que intente renderizar el archivo como imagen
 *    - Si el navegador puede hacerlo → es una imagen válida ✅
 *    - Si el navegador NO puede → no es una imagen (o está corrupta) ❌
 */
export const validateImage = (file) => {
  // PASO 1: ¿Existe el archivo?
  if (!file) {
    return {
      isValid: false,
      error: "No se seleccionó ningún archivo.",
    };
  }

  // PASO 2: ¿El tamaño es aceptable?
  if (file.size > IMAGE_CONFIG.MAX_SIZE) {
    const maxSizeMB = IMAGE_CONFIG.MAX_SIZE / (1024 * 1024);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      isValid: false,
      error: `La imagen es demasiado grande (${fileSizeMB}MB). Máximo permitido: ${maxSizeMB}MB`,
    };
  }

  // PASO 3: ¿El navegador puede decodificarlo como imagen?
  // ═══════════════════════════════════════════════════════
  // Usamos FileReader para leer el archivo como URL de datos,
  // luego creamos un <img> y le asignamos esa URL.
  // 
  // Si el evento 'onload' del <img> se dispara:
  //   → El navegador decodificó la imagen exitosamente ✅
  // 
  // Si se dispara 'onerror':
  //   → El navegador NO pudo decodificar (no es imagen válida) ❌
  
  return new Promise((resolve) => {
    const reader = new FileReader();

    // El FileReader terminó de leer el archivo exitosamente
    reader.onload = (e) => {
      const img = new Image();

      // 🎯 El navegador pudo decodificar la imagen → es VÁLIDA
      img.onload = () => {
        resolve({
          isValid: true,
        });
      };

      // ❌ El navegador NO pudo decodificar la imagen → es INVÁLIDA
      img.onerror = () => {
        resolve({
          isValid: false,
          error:
            "No se pudo procesar el archivo como imagen. " +
            "Asegúrate de seleccionar una foto o captura de pantalla válida.",
        });
      };

      // Le pedimos al navegador que intente renderizar esta URL como imagen
      // El navegador intentará decodificar automáticamente
      img.src = e.target.result;
    };

    // Error al leer el archivo del disco (raro, pero posible)
    reader.onerror = () => {
      resolve({
        isValid: false,
        error: "Error al leer el archivo. Intenta nuevamente.",
      });
    };

    // Iniciamos la lectura del archivo como Data URL (base64)
    reader.readAsDataURL(file);
  });
};

// ─── REFERENCE IMAGES VALIDATION ────────────────────────────────────────────────

export const REF_IMAGE_CONFIG = {
  MAX_COUNT: 3,
  MAX_SIZE_PER_IMAGE: 20 * 1024 * 1024,
  MAX_TOTAL_SIZE: 60 * 1024 * 1024,
  PREVIEW_ALLOWED_TYPES: ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "application/pdf"],
  PREVIEW_MAX_SIZE: 10 * 1024 * 1024,
};

export function validateReferenceImages(files) {
  const errors = [];

  if (!files || files.length === 0) return { valid: true, errors: [] };

  if (files.length > REF_IMAGE_CONFIG.MAX_COUNT) {
    errors.push(
      `Solo se permiten hasta ${REF_IMAGE_CONFIG.MAX_COUNT} imágenes por orden.`
    );
    return { valid: false, errors };
  }

  let totalSize = 0;
  for (const file of files) {
    if (file.size > REF_IMAGE_CONFIG.MAX_SIZE_PER_IMAGE) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      errors.push(
        `"${file.name}" pesa ${mb}MB. Máximo ${
          REF_IMAGE_CONFIG.MAX_SIZE_PER_IMAGE / 1024 / 1024
        }MB por imagen.`
      );
    }
    totalSize += file.size;
  }

  if (totalSize > REF_IMAGE_CONFIG.MAX_TOTAL_SIZE) {
    const totalMB = (totalSize / 1024 / 1024).toFixed(1);
    const maxMB = REF_IMAGE_CONFIG.MAX_TOTAL_SIZE / 1024 / 1024;
    errors.push(
      `El total de imágenes (${totalMB}MB) excede el límite de ${maxMB}MB.`
    );
  }

  return { valid: errors.length === 0, errors };
}

export function canDecodeAsImage(file) {
  if (!file) return Promise.resolve({ valid: false, error: "No se seleccionó ningún archivo." });

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve({ valid: true });
      img.onerror = () => resolve({
        valid: false,
        error: "El formato de este archivo no es compatible. Usa una imagen estándar (JPG, PNG, WebP).",
      });
      img.src = e.target.result;
    };
    reader.onerror = () => resolve({
      valid: false,
      error: "Error al leer el archivo. Intenta nuevamente.",
    });
    reader.readAsDataURL(file);
  });
}

// ─── IMAGE COMPRESSION ──────────────────────────────────────────────────────────

const MAX_DIMENSION = 2048;
const COMPRESSION_QUALITY = 0.85;

export function compressImage(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
    };

    img.onload = () => {
      let { width, height } = img;
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && file.size <= REF_IMAGE_CONFIG.MAX_SIZE_PER_IMAGE) {
        cleanup();
        resolve(file);
        return;
      }

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          const compressedFile = new File([blob], `${baseName}.jpg`, {
            type: "image/jpeg",
          });
          resolve(compressedFile);
        },
        "image/jpeg",
        COMPRESSION_QUALITY
      );
    };

    img.onerror = () => {
      cleanup();
      resolve(file);
    };

    img.src = objectUrl;
  });
}
