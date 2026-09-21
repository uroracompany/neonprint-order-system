import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { PRODUCTION_AREAS } from "../../utils/constants";
import { getParticipatingProductionAreaCodes, getProductionFiles, hasUnclassifiedProductionFiles } from "../../utils/production";
import { Icons } from "../../utils/icons";
import "../../css-components/page-quote.css";
import "./ProductionAssignmentModal.css";

export default function ProductionAssignmentModal({ open, onClose, onConfirm, order, loading, title }) {
  const [areas, setAreas] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState("");
  const productionFiles = useMemo(() => getProductionFiles(order), [order]);
  const participating = useMemo(() => getParticipatingProductionAreaCodes(productionFiles), [productionFiles]);
  const unclassified = useMemo(() => hasUnclassifiedProductionFiles(productionFiles), [productionFiles]);
  const counts = useMemo(() => productionFiles.reduce((result, file) => {
    if (file.production_area_code) result[file.production_area_code] = (result[file.production_area_code] || 0) + 1;
    return result;
  }, {}), [productionFiles]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setAssignments({}); setError(""); setLoadingOptions(true);
    (async () => {
      const { data: areaData } = await supabase.from("production_areas").select("code,label,producer_role,is_active").eq("is_active", true);
      const source = Array.isArray(areaData) && areaData.length ? areaData.map((item) => ({ code: item.code, label: item.label, role: item.producer_role })) : PRODUCTION_AREAS;
      const nextAreas = source.filter((item) => participating.includes(item.code));
      const roles = [...new Set(nextAreas.map((item) => item.role).filter(Boolean))];
      const userResult = roles.length ? await supabase.from("profiles").select("id,name,email,role,employment_status,deleted_at").in("role", roles).eq("employment_status", true).is("deleted_at", null) : { data: [] };
      if (!active) return;
      setAreas(nextAreas); setUsers(userResult.data || []); setLoadingOptions(false);
      if (unclassified) setError("Clasifica todos los archivos antes de continuar.");
      else if (!nextAreas.length) setError("La orden no tiene archivos clasificados para producción.");
    })();
    return () => { active = false; };
  }, [open, participating, unclassified]);

  if (!open || !order) return null;
  const usersByRole = users.reduce((result, item) => ({ ...result, [item.role]: [...(result[item.role] || []), item] }), {});
  const ready = areas.length > 0 && !unclassified && areas.every((area) => assignments[area.code]);

  const areaIconMap = {
    dtf: <Icons.Package />,
    digital: <Icons.Image />,
    plotter: <Icons.Truck />,
    ploteo: <Icons.Truck />,
    serigrafia: <Icons.Brush />,
    screen: <Icons.Brush />,
    corte: <Icons.Edit />,
    cutting: <Icons.Edit />,
    laminado: <Icons.File />,
    lamination: <Icons.File />,
    terminacion: <Icons.CheckCircle />,
    finishing: <Icons.CheckCircle />,
    sublimacion: <Icons.Paintbrush />,
    sublimation: <Icons.Paintbrush />,
    vinil: <Icons.FileText />,
    vinyl: <Icons.FileText />,
    impresion: <Icons.Upload />,
    printing: <Icons.Upload />,
  };
  const getAreaIcon = (code) => areaIconMap[String(code).toLowerCase()] || <Icons.Package />;
  const formatAreaLabel = (label) => label;

  return (
    <div className="pq-overlay" onClick={(event) => event.target === event.currentTarget && !loading && onClose()}>
      <div className="pq-dialog pq-dialog--production-assignment pq-dialog--return-designer" role="dialog" aria-modal="true" aria-labelledby="pam-title" aria-describedby="pam-description">
        <header className="pq-dialog-header pq-dialog-header--delivery">
          <div className="pq-dialog-header-content">
            {order.id && <span className="pq-production-header-code">#{order.id.slice(0, 8).toUpperCase()}</span>}
            <h3 className="pq-dialog-title" id="pam-title">{title || "Asignar Producción"}</h3>
          </div>
          <button type="button" className="pq-icon-btn" onClick={onClose} aria-label="Cerrar"><Icons.Close /></button>
        </header>
        <div className="pq-production-dialog-body">
          <p className="pq-dialog-text pq-dialog-text--blue" id="pam-description">Selecciona un responsable por cada área participante.</p>
          <div className="pq-production-assignment-list">
            {loadingOptions ? (
              <div className="pq-production-loading" role="status">Cargando responsables…</div>
            ) : (
              areas.map((area) => {
                const options = usersByRole[area.role] || [];
                return (
                  <label className="pq-production-assignment-row" key={area.code}>
                    <div className="pq-production-area-copy">
                      <strong><span className="pq-area-icon">{getAreaIcon(area.code)}</span>{formatAreaLabel(area.label)}</strong>
                      <small className="pq-production-file-count">{counts[area.code] || 0} archivo{counts[area.code] !== 1 ? "s" : ""}</small>
                    </div>
                    <div className="pq-select">
                      <select
                        value={assignments[area.code] || ""}
                        onChange={(event) => {
                          setAssignments((current) => ({ ...current, [area.code]: event.target.value }));
                          setError("");
                        }}
                        disabled={loading || !options.length}
                        className="pq-input"
                      >
                        <option value="">Seleccionar responsable</option>
                        {options.map((item) => (
                          <option key={item.id} value={item.id}>{item.name || item.email}</option>
                        ))}
                      </select>
                      <Icons.ChevronDown />
                    </div>
                    {!options.length && (
                      <small className="pq-production-row-error">No hay usuarios activos para esta área.</small>
                    )}
                  </label>
                );
              })
            )}
          </div>
          {error && <div className="pq-production-error" role="alert"><Icons.AlertCircle />{error}</div>}
        </div>
        <footer className="pq-production-dialog-footer">
          <div className="pq-dialog-actions">
            <button type="button" className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
            <button type="button" className="pq-btn pq-btn-primary" disabled={!ready || loading || loadingOptions} onClick={() => onConfirm(assignments)}>
              {loading ? "Enviando…" : <><Icons.Send />Enviar a Producción</>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
