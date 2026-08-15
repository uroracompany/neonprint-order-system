const STORAGE_VERSION = 1;
const MAX_RECOVERY_AGE_MS = 12 * 60 * 60 * 1000;
const RECOVERABLE_MODALS = new Set(["create-order", "create-client", "create-material"]);
const CLIENT_FORM_FIELDS = ["name", "phone", "email", "address", "notes"];

const getStorageKey = (userId) => `neonprint:admin-workspace:v${STORAGE_VERSION}:${userId}`;

const readString = (value) => (typeof value === "string" ? value : "");

const normalizeClientForm = (form = {}) => Object.fromEntries(
  CLIENT_FORM_FIELDS.map((field) => [field, readString(form[field])])
);

export const buildAdminWorkspaceRecovery = ({
  userId,
  activeTab,
  modal,
  clientForm,
  materialFormName,
} = {}) => {
  if (!userId || !RECOVERABLE_MODALS.has(modal)) return null;

  return {
    version: STORAGE_VERSION,
    userId,
    activeTab: readString(activeTab) || "overview",
    modal,
    clientForm: normalizeClientForm(clientForm),
    materialFormName: readString(materialFormName),
    savedAt: Date.now(),
  };
};

export const readAdminWorkspaceRecovery = (userId, storage = globalThis.sessionStorage) => {
  if (!userId || !storage) return null;

  try {
    const value = storage.getItem(getStorageKey(userId));
    if (!value) return null;

    const parsed = JSON.parse(value);
    const isValid = parsed?.version === STORAGE_VERSION
      && parsed?.userId === userId
      && RECOVERABLE_MODALS.has(parsed?.modal)
      && Number.isFinite(parsed?.savedAt)
      && Date.now() - parsed.savedAt <= MAX_RECOVERY_AGE_MS;

    if (!isValid) {
      storage.removeItem(getStorageKey(userId));
      return null;
    }

    return {
      ...parsed,
      activeTab: readString(parsed.activeTab) || "overview",
      clientForm: normalizeClientForm(parsed.clientForm),
      materialFormName: readString(parsed.materialFormName),
    };
  } catch {
    return null;
  }
};

export const writeAdminWorkspaceRecovery = (recovery, storage = globalThis.sessionStorage) => {
  if (!recovery?.userId || !storage) return;

  try {
    storage.setItem(getStorageKey(recovery.userId), JSON.stringify(recovery));
  } catch {
    // Session storage may be unavailable or full; the current UI must remain usable.
  }
};

export const clearAdminWorkspaceRecovery = (userId, storage = globalThis.sessionStorage) => {
  if (!userId || !storage) return;

  try {
    storage.removeItem(getStorageKey(userId));
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
};
