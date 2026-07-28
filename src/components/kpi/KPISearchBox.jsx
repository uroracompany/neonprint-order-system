import { Icons } from "../../utils/icons";

export default function KPISearchBox({
  value,
  onChange,
  onClear,
  placeholder,
  label = "Buscar",
  resultCount,
  totalCount,
  disabled = false,
}) {
  const hasValue = Boolean(value);
  const showMeta = Number.isFinite(resultCount) && Number.isFinite(totalCount);

  return (
    <label className={`kpi-search-box ${disabled ? "disabled" : ""}`}>
      <span className="kpi-search-label">{label}</span>
      <div className="kpi-search-control">
        <Icons.Search size={15} />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
        />
        {showMeta && (
          <span className="kpi-search-meta" aria-label={`${resultCount} de ${totalCount} resultados`}>
            {resultCount} de {totalCount}
          </span>
        )}
        {hasValue && (
          <button
            type="button"
            className="kpi-search-clear"
            onClick={onClear}
            aria-label="Limpiar busqueda"
            title="Limpiar busqueda"
            disabled={disabled}
          >
            <Icons.X size={13} />
          </button>
        )}
      </div>
    </label>
  );
}
