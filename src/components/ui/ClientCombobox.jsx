import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icons } from "../../utils/icons";
import {
  filterClientsByQuery,
  formatDominicanPhone,
  getClientDisplayName,
  NO_CLIENT_FILTER_VALUE,
} from "../../utils/clients";
import "./ClientCombobox.css";

const DEFAULT_SEARCH_DELAY = 180;

function useClientLookup({
  clients,
  onSearch,
  query,
  open,
  minSearchLength = 1,
  showAllWhenEmpty = false,
  delay = DEFAULT_SEARCH_DELAY,
}) {
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const [asyncClients, setAsyncClients] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    if (!open || !onSearch) return undefined;

    if (trimmedQuery.length < minSearchLength) {
      setAsyncClients([]);
      setSearchError("");
      setSearching(false);
      return undefined;
    }

    let active = true;
    setSearching(true);
    setSearchError("");

    const timeout = setTimeout(async () => {
      try {
        const results = await onSearch(trimmedQuery);
        if (active) setAsyncClients(results || []);
      } catch (err) {
        if (active) {
          setAsyncClients([]);
          setSearchError(err?.message || "No se pudieron buscar clientes.");
        }
      } finally {
        if (active) setSearching(false);
      }
    }, delay);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [delay, minSearchLength, onSearch, open, trimmedQuery]);

  const localClients = useMemo(() => {
    if (!trimmedQuery && showAllWhenEmpty) return clients || [];
    return filterClientsByQuery(clients, trimmedQuery);
  }, [clients, showAllWhenEmpty, trimmedQuery]);

  const visibleClients = onSearch && trimmedQuery.length >= minSearchLength ? asyncClients : localClients;

  return {
    visibleClients,
    searching,
    searchError,
    showPrompt: Boolean(open && !showAllWhenEmpty && trimmedQuery.length < minSearchLength),
  };
}

function ClientSuggestionList({
  clients,
  value,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  listboxId,
}) {
  return clients.map((client, index) => (
    <button
      key={client.id}
      id={`${listboxId}-option-${index}`}
      type="button"
      role="option"
      aria-selected={client.id === value}
      className={`client-lookup-option ${client.id === value ? "selected" : ""} ${index === activeIndex ? "active" : ""}`}
      onMouseEnter={() => onActiveIndexChange(index)}
      onClick={() => onSelect(client)}
    >
      <span className="client-lookup-option-copy">
        <strong>{client.name}</strong>
        <small>{formatDominicanPhone(client.phone) || "Sin telefono"}</small>
      </span>
    </button>
  ));
}

export function ClientSelect({
  clients = [],
  value,
  onSelect,
  onSearch,
  placeholder = "Seleccionar cliente registrado",
  searchPlaceholder = "Buscar por nombre o telefono...",
  className = "",
  disabled = false,
  minSearchLength = 1,
}) {
  const listboxId = useId();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === value) || null,
    [clients, value]
  );

  const { visibleClients } = useClientLookup({
    clients,
    onSearch,
    query,
    open,
    minSearchLength,
    showAllWhenEmpty: true,
  });

  useEffect(() => {
    setActiveIndex(visibleClients.length > 0 ? 0 : -1);
  }, [visibleClients]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selectClient = (client) => {
    onSelect?.(client);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (!open || visibleClients.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleClients.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? visibleClients.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectClient(visibleClients[activeIndex] || visibleClients[0]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className={`client-select ${className}`} ref={ref}>
      <button
        type="button"
        className={`client-select-trigger ${open ? "is-open" : ""} ${selectedClient ? "has-selection" : ""}`}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="client-select-trigger-copy">
          <strong>{selectedClient ? selectedClient.name : placeholder}</strong>
          <small>{formatDominicanPhone(selectedClient?.phone) || "Cliente registrado"}</small>
        </span>
        <span className="client-select-arrow" aria-hidden="true"><Icons.ChevronDown /></span>
      </button>

      {open && !disabled && (
        <div className="client-lookup-menu client-select-menu" id={listboxId} role="listbox">
          <div className="client-select-search-wrap">
            <input
              className="client-select-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              autoComplete="off"
              autoFocus
            />
          </div>

          {visibleClients.length > 0 && (
            <ClientSuggestionList
              clients={visibleClients}
              value={value}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onSelect={selectClient}
              listboxId={listboxId}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function ClientNameAutocomplete({
  clients = [],
  value,
  onChange,
  onSelect,
  onSearch,
  placeholder = "Nombre del cliente",
  className = "",
  inputClassName = "",
  disabled = false,
  minSearchLength = 1,
}) {
  const listboxId = useId();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const [activeIndex, setActiveIndex] = useState(-1);

  const { visibleClients } = useClientLookup({
    clients,
    onSearch,
    query,
    open,
    minSearchLength,
    showAllWhenEmpty: false,
  });

  useEffect(() => {
    if (!open) setQuery(value || "");
  }, [open, value]);

  useEffect(() => {
    setActiveIndex(visibleClients.length > 0 ? 0 : -1);
  }, [visibleClients]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selectClient = (client) => {
    onSelect?.(client);
    setQuery(client?.name || "");
    setOpen(false);
  };

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    setQuery(nextValue);
    setOpen(true);
    onChange?.(nextValue);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open || visibleClients.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleClients.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? visibleClients.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectClient(visibleClients[activeIndex] || visibleClients[0]);
    }
  };

  return (
    <div className={`client-name-autocomplete ${className}`} ref={ref}>
      <input
        className={inputClassName}
        value={value}
        onFocus={() => {
          setQuery(value || "");
          setOpen(true);
        }}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
      />

      {open && !disabled && visibleClients.length > 0 && (
        <div className="client-lookup-menu client-name-menu" id={listboxId} role="listbox">
          <ClientSuggestionList
            clients={visibleClients}
            value={null}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onSelect={selectClient}
            listboxId={listboxId}
          />
        </div>
      )}
    </div>
  );
}

export function ClientCombobox(props) {
  return <ClientSelect {...props} />;
}

export function ClientFilterSelect({
  clients = [],
  value,
  onChange,
  className = "",
  allLabel = "Todos los clientes",
  includeNoClient = true,
}) {
  return (
    <select
      className={`client-filter-select ${className}`}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="all">{allLabel}</option>
      {includeNoClient && <option value={NO_CLIENT_FILTER_VALUE}>Sin cliente registrado</option>}
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {getClientDisplayName(client)}
        </option>
      ))}
    </select>
  );
}
