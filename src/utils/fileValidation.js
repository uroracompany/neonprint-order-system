const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"]);
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const ATTACHMENT_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "zip",
  "rar",
  "txt",
  "csv",
  "ai",
  "eps",
  "psd",
  "cdr",
  "svg",
  "tif",
  "tiff",
  "indd",
  "idml",
  "dwg",
  "dxf",
]);

const ATTACHMENT_MIME_TYPES = new Set([
  ...IMAGE_MIME_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "text/plain",
  "text/csv",
  "image/svg+xml",
  "application/postscript",
  "application/illustrator",
  "image/vnd.adobe.photoshop",
]);

const INVISIBLE_EMAIL_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;
const EDGE_EMAIL_SPACES = /^[\s\u00A0]+|[\s\u00A0]+$/g;

export const FILE_UPLOAD_ACCEPT = {
  image: ".png,.jpg,.jpeg,.webp,.gif,.heic,.heif,image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif",
  attachment: [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".zip",
    ".rar",
    ".txt",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".heic",
    ".heif",
    ".ai",
    ".eps",
    ".psd",
    ".cdr",
    ".svg",
    ".tif",
    ".tiff",
    ".indd",
    ".idml",
    ".dwg",
    ".dxf",
  ].join(","),
};

export const getFileExtension = (name = "") => {
  const cleanName = String(name || "").split("?")[0].split("#")[0];
  const lastDot = cleanName.lastIndexOf(".");
  return lastDot >= 0 ? cleanName.slice(lastDot + 1).toLowerCase() : "";
};

export const isAllowedImageFile = (file) => {
  const extension = getFileExtension(file?.name);
  const type = String(file?.type || "").toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) || IMAGE_MIME_TYPES.has(type);
};

export const isAllowedAttachmentFile = (file) => {
  const extension = getFileExtension(file?.name);
  const type = String(file?.type || "").toLowerCase();
  return ATTACHMENT_EXTENSIONS.has(extension) || ATTACHMENT_MIME_TYPES.has(type);
};

export const getAcceptForMode = (mode = "attachment") => (
  mode === "image" ? FILE_UPLOAD_ACCEPT.image : FILE_UPLOAD_ACCEPT.attachment
);

export const getFileModeError = (file, mode = "attachment") => {
  if (!file) return "No se selecciono ningun archivo.";
  if (mode === "image") {
    return isAllowedImageFile(file)
      ? null
      : `"${file.name}" no es una imagen permitida. Usa PNG, JPG, JPEG, WebP, GIF, HEIC o HEIF.`;
  }
  return isAllowedAttachmentFile(file)
    ? null
    : `"${file.name}" no es un adjunto permitido. Usa documentos, ZIP/RAR, TXT/CSV, imagenes o formatos de diseno.`;
};

export const validateFilesForMode = (files, { mode = "attachment", multiple = false, maxFiles, existingCount = 0 } = {}) => {
  const selectedFiles = Array.from(files || []);
  if (!selectedFiles.length) {
    return { valid: false, files: [], error: "No se selecciono ningun archivo." };
  }

  const acceptedFiles = multiple ? selectedFiles : selectedFiles.slice(0, 1);
  const typeError = acceptedFiles.map((file) => getFileModeError(file, mode)).find(Boolean);
  if (typeError) return { valid: false, files: [], error: typeError };

  if (Number.isFinite(maxFiles) && existingCount + acceptedFiles.length > maxFiles) {
    const remaining = Math.max(0, maxFiles - existingCount);
    return {
      valid: false,
      files: [],
      error: remaining > 0
        ? `Solo puedes agregar ${remaining} archivo(s) mas.`
        : `Ya alcanzaste el limite de ${maxFiles} archivo(s).`,
    };
  }

  return { valid: true, files: acceptedFiles, error: null };
};

export const normalizeEmailForAuth = (value) => (
  String(value || "").replace(INVISIBLE_EMAIL_CHARS, "").replace(EDGE_EMAIL_SPACES, "")
);

export const getUploadPolicyForBucket = ({ bucket, category }) => {
  const normalizedBucket = String(bucket || "").trim();
  const normalizedCategory = String(category || "").trim().toLowerCase();

  if (normalizedBucket === "order-previews" || normalizedBucket === "payment-invoice") return "image";
  if (["preview", "reference", "payment"].includes(normalizedCategory)) return "image";
  if (normalizedBucket === "order-docs") return "attachment";
  if (normalizedCategory === "design") return "attachment";
  return null;
};

export const validateUploadPolicy = ({ bucket, category, fileName, contentType }) => {
  const mode = getUploadPolicyForBucket({ bucket, category });
  if (!mode) return { valid: false, error: `Bucket o categoria no permitida: ${bucket || "sin bucket"}.` };

  const file = { name: fileName || "", type: contentType || "" };
  const error = getFileModeError(file, mode);
  return error ? { valid: false, error } : { valid: true, mode };
};
