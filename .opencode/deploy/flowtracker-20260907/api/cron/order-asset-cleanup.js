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

  // Scheduled invocations are evidence-only.  A deletion run must be explicitly
  // requested with execute=true after an Administrator reviews the inventory.
  const executeDeletion = String(req.query?.execute || "").toLowerCase() === "true";
  const beforeReconciliation = executeDeletion
    ? await processOrderAssetDeletionOutbox({ env: process.env })
    : { status: 200, body: { skipped: true, reason: "dry_run" } };
  if (beforeReconciliation.status !== 200) return res.status(beforeReconciliation.status).json(beforeReconciliation.body);

  const reconciliation = await reconcileOrphanOrderAssets({ env: process.env, dryRun: !executeDeletion });
  if (reconciliation.status !== 200) {
    return res.status(reconciliation.status).json(reconciliation.body);
  }

  const afterReconciliation = executeDeletion
    ? await processOrderAssetDeletionOutbox({ env: process.env })
    : { status: 200, body: { skipped: true, reason: "dry_run" } };
  return res.status(afterReconciliation.status).json({
    cleanup: {
      before_reconciliation: beforeReconciliation.body,
      after_reconciliation: afterReconciliation.body,
    },
    reconciliation: reconciliation.body,
  });
}
