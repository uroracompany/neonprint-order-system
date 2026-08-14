import { Icons } from "../../utils/icons";
import { FilterSelect } from "./FilterSelect";
import "./SalesFilterToolbar.css";

export function SalesFilterToolbar({
  ariaLabel = "Filtros",
  search,
  controls = [],
  resultCount,
  resultLabel = "resultados",
  activeFilters = 0,
  onReset,
  className = "",
}) {
  const hasActiveFilters = activeFilters > 0;

  return (
    <section className={`pp-filters pp-filters--sales-standard ${className}`.trim()} aria-label={ariaLabel}>
      {search && (
        <label className="pp-filter-control pp-filter-search">
          <span className="pp-filter-toolbar-sr-only">{search.label}</span>
          <Icons.Search />
          <input
            type="search"
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder}
            aria-label={search.label}
          />
          {search.value && (
            <button type="button" onClick={() => search.onChange("")} aria-label={`Limpiar ${search.label}`}>
              <Icons.X />
            </button>
          )}
        </label>
      )}

      {controls.map((control) => (
        control.type === "date" ? (
          <label className={`pp-filter-control pp-filter-date ${control.className || ""} ${control.isActive ? "is-active" : ""}`} key={control.id}>
            <span className="pp-filter-toolbar-sr-only">{control.label}</span>
            {control.icon || <Icons.Calendar />}
            {control.dateLabel && <span className="pp-filter-date-label" aria-hidden="true">{control.dateLabel}</span>}
            <input
              type="date"
              value={control.value}
              onChange={(event) => control.onChange(event.target.value)}
              aria-label={control.label}
              min={control.min}
              max={control.max}
            />
          </label>
        ) : (
          <FilterSelect
            key={control.id}
            icon={control.icon}
            className={control.className}
            label={control.label}
            value={control.value}
            onChange={control.onChange}
            options={control.options}
            placeholder={control.placeholder || control.label}
            searchable={control.searchable !== false}
            searchPlaceholder={control.searchPlaceholder || `Buscar ${control.label.toLocaleLowerCase()}...`}
            emptyText={control.emptyText}
            isActive={control.isActive}
            allowMultiline={control.allowMultiline}
          />
        )
      ))}

      {typeof resultCount === "number" && (
        <span className="pp-filters-count" aria-live="polite">
          <Icons.Clipboard /> {resultCount} {resultLabel}
        </span>
      )}
      {hasActiveFilters && (
        <>
          <span className="pp-filters-count pp-filters-active-count" aria-live="polite">
            {activeFilters} activo{activeFilters === 1 ? "" : "s"}
          </span>
          <button type="button" className="pp-filter-control pp-filter-reset" onClick={onReset}>
            <Icons.X /> Limpiar filtros
          </button>
        </>
      )}
    </section>
  );
}
