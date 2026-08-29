import { timingSafeEqual } from "node:crypto";
import { processOrderAssetDeletionOutbox } from "../../server/order-asset-cleanup-handler.js";
import { reconcileOrphanOrderAssets } from "../../server/order-asset-orphan-reconciliation-handler.js";

export const isAuthorizedCronRequest = (authorization = "", cronSecret = "") => {
  const expected = `Bearer ${String(cronSecret || "")}`;
  const actual = String(authorization || "");
  if (!cronSecret || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  if (!isAuthorizedCronRequest(req.headers.authorization, process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "No autorizado." });
  }

  const beforeReconciliation = await processOrderAssetDeletionOutbox({ env: process.env });
  if (beforeReconciliation.status !== 200) {
    return res.status(beforeReconciliation.status).json(beforeReconciliation.body);
  }

  const reconciliation = await reconcileOrphanOrderAssets({ env: process.env });
  if (reconciliation.status !== 200) {
    return res.status(reconciliation.status).json(reconciliation.body);
  }

  const afterReconciliation = await processOrderAssetDeletionOutbox({ env: process.env });
  return res.status(afterReconciliation.status).json({
    cleanup: {
      before_reconciliation: beforeReconciliation.body,
      after_reconciliation: afterReconciliation.body,
    },
    reconciliation: reconciliation.body,
  });
}
