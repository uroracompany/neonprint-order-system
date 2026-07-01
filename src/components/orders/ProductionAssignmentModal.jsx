import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { PRODUCTION_AREAS } from "../../utils/constants";
import { getParticipatingProductionAreaCodes, getProductionFiles, hasUnclassifiedProductionFiles } from "../../utils/production";
import { Icons } from "../../utils/icons";
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
      const userResult = roles.length ? await supabase.from("profiles").select("id,name,email,role,employment_status").in("role", roles).eq("employment_status", true) : { data: [] };
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
  return (
    <div className="pam-overlay">
      <section className="pam-modal" role="dialog" aria-modal="true" aria-labelledby="pam-title">
        <header className="pam-header">
          <span className="pam-icon"><Icons.Users /></span>
          <div><span>{title ? "" : "Último paso"}</span><h2 id="pam-title">{title || "Asignar Producción"}</h2><p>Selecciona un responsable por cada área participante.</p></div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><Icons.Close /></button>
        </header>
        <div className="pam-order"><span>#{order.id?.slice(0, 8).toUpperCase()}</span><strong>{order.client_name || order.description || "Orden sin título"}</strong></div>
        <div className="pam-body">
          {loadingOptions ? <div className="pam-empty">Cargando responsables…</div> : areas.map((area) => {
            const options = usersByRole[area.role] || [];
            return <label className="pam-row" key={area.code}>
              <span><strong>{area.label}</strong><small>{counts[area.code] || 0} archivo(s)</small></span>
              <div className="pam-select"><select value={assignments[area.code] || ""} onChange={(event) => { setAssignments((current) => ({ ...current, [area.code]: event.target.value })); setError(""); }} disabled={loading || !options.length}><option value="">Seleccionar responsable</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select><Icons.ChevronDown /></div>
              {!options.length && <small className="pam-row-error">No hay usuarios activos para esta área.</small>}
            </label>;
          })}
          {error && <div className="pam-error"><Icons.AlertCircle />{error}</div>}
        </div>
        <footer><button type="button" className="secondary" onClick={onClose} disabled={loading}>Cancelar</button><button type="button" className="primary" disabled={!ready || loading || loadingOptions} onClick={() => onConfirm(assignments)}>{loading ? "Enviando…" : "Enviar a Producción"}</button></footer>
      </section>
    </div>
  );
}
