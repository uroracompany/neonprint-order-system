import { adminApiFetch } from "./adminApi";
import { getFileNameFromUrl } from "./constants";
import { isR2OrderAssetUrl } from "./uploadOrderAsset";

export const getDownloadUrl = (url, fileName) => {
  if (!url) return "";
  if (isR2OrderAssetUrl(url)) return url;
  const name = fileName || getFileNameFromUrl(url);
  return url.includes("?") ? `${url}&download=${encodeURIComponent(name)}` : `${url}?download=${encodeURIComponent(name)}`;
};

export const resolveOrderAssetUrl = async (url, expiresIn = 600) => {
  if (!isR2OrderAssetUrl(url)) return url;

  const { response, result } = await adminApiFetch("/api/files-download-url", { url, expiresIn });
  if (!response.ok) {
    throw new Error(result?.error || "No se pudo generar el enlace temporal del archivo.");
  }

  return result?.url || "";
};

export const openOrderAssetUrl = async ({ url, fileName, download = false }) => {
  const resolvedUrl = await resolveOrderAssetUrl(url);
  if (!resolvedUrl) throw new Error("No se pudo abrir el archivo.");

  const finalUrl = download && !isR2OrderAssetUrl(url)
    ? getDownloadUrl(resolvedUrl, fileName)
    : resolvedUrl;

  window.open(finalUrl, "_blank", "noopener,noreferrer");
};
