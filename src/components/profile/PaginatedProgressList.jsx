import { useEffect, useMemo, useState } from "react";
import { Icons } from "../../utils/icons";
import "./PaginatedProgressList.css";

const ITEMS_PER_PAGE = 4;

export default function PaginatedProgressList({ items, emptyLabel = "Sin datos", accent = "#1d4ed8" }) {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => Array.isArray(items) ? items : [], [items]);
  const totalPages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = rows.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  if (!rows.length) {
    return <div className="profile-progress-empty"><Icons.BarChart /><span>{emptyLabel}</span></div>;
  }

  return (
    <div className="profile-progress-pagination">
      <div className="profile-progress-list">
        {visibleRows.map((item) => {
          const percentage = Math.min(100, Number(item.percentage || 0));
          return (
            <div className="profile-progress-row" key={item.name || item.label}>
              <div className="profile-progress-top">
                <strong>{item.name || item.label || "Sin nombre"}</strong>
                <span>{item.count ?? item.value ?? 0} ordenes</span>
              </div>
              <div className="profile-progress-track" aria-hidden="true">
                <span style={{ width: `${percentage}%`, backgroundColor: accent }} />
              </div>
              <small>{percentage}% de participacion</small>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="profile-progress-controls">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage === 1} aria-label="Pagina anterior"><Icons.ChevronLeft /></button>
          <span>Pagina {safePage} de {totalPages}</span>
          <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage === totalPages} aria-label="Pagina siguiente"><Icons.ChevronRight /></button>
        </div>
      )}
    </div>
  );
}
