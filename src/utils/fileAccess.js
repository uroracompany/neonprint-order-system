import { adminApiFetch } from "./adminApi";
import { getFileNameFromUrl } from "./constants";
import { isR2OrderAssetUrl, isSupabaseOrderAssetRef } from "./uploadOrderAsset";

export const getDownloadUrl = (url, fileName) => {
  if (!url) return "";
  if (isR2OrderAssetUrl(url)) return url;
  const name = fileName || getFileNameFromUrl(url);
  return url.includes("?") ? `${url}&download=${encodeURIComponent(name)}` : `${url}?download=${encodeURIComponent(name)}`;
};

export const requiresOrderAssetGateway = (url = "") => (
  isR2OrderAssetUrl(url)
  || isSupabaseOrderAssetRef(url)
  || /\/storage\/v1\/object\/(?:public|sign|authenticated)\//.test(url)
);

export const resolveOrderAssetUrl = async (url, options = {}) => {
  if (!url) return "";
  const { expiresIn = 600, download = false } = typeof options === "number"
    ? { expiresIn: options }
    : options;
  if (!requiresOrderAssetGateway(url)) return url;

  const { response, result } = await adminApiFetch("/api/files", {
    action: "resolve-download",
    assetRef: url,
    expiresIn,
    download,
  });
  if (!response.ok) {
    throw new Error(result?.error || "No se pudo generar el enlace temporal del archivo.");
  }

  return result?.url || "";
};

export const openOrderAssetUrl = async ({ url, fileName, download = false }) => {
  const needsGateway = requiresOrderAssetGateway(url);
  const destination = needsGateway ? window.open("", "_blank") : null;

  if (destination) {
    try {
      destination.opener = null;
    } catch {
      // Some browser window proxies do not permit changing opener directly.
    }
  }

  try {
    const resolvedUrl = await resolveOrderAssetUrl(url, { download });
    if (!resolvedUrl) throw new Error("No se pudo abrir el archivo.");

    const finalUrl = download && !needsGateway
      ? getDownloadUrl(resolvedUrl, fileName)
      : resolvedUrl;

    if (destination) {
      destination.location.assign(finalUrl);
      return;
    }

    window.open(finalUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    destination?.close();
    throw error;
  }
};
