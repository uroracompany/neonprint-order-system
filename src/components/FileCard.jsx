import { Icons } from "../utils/icons";
import { openOrderAssetUrl } from "../utils/fileAccess";
import { isR2OrderAssetUrl } from "../utils/uploadOrderAsset";
import "./FileCard.css";

export default function FileCard({
  name,
  url,
  secondaryText,
  onRemove,
  actions = [],
  children,
  hideDownload = false,
}) {
  const handleOpen = async (event) => {
    if (!isR2OrderAssetUrl(url)) return;
    event.preventDefault();
    await openOrderAssetUrl({ url, fileName: name, download: true });
  };

  const hasExtraContent = Boolean(children);
  const hasActions = Boolean(url || actions.length > 0 || onRemove);

  return (
    <div className={`fc-file-item${hasExtraContent ? " fc-file-item-with-extra" : ""}`}>
      <div className="fc-file-main">
        <div className="fc-file-icon">
          <Icons.File />
        </div>
        <div className="fc-file-info">
          <span className="fc-file-name">{name}</span>
          {secondaryText && (
            <span className="fc-file-secondary">{secondaryText}</span>
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
              >
                <Icons.Download />
              </a>
            )}
            {actions.map((action, i) => (
              <button
                key={i}
                className="fc-file-action"
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.title}
              >
                {action.icon}
                {action.label && <span>{action.label}</span>}
              </button>
            ))}
            {onRemove && (
              <button
                className="fc-file-action fc-file-action-remove"
                onClick={onRemove}
                title="Eliminar"
              >
                <Icons.X />
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
