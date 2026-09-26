import { useState } from "react";
import { Icons } from "../utils/icons";
import { openOrderAssetUrl, requiresOrderAssetGateway } from "../utils/fileAccess";
import "./FileCard.css";

export default function FileCard({
  name,
  url,
  secondaryText,
  detailText,
  onRemove,
  removeIcon,
  removeTitle = "Eliminar",
  actions = [],
  children,
  hideDownload = false,
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");

  const handleOpen = async (event) => {
    if (!requiresOrderAssetGateway(url)) return;
    event.preventDefault();
    if (opening) return;

    setOpening(true);
    setOpenError("");
    try {
      await openOrderAssetUrl({ url, fileName: name, download: true });
    } catch (error) {
      setOpenError(error?.message || "No se pudo descargar el archivo. Inténtalo nuevamente.");
    } finally {
      setOpening(false);
    }
  };

  const hasExtraContent = Boolean(children);
  const hasActions = Boolean(url || actions.length > 0 || onRemove);

  return (
    <div
      className={`fc-file-item${hasExtraContent ? " fc-file-item-with-extra" : ""}`}
      aria-busy={opening || undefined}
    >
      <div className="fc-file-main">
        <div className="fc-file-icon">
          <Icons.File />
        </div>
        <div className="fc-file-info">
          <span className="fc-file-name">{name}</span>
          {secondaryText && (
            <span className="fc-file-meta">{secondaryText}</span>
          )}
          {detailText && (
            <span className="fc-file-secondary">{detailText}</span>
          )}
          {openError && (
            <span className="fc-file-secondary" role="alert">{openError}</span>
          )}
          {opening && (
            <span className="fc-file-secondary" role="status">Preparando descarga…</span>
          )}
        </div>
        {hasActions && (
          <div className="fc-file-actions">
            {url && !hideDownload && (
              <a
                href={url}
                onClick={handleOpen}
                target="_blank"
                rel="noopener noreferrer"
                className="fc-file-action"
                title="Descargar"
                aria-label={opening ? `Preparando descarga de ${name}` : `Descargar ${name}`}
                aria-disabled={opening || undefined}
                tabIndex={opening ? -1 : undefined}
              >
                <Icons.Download />
              </a>
            )}
            {actions.map((action, i) => (
              <button
                key={i}
                type="button"
                className={`fc-file-action${action.attention ? " fc-file-action-attention" : ""}`}
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.title}
                data-details-pending={action.attention ? "true" : undefined}
              >
                {action.icon}
                {action.label && <span>{action.label}</span>}
              </button>
            ))}
            {onRemove && (
              <button
                type="button"
                className="fc-file-action fc-file-action-remove"
                onClick={onRemove}
                title={removeTitle}
                aria-label={removeTitle}
              >
                {removeIcon || <Icons.X />}
              </button>
            )}
          </div>
        )}
      </div>
      {hasExtraContent && (
        <div className="fc-file-extra">
          {children}
        </div>
      )}
    </div>
  );
}
