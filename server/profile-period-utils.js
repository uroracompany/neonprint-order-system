const PERIOD_CONFIG = {
  all: { label: "Todo el historial" },
  "7d": { label: "Ultimos 7 dias", days: 7 },
  "30d": { label: "Ultimos 30 dias", days: 30 },
  month: { label: "Mes actual", type: "month" },
  year: { label: "Ano actual", type: "year" },
};

const asValidDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

export function resolveProfilePeriod(value, nowValue) {
  const key = Object.hasOwn(PERIOD_CONFIG, value) ? value : "all";
  const config = PERIOD_CONFIG[key];
  const now = asValidDate(nowValue);

  if (key === "all") {
    return { key, label: config.label, date_from: null, date_to: null };
  }

  let start;
  const end = new Date(now);
  if (config.days) {
    start = new Date(now);
    start.setUTCDate(start.getUTCDate() - (config.days - 1));
    start.setUTCHours(0, 0, 0, 0);
  } else if (config.type === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    end.setUTCHours(0, 0, 0, 0);
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    end.setUTCFullYear(now.getUTCFullYear() + 1, 0, 1);
    end.setUTCHours(0, 0, 0, 0);
  }

  return {
    key,
    label: config.label,
    date_from: start.toISOString(),
    date_to: end.toISOString(),
  };
}

export function applyProfilePeriod(query, period, column = "created_at") {
  if (!period?.date_from || !period?.date_to) return query;
  return query.gte(column, period.date_from).lt(column, period.date_to);
}

export function isInProfilePeriod(value, period) {
  if (!period?.date_from || !period?.date_to) return true;
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= new Date(period.date_from) && date < new Date(period.date_to);
}
