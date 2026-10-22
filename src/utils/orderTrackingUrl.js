export const PUBLIC_TRACKING_ORIGIN = "https://neonprintrd.com";

export function buildOrderTrackingUrl(token) {
  if (typeof token !== "string" || token.length === 0) return null;

  return `${PUBLIC_TRACKING_ORIGIN}/track/${encodeURIComponent(token)}`;
}
