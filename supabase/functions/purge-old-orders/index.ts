import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

type PurgeCandidate = {
  order_id: string;
  order_created_at: string;
  client_name: string | null;
  status: string | null;
  payment_status: string | null;
  order_events_count: number;
  notifications_count: number;
};

type StorageError = {
  bucket: string;
  prefix: string;
  message: string;
};

const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getCutoffIso = () => {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return cutoff.toISOString();
};

const parseBatchLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_BATCH_LIMIT);
};

const storagePrefixesForOrder = (orderId: string) => [
  { bucket: "order-docs", prefix: `orders/${orderId}/files` },
  { bucket: "order-docs", prefix: `orders/${orderId}/ref-images` },
  { bucket: "order-previews", prefix: `orders/${orderId}/preview` },
  { bucket: "payment-invoice", prefix: orderId },
];

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Missing Supabase server environment" });
  }

  const bearerToken = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const allowedTokens = [serviceRoleKey, Deno.env.get("ORDER_PURGE_CRON_SECRET")]
    .filter((token): token is string => Boolean(token));

  if (!allowedTokens.includes(bearerToken)) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const body = await req.json().catch(() => ({}));
  const cutoff = typeof body.cutoff === "string" ? body.cutoff : getCutoffIso();
  const limit = parseBatchLimit(body.limit);
  const dryRun = body.dry_run === true;

  const { data: candidates, error: candidateError } = await supabase.rpc(
    "purge_old_orders_batch",
    {
      p_cutoff: cutoff,
      p_limit: limit,
    },
  );

  if (candidateError) {
    console.error("order purge candidate query failed", candidateError);
    return jsonResponse(500, { error: candidateError.message });
  }

  const orders = (candidates || []) as PurgeCandidate[];
  const result = {
    cutoff,
    dry_run: dryRun,
    candidate_count: orders.length,
    purged: [] as string[],
    skipped: [] as Array<{ order_id: string; errors: StorageError[] }>,
    failed: [] as Array<{ order_id: string; message: string }>,
  };

  for (const order of orders) {
    if (dryRun) {
      continue;
    }

    const storageResult = await removeOrderStorage(supabase, order.order_id);

    if (storageResult.errors.length > 0) {
      const { error: logError } = await supabase.rpc(
        "log_old_order_purge_storage_error",
        {
          p_order_id: order.order_id,
          p_storage_files_deleted: storageResult.removed,
          p_storage_errors: storageResult.errors,
        },
      );

      if (logError) {
        console.error("order purge storage error audit failed", {
          order_id: order.order_id,
          error: logError,
        });
      }

      result.skipped.push({ order_id: order.order_id, errors: storageResult.errors });
      continue;
    }

    const { error: purgeError } = await supabase.rpc(
      "purge_old_order_after_storage",
      {
        p_order_id: order.order_id,
        p_cutoff: cutoff,
        p_storage_files_deleted: storageResult.removed,
      },
    );

    if (purgeError) {
      console.error("order purge database delete failed", {
        order_id: order.order_id,
        error: purgeError,
      });
      result.failed.push({ order_id: order.order_id, message: purgeError.message });
      continue;
    }

    result.purged.push(order.order_id);
  }

  console.log("old order purge completed", result);
  return jsonResponse(200, result);
});

const removeOrderStorage = async (
  supabase: ReturnType<typeof createClient>,
  orderId: string,
) => {
  let removed = 0;
  const errors: StorageError[] = [];

  for (const target of storagePrefixesForOrder(orderId)) {
    const prefixResult = await removeStoragePrefix(supabase, target.bucket, target.prefix);
    removed += prefixResult.removed;
    errors.push(...prefixResult.errors);
  }

  return { removed, errors };
};

const removeStoragePrefix = async (
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
) => {
  const limit = 1000;
  let offset = 0;
  let removed = 0;
  const errors: StorageError[] = [];

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      errors.push({ bucket, prefix, message: error.message });
      break;
    }

    const items = data || [];
    const paths = items
      .filter((item) => item?.name && item.name !== ".emptyFolderPlaceholder")
      .map((item) => `${prefix}/${item.name}`);

    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
      if (removeError) {
        errors.push({ bucket, prefix, message: removeError.message });
        break;
      }
      removed += paths.length;
    }

    if (items.length < limit) {
      break;
    }

    offset += limit;
  }

  return { removed, errors };
};
