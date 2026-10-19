const LOCAL_SMOKE_ORIGIN = "http://127.0.0.1:4173";

export function matchesPreviewHostname(hostname, prefix, suffix) {
  if (typeof hostname !== "string" || typeof prefix !== "string" || typeof suffix !== "string") return false;
  const normalizedHost = hostname.toLowerCase();
  const normalizedPrefix = prefix.toLowerCase();
  const normalizedSuffix = suffix.toLowerCase();
  if (!normalizedPrefix || !normalizedSuffix || !normalizedHost.startsWith(normalizedPrefix) || !normalizedHost.endsWith(normalizedSuffix)) return false;
  const generatedLabel = normalizedHost.slice(normalizedPrefix.length, normalizedHost.length - normalizedSuffix.length);
  return generatedLabel.length > 0 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(generatedLabel);
}

export function isAllowedPreviewUrl(rawUrl, prefix, suffix) {
  if (typeof rawUrl !== "string" || /[\\\s]/.test(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1] || "";
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !authority.includes(":") && url.pathname === "/" && !url.search && !url.hash
      && matchesPreviewHostname(url.hostname, prefix, suffix);
  } catch {
    return false;
  }
}

/** Local build smoke is limited to the fixed loopback server from playwright.config.js. */
export function isAllowedLocalSmokeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || /[\\\s]/.test(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    return url.origin === LOCAL_SMOKE_ORIGIN && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const isSafeStaticPath = (pathname) => /^\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs|css|svg|png|jpe?g|webp|gif|woff2?|ttf|otf|eot|ico)$/i.test(pathname)
  || /^\/favicon(?:-[a-z0-9-]+)?\.(?:ico|png|svg)$/i.test(pathname)
  || pathname === "/logo-neonprint.jpg";

/** Pure request policy used by trusted Playwright interception. */
export function isAllowedPreviewRequest(rawUrl, method, previewOrigin, prefix, suffix) {
  if (typeof rawUrl !== "string" || typeof method !== "string" || typeof previewOrigin !== "string") return false;
  try {
    const approved = new URL(previewOrigin);
    const request = new URL(rawUrl);
    const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1] || "";
    if (!isAllowedPreviewUrl(previewOrigin, prefix, suffix)
        || request.protocol !== "https:"
        || request.origin !== approved.origin
        || request.username || request.password || request.port || authority.includes(":")
        || request.hash) return false;

    const normalizedMethod = method.toUpperCase();
    if (request.pathname === "/") return normalizedMethod === "GET" && !request.search;
    return ["GET", "HEAD"].includes(normalizedMethod) && isSafeStaticPath(request.pathname);
  } catch {
    return false;
  }
}

/** Same read-only policy for a local production build served on the fixed loopback port. */
export function isAllowedLocalSmokeRequest(rawUrl, method, baseURL) {
  if (typeof rawUrl !== "string" || typeof method !== "string" || !isAllowedLocalSmokeUrl(baseURL)) return false;
  try {
    const approved = new URL(baseURL);
    const request = new URL(rawUrl);
    if (request.origin !== approved.origin || request.username || request.password || request.hash) return false;

    const normalizedMethod = method.toUpperCase();
    if (request.pathname === "/") return normalizedMethod === "GET" && !request.search;
    return ["GET", "HEAD"].includes(normalizedMethod) && isSafeStaticPath(request.pathname);
  } catch {
    return false;
  }
}
