import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import {
  TRACKING_NAME_LIMIT,
  TRACKING_NAME_SEARCH_DELAY,
  canonicalizeTrackingName,
  escapeIlikePattern,
  normalizeTrackingName,
  sortTrackingNames,
} from "../../utils/trackingNames";

const getRpcRow = (data) => (Array.isArray(data) ? data[0] : data);

export default function TrackingNameCombobox({ value = "", onChange, disabled = false }) {
  const listboxId = useId();
  const rootRef = useRef(null);
  const requestIdRef = useRef(0);
  const creatingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const [options, setOptions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const queryText = canonicalizeTrackingName(query);
    const requestId = ++requestIdRef.current;
    const delay = queryText ? TRACKING_NAME_SEARCH_DELAY : 0;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        let request = supabase
          .from("production_file_tracking_names")
          .select("id,name")
          .order("name", { ascending: true })
          .limit(TRACKING_NAME_LIMIT);

        if (queryText) request = request.ilike("name", `%${escapeIlikePattern(queryText)}%`);

        const { data, error: requestError } = await request;
        if (requestId !== requestIdRef.current) return;
        if (requestError) throw requestError;

        setOptions(sortTrackingNames(data || []));
        setActiveIndex(data?.length ? 0 : -1);
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return;
        setOptions([]);
        setActiveIndex(-1);
        setError(requestError?.message || "No se pudieron cargar los nombres de seguimiento.");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [open, query]);

  const selectOption = (option) => {
    const nextValue = canonicalizeTrackingName(option?.name);
    onChange?.(nextValue);
    setQuery(nextValue);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleCreate = async () => {
    const nextValue = canonicalizeTrackingName(query);
    if (!nextValue || creating || creatingRef.current) return;

    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const { data, error: createError } = await supabase.rpc("create_production_file_tracking_name", {
        p_name: nextValue,
      });
      if (createError) throw createError;

      const created = getRpcRow(data);
      if (!created?.name) throw new Error("La base de datos no devolvió el nombre creado.");

      const canonicalCreated = canonicalizeTrackingName(created.name);
      onChange?.(canonicalCreated);
      setQuery(canonicalCreated);
      setOptions((current) => sortTrackingNames([...current, { id: created.id, name: canonicalCreated }]));
      setOpen(false);
      setActiveIndex(-1);
    } catch (createError) {
      setError(createError?.message || "No se pudo crear el nombre de seguimiento.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!options.length) return;
      setActiveIndex((current) => event.key === "ArrowDown"
        ? (current + 1) % options.length
        : (current <= 0 ? options.length - 1 : current - 1));
      return;
    }

    if (!open || !options.length) {
      if (event.key === "Enter" && open) setOpen(false);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectOption(options[activeIndex] || options[0]);
    }
  };

  const exactMatch = options.some((option) => normalizeTrackingName(option.name) === normalizeTrackingName(query));
  const canCreate = Boolean(canonicalizeTrackingName(query)) && !exactMatch && !loading && !creating;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className="ps-tracking-name-combobox" ref={rootRef}>
      <div className="ps-tracking-name-input-wrap">
        <input
          className="ps-form-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange?.(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Ej: Banner principal"
          autoComplete="off"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label="Nombre visible en seguimiento"
          aria-busy={loading || creating}
        />
        <span className="ps-tracking-name-chevron" aria-hidden="true"><Icons.ChevronDown /></span>
      </div>

      {open && !disabled && (
        <div className="ps-multimat-dropdown ps-tracking-name-menu" id={listboxId} role="listbox" aria-label="Nombres de seguimiento disponibles">
          {canCreate && (
            <button
              type="button"
              className="ps-multimat-option ps-multimat-add ps-tracking-name-create"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleCreate}
              disabled={creating}
            >
              <Icons.Plus />
              {creating ? "Creando..." : `Crear y usar “${canonicalizeTrackingName(query)}”`}
            </button>
          )}

          {canCreate && <div className="ps-multimat-divider ps-tracking-name-divider" />}

          {loading ? (
            <div className="ps-tracking-name-state" role="status">Cargando nombres...</div>
          ) : error ? (
            <div className="ps-tracking-name-state is-error" role="alert">{error}</div>
          ) : options.length ? (
            options.map((option, index) => (
              <button
                key={option.id}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={normalizeTrackingName(option.name) === normalizeTrackingName(value)}
                className={`ps-multimat-option ps-tracking-name-option ${index === activeIndex ? "is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                {option.name}
              </button>
            ))
          ) : (
            <div className="ps-tracking-name-state">No hay nombres registrados. Puedes escribir uno manualmente.</div>
          )}
        </div>
      )}
    </div>
  );
}
