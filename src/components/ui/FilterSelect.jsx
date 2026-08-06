import { useEffect, useRef, useState, useCallback, useId } from "react";
import { Icons } from "../../utils/icons";
import "./FilterSelect.css";

export function FilterSelect({
  icon,
  value,
  onChange,
  options = [],
  placeholder = "Seleccionar",
  className = "",
}) {
  const listboxId = useId();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedOption = options.find((o) => o.value === value) || null;
  const selectedLabel = selectedOption ? selectedOption.label : placeholder;

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

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

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % options.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? options.length - 1 : current - 1));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (options[activeIndex]) selectOption(options[activeIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    },
    [open, options, activeIndex, selectOption]
  );

  return (
    <div className={`pp-filter-select-wrap ${className}`} ref={ref}>
      <button
        type="button"
        className={`pp-filter-control pp-filter-select-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
      >
        {icon && <span className="pp-filter-select-icon">{icon}</span>}
        <span className="pp-filter-select-label">{selectedLabel}</span>
        <Icons.ChevronDown />
      </button>

      {open && (
        <div className="pp-filter-dropdown" id={listboxId} role="listbox" aria-label="Opciones de filtro">
          {options.map((option, index) => (
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
        </div>
      )}
    </div>
  );
}
