const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

const parseOrderTimestamp = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;

  const match = value.trim().match(TIMESTAMP_PATTERN);
  if (!match) return null;

  const [, date, hours, minutes, seconds, fraction = "", rawTimezone] = match;
  const hour = Number(hours);
  const minute = Number(minutes);
  const second = Number(seconds);

  if (hour > 23 || minute > 59 || second > 59) return null;

  const calendarDate = new Date(Date.parse(`${date}T00:00:00Z`));
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date) return null;

  let timezone = rawTimezone.toUpperCase();
  if (timezone !== "Z") {
    const sign = timezone[0];
    const digits = timezone.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMinutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    timezone = `${sign}${digits.slice(0, 2)}:${String(offsetMinutes).padStart(2, "0")}`;
  }

  const wholeSecondEpochMs = Date.parse(`${date}T${hours}:${minutes}:${seconds}${timezone}`);
  if (!Number.isFinite(wholeSecondEpochMs) || wholeSecondEpochMs % 1000 !== 0) return null;

  return {
    wholeSecondEpoch: BigInt(wholeSecondEpochMs / 1000),
    fraction: fraction.replace(/0+$/, ""),
  };
};

export const areOrderTimestampsEquivalent = (left, right) => {
  const parsedLeft = parseOrderTimestamp(left);
  const parsedRight = parseOrderTimestamp(right);
  if (!parsedLeft || !parsedRight) return false;
  if (parsedLeft.wholeSecondEpoch !== parsedRight.wholeSecondEpoch) return false;

  const precision = Math.max(parsedLeft.fraction.length, parsedRight.fraction.length);
  return parsedLeft.fraction.padEnd(precision, "0") === parsedRight.fraction.padEnd(precision, "0");
};
