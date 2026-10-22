export const TRACKING_NAME_LIMIT = 50;
export const TRACKING_NAME_SEARCH_DELAY = 180;

export const canonicalizeTrackingName = (value) => String(value || "")
  .replace(/\s+/gu, " ")
  .trim();

export const normalizeTrackingName = (value) => canonicalizeTrackingName(value).toLocaleLowerCase("es");

export const escapeIlikePattern = (value) => String(value || "")
  .replace(/[\\%_]/g, (character) => `\\${character}`);

export const sortTrackingNames = (items = []) => [...items]
  .filter((item) => item?.id && canonicalizeTrackingName(item?.name))
  .sort((left, right) => String(left.name).localeCompare(String(right.name), "es"));
