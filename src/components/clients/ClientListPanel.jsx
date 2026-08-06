import { useState, useEffect, useCallback, useMemo } from "react";
import { Icons } from "../../utils/icons";
import { formatDominicanPhone } from "../../utils/clients";

const PAGE_SIZE = 7;

const SORT_OPTIONS = [
  { value: "name_asc", label: "Nombre A-Z" },
  { value: "name_desc", label: "Nombre Z-A" },
  { value: "last_order_desc", label: "Ultima visita" },
  { value: "most_orders", label: "Mas ordenes" },
];

function formatDate(dateStr) {
  if (!dateStr) return "---";
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ClientListPanel({ supabase, onViewDetail }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name_asc");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("caja_list_clients", {
        p_page: safePage,
        p_page_size: PAGE_SIZE,
        p_search: search || null,
        p_sort: sort,
      });
      if (error) throw error;
      setClients(data || []);
      if (data && data.length > 0) {
        setTotalCount(Number(data[0].total_count) || 0);
      } else if (safePage === 1) {
        setTotalCount(0);
      }
    } catch (err) {
      console.error("Error loading clients:", err);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, safePage, search, sort]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    setPage(1);
  }, [search, sort]);

  const handleSearch = useCallback((e) => {
    setSearch(e.target.value);
  }, []);

  return (
    <div className="pq-clients-panel">
      {/* Filtros */}
      <div className="ps-filters">
        <div className="ps-search-wrap">
          <span className="ps-search-icon"><Icons.Search /></span>
          <input
            className="ps-input with-icon"
            placeholder="Buscar por nombre o telefono..."
            value={search}
            onChange={handleSearch}
          />
          {search && (
            <button className="acm-search-clear" onClick={() => setSearch("")} aria-label="Limpiar busqueda">
              <Icons.X />
            </button>
          )}
        </div>
        <div className="ps-select-wrap">
          <select
            className="ps-input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ minWidth: 160, paddingRight: 32, cursor: "pointer", appearance: "none" }}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="ps-select-arrow"><Icons.ChevronDown /></span>
        </div>
        <span className="ps-filters-count">
          {loading ? "..." : totalCount} cliente{totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tabla */}
      <div className="ps-table-wrap pq-clients-table-wrap">
        <table className="ps-table acm-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Telefono</th>
              <th>Ultima visita</th>
              <th>Ordenes</th>
              <th>Credito</th>
              <th className="pq-clients-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  <td colSpan={6} className="ps-table-empty">
                    <div className="acm-empty-state">Cargando...</div>
                  </td>
                </tr>
              ))
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={6} className="ps-table-empty">
                  <div className="acm-empty-state">
                    <Icons.Users />
                    <strong>No hay clientes</strong>
                    <span>{search ? "Intenta con otros terminos de busqueda." : "No hay clientes registrados aun."}</span>
                  </div>
                </td>
              </tr>
            ) : (
              clients.map((client) => (
                <tr
                  key={client.id}
                  className="row-hover acm-client-row"
                  onClick={() => onViewDetail(client.id)}
                  onKeyDown={(e) => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); onViewDetail(client.id); } }}
                  tabIndex={0}
                >
                  <td className="td-pad">
                    <div className="pq-clients-name-cell">
                      <div className="pa-credit-detail-client-avatar pq-clients-avatar-sm">
                        {client.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="pq-clients-name-text">
                        <strong>{client.name}</strong>
                      </div>
                    </div>
                  </td>
                  <td className="td-pad">
                    <span className="pq-clients-phone">{formatDominicanPhone(client.phone)}</span>
                  </td>
                  <td className="td-pad pq-clients-date">{formatDate(client.last_order_at)}</td>
                  <td className="td-pad">
                    <span className="acm-badge neutral">{client.total_orders || 0}</span>
                  </td>
                  <td className="td-pad">
                    <span className={`acm-badge ${client.pending_credit ? "warning" : "success"}`}>
                      {client.pending_credit ? "Pendiente" : "Libre"}
                    </span>
                  </td>
                  <td className="td-pad td-actions">
                    <div className="table-actions acm-row-actions">
                      <button
                        className="table-action-btn view"
                        onClick={(e) => { e.stopPropagation(); onViewDetail(client.id); }}
                        title="Ver detalles"
                      >
                        <Icons.Eye />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginacion */}
      {totalPages > 1 && (
        <div className="pq-clients-pagination">
          <button
            className="pq-clients-page-btn"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            <Icons.ChevronLeft />
          </button>
          <span className="pq-clients-page-info">
            Pagina {safePage} de {totalPages}
          </span>
          <button
            className="pq-clients-page-btn"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            <Icons.ChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}
