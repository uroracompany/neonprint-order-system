/**
 * Validación de imágenes para comprobantes de pago
 * Verifica: tipo MIME, tamaño máximo, dimensiones mínimas
 */

const IMAGE_CONFIG = {
  MAX_SIZE: 5 * 1024 * 1024, // 5MB
  MIN_WIDTH: 800,
  MIN_HEIGHT: 600,
  ALLOWED_TYPES: ["image/jpeg", "image/png"],
  ALLOWED_EXTENSIONS: [".jpg", ".jpeg", ".png"],
};

/**
 * Valida un archivo de imagen según criterios de negocio
 * @param {File} file - Archivo a validar
 * @returns {Object} { isValid: boolean, error?: string }
 */
export const validateImage = (file) => {
  if (!file) {
    return {
      isValid: false,
      error: "No se seleccionó ningún archivo.",
    };
  }

  // Validar tipo MIME
  if (!IMAGE_CONFIG.ALLOWED_TYPES.includes(file.type)) {
    return {
      isValid: false,
      error: `Formato no permitido. Solo se aceptan imágenes JPG o PNG. Recibido: ${file.type}`,
    };
  }

  // Validar extensión
  const fileName = file.name.toLowerCase();
  const hasValidExtension = IMAGE_CONFIG.ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
  if (!hasValidExtension) {
    return {
      isValid: false,
      error: `Extensión de archivo no válida. Solo se aceptan: ${IMAGE_CONFIG.ALLOWED_EXTENSIONS.join(", ")}`,
    };
  }

  // Validar tamaño
  if (file.size > IMAGE_CONFIG.MAX_SIZE) {
    const maxSizeMB = IMAGE_CONFIG.MAX_SIZE / (1024 * 1024);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      isValid: false,
      error: `La imagen es demasiado grande (${fileSizeMB}MB). Máximo permitido: ${maxSizeMB}MB`,
    };
  }

  // Validar dimensiones (de forma asincrónica)
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        if (img.width < IMAGE_CONFIG.MIN_WIDTH || img.height < IMAGE_CONFIG.MIN_HEIGHT) {
          resolve({
            isValid: false,
            error: `Imagen muy pequeña. Dimensiones actuales: ${img.width}x${img.height}px. Mínimo requerido: ${IMAGE_CONFIG.MIN_WIDTH}x${IMAGE_CONFIG.MIN_HEIGHT}px`,
          });
        } else {
          resolve({
            isValid: true,
            dimensions: { width: img.width, height: img.height },
          });
        }
      };

      img.onerror = () => {
        resolve({
          isValid: false,
          error: "No se pudo procesar la imagen. Asegúrate de que sea una imagen válida.",
        });
      };

      img.src = e.target.result;
    };

    reader.onerror = () => {
      resolve({
        isValid: false,
        error: "Error al leer el archivo.",
      });
    };

    reader.readAsDataURL(file);
  });
};

/**
 * Obtiene información sobre los requisitos de validación de imagen
 * @returns {Object} Configuración de validación
 */
export const getImageValidationConfig = () => ({
  maxSize: `${IMAGE_CONFIG.MAX_SIZE / (1024 * 1024)}MB`,
  minDimensions: `${IMAGE_CONFIG.MIN_WIDTH}x${IMAGE_CONFIG.MIN_HEIGHT}px`,
  allowedFormats: IMAGE_CONFIG.ALLOWED_EXTENSIONS.join(", "),
});
