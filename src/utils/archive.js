import { supabase } from "../../supabaseClient";
import { ARCHIVE_MODULE_CONFIG, ARCHIVE_MODULES, isPaymentPaid, isPaymentPartial } from "./constants";

export const getArchiveConfig = (module) => ARCHIVE_MODULE_CONFIG[module] || null;

export const canArchiveOrder = (order, module, userId) => {
  if (!order) return false;
  const alreadyArchived = isOrderArchivedForUser(order, module, userId);
  if (alreadyArchived) return false;
  return isOrderArchivableByStatus(order, module);
};

export const canRestoreOrder = (order, module, userId) => {
  if (!order) return false;
  return isOrderArchivedForUser(order, module, userId);
};

export const isOrderArchivableByStatus = (order, module) => {
  const config = getArchiveConfig(module);
  if (!config) return false;
  if (isPaymentPartial(order?.payment_status)) return false;

  if (config.requiresPaymentPaid) {
    return isPaymentPaid(order?.payment_status);
  }

  return config.archivableStatuses.includes(order?.status);
};

export const isOrderArchivedForUser = (order, module, userId) => {
  const config = getArchiveConfig(module);
  if (!config) return false;

  if (config.isPerUser && config.usesRpc) {
    return Boolean(
      userId &&
        (order?.order_production_user_archives || []).some(
          (a) => a.user_id === userId
        )
    );
  }

  return Boolean(order?.[config.dbField]);
};

export const archiveOrder = async (order, module) => {
  const config = getArchiveConfig(module);
  if (!config || !order?.id) return { error: new Error("Invalid module or order") };
  if (isPaymentPartial(order?.payment_status)) {
    return { error: new Error("No se puede archivar una orden con pago parcial.") };
  }

  if (config.usesRpc) {
    return supabase.rpc(config.rpcName, { p_order_id: order.id, p_archived: true });
  }

  if (!config.dbField) return { error: new Error("No dbField configured") };

  return supabase
    .from("orders")
    .update({ [config.dbField]: true })
    .eq("id", order.id);
};

export const restoreOrder = async (order, module) => {
  const config = getArchiveConfig(module);
  if (!config || !order?.id) return { error: new Error("Invalid module or order") };

  if (config.usesRpc) {
    return supabase.rpc(config.rpcName, { p_order_id: order.id, p_archived: false });
  }

  if (!config.dbField) return { error: new Error("No dbField configured") };

  return supabase
    .from("orders")
    .update({ [config.dbField]: false })
    .eq("id", order.id);
};

export { ARCHIVE_MODULES };
