import { useState, useEffect, useCallback, useRef } from 'react';
import { resolveOrderAssetUrl, requiresOrderAssetGateway, openOrderAssetUrl } from '../utils/fileAccess';
import { getStoragePathFromPublicUrl } from '../utils/uploadOrderAsset';

const DEFAULT_EXPIRES_IN = 600;
const SIGNED_URL_REFRESH_MARGIN_MS = 30_000;
const urlCache = new Map();

const normalizeExpiresIn = (value) => Math.max(60, Math.min(Number(value) || DEFAULT_EXPIRES_IN, DEFAULT_EXPIRES_IN));
const getCacheKey = (assetRef, { expiresIn, download }) => `${assetRef}:${expiresIn}:${download}`;

const getCachedEntry = (cacheKey) => {
  const entry = urlCache.get(cacheKey);
  if (!entry || entry.expiresAt <= Date.now()) {
    urlCache.delete(cacheKey);
    return null;
  }
  return entry;
};

const saveCachedEntry = (cacheKey, url, expiresIn) => {
  const entry = {
    url,
    expiresAt: Date.now() + Math.max(1_000, expiresIn * 1_000 - SIGNED_URL_REFRESH_MARGIN_MS),
  };
  urlCache.set(cacheKey, entry);
  return entry;
};

export const getSecureUrlRefreshDelay = (expiresIn = DEFAULT_EXPIRES_IN) => Math.max(1_000, normalizeExpiresIn(expiresIn) * 1_000 - SIGNED_URL_REFRESH_MARGIN_MS);

const getManagedAssetRef = (url = '') => {
  if (!url) return null;
  if (requiresOrderAssetGateway(url)) return url;
  const bucket = url.includes('/order-docs/') ? 'order-docs' : url.includes('/order-previews/') ? 'order-previews' : url.includes('/payment-invoice/') ? 'payment-invoice' : null;
  if (!bucket) return null;
  const path = getStoragePathFromPublicUrl({ bucket, url });
  return path ? `supabase://${bucket}/${encodeURI(path)}` : null;
};

export function useSecureFileUrl(url, options = {}) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState(null);
  const [cacheEntry, setCacheEntry] = useState(null);
  const requestIdRef = useRef(0);
  const expiresIn = normalizeExpiresIn(options.expiresIn);
  const download = options.download === true;

  const resolve = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!url) { setResolvedUrl(null); setError(null); setLoading(false); setCacheEntry(null); return; }
    const assetRef = getManagedAssetRef(url);
    if (!assetRef) { setError('Archivo no reconocido'); setResolvedUrl(null); setLoading(false); setCacheEntry(null); return; }
    const cacheKey = getCacheKey(assetRef, { expiresIn, download });
    const cached = getCachedEntry(cacheKey);
    if (cached) { setResolvedUrl(cached.url); setError(null); setLoading(false); setCacheEntry({ cacheKey, expiresAt: cached.expiresAt }); return; }
    setLoading(true); setError(null);
    try {
      const resolved = await resolveOrderAssetUrl(assetRef, { expiresIn, download });
      if (!resolved) throw new Error('No se pudo resolver el archivo.');
      if (requestId !== requestIdRef.current) return;
      const entry = saveCachedEntry(cacheKey, resolved, expiresIn);
      setResolvedUrl(entry.url); setCacheEntry({ cacheKey, expiresAt: entry.expiresAt });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Error al resolver'); setResolvedUrl(null); setCacheEntry(null);
    } finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [download, expiresIn, url]);

  useEffect(() => { resolve(); return () => { requestIdRef.current += 1; }; }, [resolve]);
  useEffect(() => {
    if (!cacheEntry) return undefined;
    const timer = window.setTimeout(() => { urlCache.delete(cacheEntry.cacheKey); resolve(); }, Math.max(0, cacheEntry.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [cacheEntry, resolve]);

  return { resolvedUrl, loading, error, refresh: resolve, openInNewTab: (fileName) => openOrderAssetUrl({ url, fileName, download: false }), download: (fileName) => openOrderAssetUrl({ url, fileName, download: true }) };
}

export async function resolveBatchSecureUrls(urls, options = {}) {
  const results = new Map(); const toResolve = new Map();
  const expiresIn = normalizeExpiresIn(options.expiresIn); const download = options.download === true;
  urls.forEach(url => { const assetRef = getManagedAssetRef(url); if (!assetRef) results.set(url, null); else toResolve.set(url, assetRef); });
  const concurrencyLimit = 6; const entries = Array.from(toResolve.entries());
  for (let i = 0; i < entries.length; i += concurrencyLimit) {
    const batch = entries.slice(i, i + concurrencyLimit);
    await Promise.all(batch.map(async ([originalUrl, urlToResolve]) => {
      const cacheKey = getCacheKey(urlToResolve, { expiresIn, download });
      const cached = getCachedEntry(cacheKey);
      if (cached) { results.set(originalUrl, cached.url); return; }
      try { const resolved = await resolveOrderAssetUrl(urlToResolve, { expiresIn, download }); if (resolved) { results.set(originalUrl, saveCachedEntry(cacheKey, resolved, expiresIn).url); } else { results.set(originalUrl, null); } } catch { results.set(originalUrl, null); } }));
  }
  return results;
}

export function clearSecureUrlCache() { urlCache.clear(); }
