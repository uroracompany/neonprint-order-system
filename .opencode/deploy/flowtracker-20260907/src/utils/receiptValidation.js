import { validateImage } from "./imageValidation";
import { formatFileSize, getOrderAssetLimit, validateOrderAssetSize } from "./uploadOrderAsset";

export const PAYMENT_RECEIPT_BUCKET = "payment-invoice";
export const PAYMENT_RECEIPT_HINT = `PNG, JPG, JPEG, WebP, GIF, HEIC o HEIF. Max. ${formatFileSize(getOrderAssetLimit(PAYMENT_RECEIPT_BUCKET))}`;

export const isReceiptPreviewUnavailable = (file) => {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "");
  return /\.(heic|heif)$/i.test(name) || ["image/heic", "image/heif"].includes(type);
};

export const validateReceiptFile = async (file) => {
  const sizeError = validateOrderAssetSize({ bucket: PAYMENT_RECEIPT_BUCKET, file });
  if (sizeError) {
    return { isValid: false, error: sizeError };
  }

  const validation = await validateImage(file);
  if (!validation?.isValid) {
    return {
      isValid: false,
      error: validation?.error || "La imagen no cumple con los requisitos.",
    };
  }

  return {
    isValid: true,
    previewAvailable: validation.previewAvailable !== false && !isReceiptPreviewUnavailable(file),
  };
};
