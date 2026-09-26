import { useEffect } from "react";
import { Icons } from "../../utils/icons";
import "./ImagePreviewModal.css";

export default function ImagePreviewModal({ open, imageUrl, alt, onClose }) {
  useEffect(() => {
    if (!open) return;
    const handler = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !imageUrl) return null;

  return (
    <div className="ipm-overlay" onClick={onClose}>
      <div className="ipm-shell" onClick={(e) => e.stopPropagation()}>
        <button className="ipm-close" onClick={onClose} aria-label="Cerrar vista previa">
          <Icons.X />
        </button>
        <img src={imageUrl} alt={alt || "Vista previa"} className="ipm-image" />
      </div>
    </div>
  );
}
