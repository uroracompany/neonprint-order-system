import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icons } from "../../utils/icons";
import { adminApiFetch } from "../../utils/adminApi";
import { getAcceptForMode, validateFilesForMode } from "../../utils/fileValidation";
import "./FileUploadZone.css";

const ERROR_AUTO_DISMISS_MS = 10000;

const DRAGGED_URL_ERROR = "No se pudo importar el archivo arrastrado desde otra pestaña. Si el sitio lo bloquea, descarga la imagen y arrástrala desde tu dispositivo.";

const extractImageUrlFromHtml = (html = "") => {
  if (!html) return "";
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || "";
};

const getDraggedUrl = (dataTransfer) => {
  const uriList = dataTransfer?.getData?.("text/uri-list")
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (uriList) return uriList;

  const htmlImageUrl = extractImageUrlFromHtml(dataTransfer?.getData?.("text/html"));
  if (htmlImageUrl) return htmlImageUrl;

  const plainText = dataTransfer?.getData?.("text/plain")?.trim();
  return /^(https?:|data:image\/|blob:)/i.test(plainText || "") ? plainText : "";
};

const getFilesFromDataTransferItems = (items) => (
  Array.from(items || [])
    .map((item) => (item?.kind === "file" ? item.getAsFile?.() : null))
    .filter(Boolean)
);

const base64ToBlob = (base64, contentType) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
};

const importRemoteFileFromDraggedUrl = async (url, mode) => {
  const { response, result } = await adminApiFetch("/api/files-import-url", { url, mode });
  if (!response.ok) throw new Error(result?.error || DRAGGED_URL_ERROR);
  if (!result?.base64 || !result?.fileName) throw new Error(DRAGGED_URL_ERROR);

  const contentType = result.contentType || "application/octet-stream";
  return new File([base64ToBlob(result.base64, contentType)], result.fileName, { type: contentType });
};

export default function FileUploadZone({
  mode = "attachment",
  multiple = false,
  replaceMode = false,
  buttonLabel,
  hint,
  disabled = false,
  variant = "standard",
  onFilesAccepted,
  onError,
  externalError,
  externalErrorKey,
  className = "",
  maxFiles,
  existingCount = 0,
  inputRef: externalInputRef,
  "aria-label": ariaLabel,
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const zoneRef = useRef(null);
  const errorTimerRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState("");

  const label = buttonLabel || (mode === "image" ? "Subir imagen" : "Subir archivos");
  const Icon = mode === "image" ? Icons.Image : Icons.Upload;
  const isCompact = variant === "compact";

  useEffect(() => () => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current);
    }
  }, []);

  const clearZoneError = () => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setLocalError("");
  };

  const setZoneError = useCallback((message) => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current);
    }

    setLocalError(message);
    errorTimerRef.current = window.setTimeout(() => {
      setLocalError("");
      errorTimerRef.current = null;
    }, ERROR_AUTO_DISMISS_MS);
  }, []);

  const showError = (error, source = "drop") => {
    const message = error instanceof Error ? error.message : String(error || DRAGGED_URL_ERROR);
    setZoneError(message);
    onError?.(message, { source });
  };

  useEffect(() => {
    if (externalError) {
      setZoneError(externalError);
    }
  }, [externalError, externalErrorKey, setZoneError]);

  const handleFiles = (fileList, source) => {
    if (disabled) return;
    const validation = validateFilesForMode(fileList, {
      mode,
      multiple,
      maxFiles,
      existingCount,
    });

    if (!validation.valid) {
      showError(validation.error, source);
      return;
    }

    clearZoneError();
    const acceptedFiles = replaceMode ? validation.files.slice(0, 1) : validation.files;
    const context = {
      source,
      showError: (error) => showError(error, source),
    };

    try {
      const result = onFilesAccepted?.(acceptedFiles, context);
      if (result && typeof result.catch === "function") {
        result.catch((error) => showError(error, source));
      }
    } catch (error) {
      showError(error, source);
    }
  };

  const handleDropFiles = async (dataTransfer) => {
    const itemFiles = getFilesFromDataTransferItems(dataTransfer?.items);
    const directFiles = dataTransfer?.files?.length ? Array.from(dataTransfer.files) : [];
    const files = directFiles.length ? directFiles : itemFiles;

    if (files.length) {
      handleFiles(files, "drop");
      return;
    }

    const draggedUrl = getDraggedUrl(dataTransfer);
    if (!draggedUrl) {
      showError("No se detectó un archivo válido en el elemento arrastrado.", "drop");
      return;
    }

    try {
      const draggedFile = await importRemoteFileFromDraggedUrl(draggedUrl, mode);
      handleFiles([draggedFile], "drop");
    } catch (error) {
      showError(error, "drop");
    }
  };

  const openPicker = () => {
    if (disabled) return;
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const classes = [
    "file-upload-zone",
    `file-upload-zone--${variant}`,
    isFocused ? "is-focused" : "",
    dragOver ? "is-drag-over" : "",
    disabled ? "is-disabled" : "",
    localError ? "is-error" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={zoneRef}
      className={classes}
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-label={ariaLabel || label}
      onClick={() => zoneRef.current?.focus()}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        setDragOver(false);
      }}
      onPaste={(event) => {
        const files = event.clipboardData?.files;
        if (files?.length) {
          event.preventDefault();
          handleFiles(files, "paste");
        }
      }}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        zoneRef.current?.focus();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragOver(false);
        handleDropFiles(event.dataTransfer);
      }}
    >
      <input
        id={inputId}
        ref={(node) => {
          inputRef.current = node;
          if (typeof externalInputRef === "function") externalInputRef(node);
          else if (externalInputRef) externalInputRef.current = node;
        }}
        type="file"
        multiple={multiple}
        accept={getAcceptForMode(mode)}
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files, "picker");
          event.target.value = "";
        }}
      />
      {!isCompact && <div className="file-upload-zone__icon"><Icon /></div>}
      <button
        type="button"
        className="file-upload-zone__button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          openPicker();
        }}
      >
        {isCompact && <Icon aria-hidden="true" />}
        {label}
      </button>
      {hint && <span className="file-upload-zone__hint">{hint}</span>}
      {localError && <span className="file-upload-zone__error">{localError}</span>}
    </div>
  );
}
