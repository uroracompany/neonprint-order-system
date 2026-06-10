import { Icons } from "../utils/icons";
import "./FileCard.css";

export default function FileCard({
  name,
  url,
  secondaryText,
  onRemove,
  actions = [],
  children,
}) {
  return (
    <div className="fc-file-item">
      <div className="fc-file-icon">
        <Icons.File />
      </div>
      <div className="fc-file-info">
        <span className="fc-file-name">{name}</span>
        {secondaryText && (
          <span className="fc-file-secondary">{secondaryText}</span>
        )}
      </div>
      {children}
      {url && (
        <a
          href={url}
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
  );
}
