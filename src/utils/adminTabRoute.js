export const ADMIN_TAB_PARAM = "tab";

const adminTabs = new Set([
  "overview",
  "kpi",
  "orders",
  "credits",
  "clients",
  "materials",
  "users",
  "notifications",
  "profile",
]);

export const getAdminTabFromSearch = (search = "") => {
  const tab = new URLSearchParams(search).get(ADMIN_TAB_PARAM);
  return adminTabs.has(tab) ? tab : "overview";
};

export const getAdminTabSearch = (search = "", tab = "overview") => {
  const params = new URLSearchParams(search);
  if (tab === "overview" || !adminTabs.has(tab)) {
    params.delete(ADMIN_TAB_PARAM);
  } else {
    params.set(ADMIN_TAB_PARAM, tab);
  }
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
};
