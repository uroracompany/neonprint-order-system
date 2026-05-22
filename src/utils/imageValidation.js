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
