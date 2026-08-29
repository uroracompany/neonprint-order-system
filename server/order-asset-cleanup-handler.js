import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";
import { removeR2Targets, removeSupabasePrefix, removeSupabaseTargets } from "./storage-gateway.js";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const BASE_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

const normalizeBatchSize = (value) => Math.max(1, Math.min(Number(value) || DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));

export const nextOrderAssetCleanupAttemptAt = (attempts, now = new Date()) => {
  const exponent = Math.max(0, Number(attempts || 1) - 1);
  const delay = Math.min(BASE_RETRY_DELAY_MS * (2 ** exponent), MAX_RETRY_DELAY_MS);
  return new Date(now.getTime() + delay).toISOString();
};

const cleanupQueuedAsset = async ({ job, supabaseAdmin, env, cleanup }) => {
  if (job.provider === "r2" && job.target_kind === "object") {
    return cleanup.removeR2Targets({ targets: [{ bucket: job.bucket, key: job.object_path }], env });
  }

  if (job.provider === "supabase" && job.target_kind === "object") {
    return cleanup.removeSupabaseTargets({ supabaseAdmin, targets: [{ bucket: job.bucket, path: job.object_path }] });
  }

  if (job.provider === "supabase" && job.target_kind === "prefix") {
    return cleanup.removeSupabasePrefix({ supabaseAdmin, bucket: job.bucket, prefix: job.object_path });
  }

  throw new Error("El destino de limpieza no es valido.");
};

const updateQueuedAsset = async ({ supabaseAdmin, id, values }) => {
  const { error } = await supabaseAdmin
    .from("order_asset_deletion_outbox")
    .update(values)
    .eq("id", id);

  if (error) throw error;
};

export async function processOrderAssetDeletionOutbox({
  env = process.env,
  limit = DEFAULT_BATCH_SIZE,
  clientFactory = createClient,
  cleanup = {
    removeR2Targets,
    removeSupabasePrefix,
    removeSupabaseTargets,
  },
  now = () => new Date(),
} = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;
  const supabaseAdmin = clientFactory(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const batchSize = normalizeBatchSize(limit);
  const { data: jobs, error: claimError } = await supabaseAdmin.rpc(
    "claim_order_asset_deletion_outbox",
    { p_limit: batchSize }
  );

  if (claimError) {
    return internalError("No se pudo preparar la limpieza de archivos.", "ORDER_ASSET_CLEANUP_CLAIM_FAILED");
  }

  let completed = 0;
  let failed = 0;

  for (const job of jobs || []) {
    try {
      const result = await cleanupQueuedAsset({ job, supabaseAdmin, env, cleanup });
      if (result.errors?.length) {
        throw new Error(result.errors.map((entry) => entry.message).filter(Boolean).join("; ") || "No se pudo borrar el archivo.");
      }

      await updateQueuedAsset({
        supabaseAdmin,
        id: job.id,
        values: {
          status: "completed",
          completed_at: now().toISOString(),
          locked_at: null,
          last_error: null,
        },
      });
      completed += 1;
    } catch (error) {
      const message = String(error?.message || "No se pudo borrar el archivo.").slice(0, 1000);
      try {
        await updateQueuedAsset({
          supabaseAdmin,
          id: job.id,
          values: {
            status: "pending",
            locked_at: null,
            last_error: message,
            next_attempt_at: nextOrderAssetCleanupAttemptAt(job.attempts, now()),
          },
        });
        failed += 1;
      } catch (updateError) {
        console.error("[order-asset-cleanup] No se pudo registrar el reintento", {
          jobId: job.id,
          error: updateError?.message || updateError,
        });
        failed += 1;
      }
    }
  }

  return jsonResponse(200, {
    claimed: (jobs || []).length,
    completed,
    failed,
  });
}
