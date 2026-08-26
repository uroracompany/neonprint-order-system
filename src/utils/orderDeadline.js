import { ORDER_STATUS, normalizeOrderStatus } from "./constants.js";

export const ORDER_DEADLINE_TIME_ZONE = "America/Asuncion";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const getDateKeyInTimeZone = (value, timeZone = ORDER_DEADLINE_TIME_ZONE) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

export const getDeliveryDateKey = (value) => {
  const dateKey = String(value || "").slice(0, 10);
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isValid = parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day);
  return isValid ? dateKey : null;
};

const getCalendarDayDifference = (fromDateKey, toDateKey) => {
  const from = Date.parse(`${fromDateKey}T00:00:00Z`);
  const to = Date.parse(`${toDateKey}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
};

export const getOrderDeadlineState = (order, now = new Date(), timeZone = ORDER_DEADLINE_TIME_ZONE) => {
  const deliveryDate = getDeliveryDateKey(order?.delivery_date);
  const today = getDateKeyInTimeZone(now, timeZone);
  const status = normalizeOrderStatus(order?.status);
  const isTerminal = status === ORDER_STATUS.IN_DELIVERED || status === ORDER_STATUS.CANCELLED;
  const daysOverdue = deliveryDate && today && !isTerminal && deliveryDate < today
    ? getCalendarDayDifference(deliveryDate, today)
    : 0;

  return { deliveryDate, today, daysOverdue, isOverdue: daysOverdue > 0 };
};

export const isOrderOverdue = (order, now, timeZone) => getOrderDeadlineState(order, now, timeZone).isOverdue;

export const sortOrdersByDeadlinePriority = (orders = [], now, timeZone) => [...orders].sort((left, right) => {
  const leftState = getOrderDeadlineState(left, now, timeZone);
  const rightState = getOrderDeadlineState(right, now, timeZone);
  if (leftState.isOverdue !== rightState.isOverdue) return leftState.isOverdue ? -1 : 1;
  if (leftState.daysOverdue !== rightState.daysOverdue) return rightState.daysOverdue - leftState.daysOverdue;
  return 0;
});
