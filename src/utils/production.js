import {
  PRODUCTION_AREA_LABELS,
  PRODUCTION_FILE_STATUS,
  PRODUCTION_FILE_STATUS_LABELS,
  getFileNameFromUrl,
  getProductionAreaForRole,
} from "./constants";
import { getOrderFiles } from "./orderAssets";

export const normalizeProductionFile = (file, index = 0) => {
  if (!file) return null;

  if (typeof file === "string") {
    return {
      id: `legacy-${index}`,
      url: file,
      filename: getFileNameFromUrl(file),
      production_area_code: null,
      status: PRODUCTION_FILE_STATUS.PENDING,
      isLegacy: true,
    };
  }

  const url = file.url || file.file_url || file.order_file_url;
  if (!url) return null;

  return {
    id: file.id || `${url}-${index}`,
    url,
    filename: file.filename || file.name || getFileNameFromUrl(url),
    production_area_code: file.production_area_code || null,
    status: file.status || PRODUCTION_FILE_STATUS.PENDING,
    assigned_to: file.assigned_to || null,
    updated_at: file.updated_at || null,
    completed_at: file.completed_at || null,
    isLegacy: false,
  };
};

export const getProductionFiles = (order) => {
  const productionFiles = Array.isArray(order?.order_production_files)
    ? order.order_production_files.map(normalizeProductionFile).filter(Boolean)
    : [];

  if (productionFiles.length > 0) return productionFiles;
  return getOrderFiles(order).map(normalizeProductionFile).filter(Boolean);
};

export const normalizeProductionAssignment = (assignment) => {
  if (!assignment?.order_id || !assignment?.production_area_code || !assignment?.assigned_to) {
    return null;
  }

  return {
    id: assignment.id || `${assignment.order_id}-${assignment.production_area_code}`,
    order_id: assignment.order_id,
    production_area_code: assignment.production_area_code,
    assigned_to: assignment.assigned_to,
    assigned_by: assignment.assigned_by || null,
    updated_at: assignment.updated_at || null,
  };
};

export const getProductionAssignments = (order) => (
  Array.isArray(order?.order_production_assignments)
    ? order.order_production_assignments.map(normalizeProductionAssignment).filter(Boolean)
    : []
);

export const normalizeProductionArchive = (archive) => {
  if (!archive?.order_id || !archive?.user_id) return null;

  return {
    order_id: archive.order_id,
    user_id: archive.user_id,
    archived_at: archive.archived_at || null,
  };
};

export const getProductionUserArchives = (order) => (
  Array.isArray(order?.order_production_user_archives)
    ? order.order_production_user_archives.map(normalizeProductionArchive).filter(Boolean)
    : []
);

export const isProductionOrderArchivedForUser = (order, userId) => (
  Boolean(userId && getProductionUserArchives(order).some((archive) => archive.user_id === userId))
);

export const filterProductionOrdersByArchiveState = (orders, userId, archiveState = "active") => (
  (orders || []).filter((order) => {
    const isArchived = isProductionOrderArchivedForUser(order, userId);
    return archiveState === "archived" ? isArchived : !isArchived;
  })
);

export const getProductionAssignmentForRole = (order, role) => {
  const areaCode = getProductionAreaForRole(role);
  if (!areaCode) return null;

  return getProductionAssignments(order)
    .find((assignment) => assignment.production_area_code === areaCode) || null;
};

export const isOrderAssignedToProductionRole = (order, role, userId) => {
  const assignment = getProductionAssignmentForRole(order, role);
  return Boolean(assignment && userId && assignment.assigned_to === userId);
};

export const filterProductionFilesForRole = (orderOrFiles, role) => {
  const areaCode = getProductionAreaForRole(role);
  if (!areaCode) return [];

  const files = Array.isArray(orderOrFiles) ? orderOrFiles : getProductionFiles(orderOrFiles);
  return files.filter((file) => file.production_area_code === areaCode);
};

export const getProductionFileStatusLabel = (status) => (
  PRODUCTION_FILE_STATUS_LABELS[status] || "Pendiente"
);

export const getProductionFileAreaLabel = (areaCode) => (
  PRODUCTION_AREA_LABELS[areaCode] || "Sin clasificar"
);

export const getProductionSummary = (files) => {
  const summary = {
    total: 0,
    classified: 0,
    pending: 0,
    in_production: 0,
    in_termination: 0,
    completed: 0,
  };

  (files || []).forEach((file) => {
    summary.total += 1;
    if (file.production_area_code) summary.classified += 1;
    const status = file.status || PRODUCTION_FILE_STATUS.PENDING;
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    }
  });

  return summary;
};

export const getNextProductionFileStatus = (status) => {
  if (status === PRODUCTION_FILE_STATUS.IN_TERMINATION) return PRODUCTION_FILE_STATUS.COMPLETED;
  if (status === PRODUCTION_FILE_STATUS.COMPLETED) return null;
  return PRODUCTION_FILE_STATUS.IN_TERMINATION;
};

export const buildProductionFileRows = ({ orderId, urls, files, areaCodes, userId }) => (
  (urls || []).map((url, index) => ({
    order_id: orderId,
    url,
    filename: files?.[index]?.name || getFileNameFromUrl(url),
    production_area_code: areaCodes?.[index] || null,
    status: PRODUCTION_FILE_STATUS.PENDING,
    created_by: userId || null,
    updated_by: userId || null,
  }))
);
