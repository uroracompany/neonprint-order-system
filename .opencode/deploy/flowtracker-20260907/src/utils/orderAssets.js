import { parseFileUrls } from "./constants";

const normalizeAssetItem = (item) => {
  if (!item) return null;
  if (typeof item === "string") return item.trim() || null;
  if (typeof item.url === "string") return item.url.trim() || null;
  return null;
};

export const normalizeAssetUrls = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeAssetItem).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return [normalizeAssetItem(value)].filter(Boolean);
  }

  return parseFileUrls(value).map(normalizeAssetItem).filter(Boolean);
};

export const getOrderFiles = (order) => normalizeAssetUrls(order?.order_file_url);
export const getReferenceImages = (order) => normalizeAssetUrls(order?.reference_images);
export const getPreviewImage = (order) => normalizeAssetItem(order?.preview_image);

export const serializeReferenceImages = (urls) => normalizeAssetUrls(urls);

export const hasAnyOrderAsset = (order) => (
  Boolean(getPreviewImage(order)) ||
  getOrderFiles(order).length > 0 ||
  getReferenceImages(order).length > 0
);
