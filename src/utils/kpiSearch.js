export function normalizeKpiSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function buildKpiSearchText(item, fields = []) {
  if (!item) return "";

  return fields
    .map((field) => {
      if (typeof field === "function") return field(item);
      return item?.[field];
    })
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value != null)
    .join(" ");
}

export function matchesKpiSearch(item, query, fields = []) {
  const normalizedQuery = normalizeKpiSearch(query);
  if (!normalizedQuery) return true;

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const haystack = normalizeKpiSearch(buildKpiSearchText(item, fields));
  if (!haystack) return false;

  return tokens.every((token) => haystack.includes(token));
}
