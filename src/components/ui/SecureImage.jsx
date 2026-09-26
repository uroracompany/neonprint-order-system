import { useState, useEffect } from 'react';
import { getSecureUrlRefreshDelay, useSecureFileUrl, resolveBatchSecureUrls } from '../../hooks/useSecureFileUrl';
import { Icons } from '../../utils/icons';

/**
 * Componente para mostrar una imagen segura (legacy o referencia segura)
 * Maneja loading, error y resolución automática
 */
export function SecureImage({ url, alt, className, onLoad, onError, compact = false, ...props }) {
  const { resolvedUrl, loading, error } = useSecureFileUrl(url);
  
  if (loading) return (
    <div className={`secure-image-loading ${className || ''}`} aria-busy="true" aria-label={compact ? "Cargando imagen" : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: compact ? '60px' : '100px', background: '#f5f5f5', borderRadius: '8px' }}>
      <Icons.Refresh aria-hidden="true" className="spinning" style={{ width: compact ? '16px' : '24px', height: compact ? '16px' : '24px', color: '#888', animation: 'spin 1s linear infinite' }} />
      {!compact && <span style={{ marginLeft: 8, color: '#888', fontSize: '14px' }}>Cargando...</span>}
    </div>
  );
  
  if (error || !resolvedUrl) return (
    <div className={`secure-image-error ${className || ''}`} role="alert" aria-label={compact ? "Imagen no disponible" : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: compact ? '60px' : '100px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', padding: compact ? '6px' : '16px', textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <Icons.AlertCircle aria-hidden="true" style={{ width: compact ? '16px' : '24px', height: compact ? '16px' : '24px' }} />
        {!compact && <>
          <span>No disponible</span>
          {error && <small style={{ opacity: 0.8 }}>{error}</small>}
        </>}
      </div>
    </div>
  );
  
  return <img src={resolvedUrl} alt={alt} onLoad={onLoad} onError={onError} className={className} {...props} />;
}

/**
 * Componente para enlace a imagen segura (abre en nueva pestaña con resolución)
 */
export function SecureImageLink({ url, fileName, children, className, ...props }) {
  const { resolvedUrl, loading, error, openInNewTab } = useSecureFileUrl(url);
  
  const handleClick = (e) => {
    e.preventDefault();
    openInNewTab(fileName);
  };
  
  if (loading) return (
    <span className={`secure-image-loading ${className || ''}`} aria-busy="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#f5f5f5', borderRadius: '6px' }}>
      <Icons.Refresh aria-hidden="true" className="spinning" style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
      <span>Cargando...</span>
    </span>
  );
  
  if (error || !resolvedUrl) return (
    <span className={`secure-image-error ${className || ''}`} role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626' }}>
      <Icons.AlertCircle style={{ width: '16px', height: '16px' }} />
      <span>No disponible</span>
    </span>
  );
  
  return (
    <a href={resolvedUrl} onClick={handleClick} target="_blank" rel="noopener noreferrer" className={className} {...props}>
      {typeof children === "function" ? children(resolvedUrl) : children}
    </a>
  );
}

/**
 * Componente para galerías de imágenes con batch resolution (evita N+1)
 */
export function SecureImageGallery({ urls, fileNames, altPrefix = 'Imagen', className, itemClassName }) {
  const [resolvedMap, setResolvedMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState(new Set());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const urlsKey = JSON.stringify(urls);
  
  useEffect(() => {
    let active = true;
    const effectUrls = JSON.parse(urlsKey);
    setLoading(true);
    setErrors(new Set());
    resolveBatchSecureUrls(effectUrls).then(results => {
      if (!active) return;
      setResolvedMap(results);
      setLoading(false);
      setErrors(new Set([...results].filter(([, resolvedUrl]) => !resolvedUrl).map(([url]) => url)));
    });

    const refreshTimer = window.setTimeout(() => {
      if (active) setRefreshVersion(current => current + 1);
    }, getSecureUrlRefreshDelay());

    return () => { active = false; window.clearTimeout(refreshTimer); };
  }, [refreshVersion, urlsKey]);
  
  if (loading) return (
    <div className={`secure-gallery-loading ${className || ''}`} style={{ display: 'flex', gap: '12px', padding: '16px', minHeight: '120px' }}>
      {[...Array(Math.min(urls.length, 6))].map((_, i) => (
        <div key={i} style={{ width: '120px', height: '120px', background: '#f0f0f0', borderRadius: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
  
  return (
    <div className={`secure-gallery ${className || ''}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
      {urls.map((url, i) => {
        const resolved = resolvedMap.get(url);
        const hasError = errors.has(url);
        const fileName = fileNames?.[i] || `${altPrefix} ${i + 1}`;
        
        if (hasError || !resolved) return (
          <div key={i} className="secure-gallery-error" style={{ width: '120px', height: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', padding: '8px', textAlign: 'center' }} title={fileName}>
            <Icons.Image style={{ width: '24px', height: '24px' }} />
            <span style={{ fontSize: '11px', marginTop: 4 }}>{fileName}</span>
          </div>
        );
        
        return (
          <a key={i} href={resolved} target="_blank" rel="noopener noreferrer" className={itemClassName} style={{ flex: '0 0 auto', textDecoration: 'none' }}>
            <img src={resolved} alt={fileName} loading="lazy" style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e5e7eb', transition: 'transform 0.2s, box-shadow 0.2s' }} onMouseEnter={e => { e.target.style.transform = 'scale(1.05)'; e.target.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)'; }} onMouseLeave={e => { e.target.style.transform = 'scale(1)'; e.target.style.boxShadow = 'none'; }} />
          </a>
        );
      })}
    </div>
  );
}
