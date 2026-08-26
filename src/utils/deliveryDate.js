const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getMinimumDeliveryDate = (now = new Date()) => toLocalDateKey(now);

export const getDeliveryDateKey = (value) => String(value || "").slice(0, 10);

export const isDeliveryDateInPast = (value, now = new Date()) => {
  const dateKey = getDeliveryDateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey < getMinimumDeliveryDate(now);
};

export const isPastDeliveryDateChange = (nextValue, previousValue, now = new Date()) => (
  isDeliveryDateInPast(nextValue, now)
  && getDeliveryDateKey(nextValue) !== getDeliveryDateKey(previousValue)
);
