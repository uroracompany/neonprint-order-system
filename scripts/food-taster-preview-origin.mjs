const LOCAL_SMOKE_ORIGIN = "http://127.0.0.1:4173";
const STAGING_HOST = "neonprint-order-system-food-taster.vercel.app";
const STAGING_BRANCH_REF = "codex/food-taster-preview-runner";
const STAGING_PROJECT_ALIAS_PREFIX = "neonprint-order-system-food-taster-git-";
const STAGING_TEAM_ALIAS_SUFFIX = "-urora-companys-projects.vercel.app";

export function vercelBranchSlug(headRef) {
  if (typeof headRef !== "string" || !headRef || headRef.length > 200
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$/.test(headRef)
      || headRef.includes("..") || headRef.includes("//")) return null;
  const slug = headRef.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug && slug.length <= 180 ? slug : null;
}

export function matchesPreviewHostname(hostname, headRef) {
  if (typeof hostname !== "string" || hostname !== hostname.toLowerCase()) return false;
  if (hostname === STAGING_HOST) return headRef === STAGING_BRANCH_REF;
  const branchSlug = vercelBranchSlug(headRef);
  if (!branchSlug) return false;
  const expectedHost = `${STAGING_PROJECT_ALIAS_PREFIX}${branchSlug}${STAGING_TEAM_ALIAS_SUFFIX}`;
  return hostname === expectedHost;
}

export function isAllowedPreviewUrl(rawUrl, headRef) {
  if (typeof rawUrl !== "string" || /[\\\s]/.test(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1] || "";
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !authority.includes(":") && url.pathname === "/" && !url.search && !url.hash
      && matchesPreviewHostname(url.hostname, headRef);
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
export function isAllowedPreviewRequest(rawUrl, method, previewOrigin, headRef) {
  if (typeof rawUrl !== "string" || typeof method !== "string" || typeof previewOrigin !== "string") return false;
  try {
    const approved = new URL(previewOrigin);
    const request = new URL(rawUrl);
    const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1] || "";
    if (!isAllowedPreviewUrl(previewOrigin, headRef)
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
