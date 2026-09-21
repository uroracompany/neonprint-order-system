import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { PRODUCTION_FILE_STATUS } from "../../utils/constants";
import { getProductionFileStatusLabel } from "../../utils/production";
import "./ProductionFileTransferModal.css";

const TRANSFERABLE_STATUSES = new Set([
  PRODUCTION_FILE_STATUS.PENDING,
  PRODUCTION_FILE_STATUS.IN_PRODUCTION,
]);

export default function ProductionFileTransferModal({
  open,
  order,
  files = [],
  onClose,
  onTransferred,
}) {
  const [candidates, setCandidates] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [targetUserId, setTargetUserId] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const transferableFiles = useMemo(() => (
    files.filter((file) => TRANSFERABLE_STATUSES.has(file.status))
  ), [files]);

  useEffect(() => {
    if (!open || !order?.id) return undefined;

    let active = true;
    setCandidates([]);
    setSelectedFileIds([]);
    setTargetUserId("");
    setError("");
    setLoadingCandidates(true);

    supabase
      .rpc("get_production_file_transfer_candidates", { p_order_id: order.id })
      .then(({ data, error: fetchError }) => {
        if (!active) return;
        if (fetchError) {
          setError(fetchError.message || "No se pudieron cargar los operadores disponibles.");
          return;
        }
        setCandidates(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        if (active) setLoadingCandidates(false);
      });

    return () => { active = false; };
  }, [open, order?.id]);

  const toggleFile = (fileId) => {
    setSelectedFileIds((current) => (
      current.includes(fileId)
        ? current.filter((id) => id !== fileId)
        : [...current, fileId]
    ));
    setError("");
  };

  const handleSubmit = async () => {
    if (selectedFileIds.length === 0) {
      setError("Selecciona al menos un archivo para traspasar.");
      return;
    }
    if (!targetUserId) {
      setError("Selecciona el operador que recibirá los archivos.");
      return;
    }

    const selectedFiles = transferableFiles.filter((file) => selectedFileIds.includes(file.id));
    if (selectedFiles.some((file) => !file.updated_at)) {
      setError("Uno de los archivos no tiene una versión válida. Actualiza la orden e inténtalo nuevamente.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const { data, error: transferError } = await supabase.rpc("transfer_production_files", {
        p_order_id: order.id,
        p_target_user_id: targetUserId,
        p_files: selectedFiles.map((file) => ({
          id: file.id,
          expected_updated_at: file.updated_at,
        })),
      });

      if (transferError) throw transferError;
      await onTransferred?.(data);
      onClose?.();
    } catch (transferError) {
      const message = transferError?.message || "No se pudieron traspasar los archivos.";
      setError(message === "FILE_STALE"
        ? "La orden cambió mientras la estabas revisando. Actualízala e inténtalo nuevamente."
        : message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !order) return null;

  return (
    <div className="pftm-overlay" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="pftm-dialog" role="dialog" aria-modal="true" aria-labelledby="pftm-title">
        <header className="pftm-header">
          <div>
            <span className="pftm-kicker"><Icons.ArrowRight /> Producción</span>
            <h3 id="pftm-title">Traspasar archivos</h3>
            <p>El destinatario asumirá la responsabilidad solo de los archivos seleccionados.</p>
          </div>
          <button type="button" className="pftm-close" onClick={onClose} disabled={submitting} aria-label="Cerrar modal de traspaso">
            <Icons.Close />
          </button>
        </header>

        <div className="pftm-body">
          <div className="pftm-order">Orden #{order.id?.slice(0, 8).toUpperCase()}</div>

          <fieldset className="pftm-fieldset" disabled={submitting || loadingCandidates}>
            <legend>Archivos a traspasar</legend>
            <p className="pftm-help">Solo puedes transferir tus archivos pendientes o en producción.</p>
            {transferableFiles.length === 0 ? (
              <p className="pftm-empty">No tienes archivos disponibles para traspasar en esta orden.</p>
            ) : (
              <div className="pftm-file-list">
                {transferableFiles.map((file) => {
                  const selected = selectedFileIds.includes(file.id);
                  return (
                    <label className={`pftm-file ${selected ? "selected" : ""}`} key={file.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleFile(file.id)}
                      />
                      <span className="pftm-file-check"><Icons.Check /></span>
                      <span className="pftm-file-copy">
                        <strong>{file.filename || "Archivo de producción"}</strong>
                        <small>{getProductionFileStatusLabel(file.status)} · Responsable actual: Tú</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <label className="pftm-recipient">
            <span>Enviar a</span>
            {loadingCandidates ? (
              <span className="pftm-loading">Cargando operadores de tu área…</span>
            ) : (
              <select value={targetUserId} onChange={(event) => { setTargetUserId(event.target.value); setError(""); }} disabled={submitting || candidates.length === 0}>
                <option value="">Selecciona un operador</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                ))}
              </select>
            )}
            {!loadingCandidates && candidates.length === 0 && !error && (
              <small className="pftm-empty">No hay otro operador activo disponible en tu área.</small>
            )}
          </label>

          {error && <p className="pftm-error" role="alert"><Icons.AlertCircle /> {error}</p>}
        </div>

        <footer className="pftm-footer">
          <button type="button" className="pftm-button secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button
            type="button"
            className="pftm-button primary"
            onClick={handleSubmit}
            disabled={submitting || loadingCandidates || transferableFiles.length === 0 || candidates.length === 0}
          >
            {submitting ? "Traspasando…" : <><Icons.ArrowRight /> Traspasar seleccionados</>}
          </button>
        </footer>
      </section>
    </div>
  );
}
