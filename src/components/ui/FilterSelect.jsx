import { useEffect, useRef, useState, useCallback, useId, useMemo } from "react";
import { Icons } from "../../utils/icons";
import "./FilterSelect.css";

const normalizeSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase();

const MULTILINE_LABEL_THRESHOLD = 22;

export function FilterSelect({
  icon,
  value,
  onChange,
  options = [],
  placeholder = "Seleccionar",
  className = "",
  label = "Opciones de filtro",
  searchable = false,
  searchPlaceholder = "Buscar opciones...",
  emptyText = "No se encontraron opciones.",
  isActive = false,
  allowMultiline = false,
}) {
  const listboxId = useId();
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState("");

  const selectedOption = options.find((o) => o.value === value) || null;
  const selectedLabel = selectedOption ? selectedOption.label : placeholder;
  const shouldUseMultiline = allowMultiline && selectedLabel.length > MULTILINE_LABEL_THRESHOLD;
  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query.trim());
    if (!searchable || !normalizedQuery) return options;
    return options.filter((option) => normalizeSearchText(option.label).includes(normalizedQuery));
  }, [options, query, searchable]);

  useEffect(() => {
    if (open) {
      const idx = visibleOptions.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : (visibleOptions.length > 0 ? 0 : -1));
    }
  }, [open, value, visibleOptions]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    if (searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selectOption = useCallback(
    (option) => {
      onChange?.(option.value);
      setOpen(false);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (!open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setOpen(true);
        }
        return;
      }

      if (visibleOptions.length === 0) {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % visibleOptions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? visibleOptions.length - 1 : current - 1));
      } else if (event.key === "Enter" || (event.key === " " && event.currentTarget !== searchRef.current)) {
        event.preventDefault();
        if (visibleOptions[activeIndex]) selectOption(visibleOptions[activeIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    },
    [open, visibleOptions, activeIndex, selectOption]
  );

  return (
    <div className={`pp-filter-select-wrap ${className}`} ref={ref}>
      <button
        type="button"
        className={`pp-filter-control pp-filter-select-trigger ${shouldUseMultiline ? "pp-filter-select-trigger--multiline" : ""} ${open ? "is-open" : ""} ${isActive ? "is-active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-label={label}
        title={selectedLabel}
      >
        {icon && <span className="pp-filter-select-icon">{icon}</span>}
        <span className="pp-filter-select-label">{selectedLabel}</span>
        <Icons.ChevronDown />
      </button>

      {open && (
        <div className="pp-filter-dropdown" id={listboxId} role="listbox" aria-label={label}>
          {searchable && (
            <div className="pp-filter-dropdown-search">
              <Icons.Search />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                aria-label={`Buscar en ${label}`}
                autoComplete="off"
              />
            </div>
          )}
          {visibleOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`pp-filter-dropdown-option ${option.value === value ? "selected" : ""} ${index === activeIndex ? "active" : ""}`}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {option.label}
            </button>
          ))}
          {visibleOptions.length === 0 && <p className="pp-filter-dropdown-empty">{emptyText}</p>}
        </div>
      )}
    </div>
  );
}
