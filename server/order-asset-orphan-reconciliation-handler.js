import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";
import { getR2Config, listR2OrderObjects } from "./storage-gateway.js";

const SUPABASE_ORDER_BUCKETS = ["order-docs", "order-previews", "payment-invoice"];
const RECONCILIATION_PAGE_SIZE = 250;
const ORDER_LOOKUP_BATCH_SIZE = 200;
const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getOrderIdFromManagedAssetPath = ({ bucket, objectPath }) => {
  const parts = String(objectPath || "").split("/").filter(Boolean);
  const candidate = bucket === "payment-invoice"
    ? parts[0]
    : parts[0] === "orders" ? parts[1] : null;
  return UUID_PATTERN.test(candidate || "") ? candidate.toLowerCase() : null;
};

export const isOldEnoughForOrphanDeletion = ({ createdAt, now = new Date(), gracePeriodMs = DEFAULT_GRACE_PERIOD_MS }) => {
  const createdAtMs = new Date(createdAt || "").getTime();
  return Number.isFinite(createdAtMs) && createdAtMs <= now.getTime() - gracePeriodMs;
};

const assetKey = ({ provider, bucket, objectPath }) => `${provider}:${bucket}:${objectPath}`;

const referenceToAsset = (url) => {
  const value = String(url || "").trim();
  if (!value) return null;
  const r2 = /^r2:\/\/([^/]+)\/(.+)$/.exec(value);
  if (r2) return { provider: "r2", bucket: r2[1], objectPath: r2[2] };
  const supabase = /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+).*$/i.exec(value);
  return supabase ? { provider: "supabase", bucket: supabase[1], objectPath: decodeURIComponent(supabase[2]) } : null;
};

const toUrlList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
};

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

const getExistingOrderIds = async ({ supabaseAdmin, orderIds }) => {
  const found = new Set();
  for (const ids of chunk([...orderIds], ORDER_LOOKUP_BATCH_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await supabaseAdmin.from("orders").select("id").in("id", ids);
    if (error) throw error;
    (data || []).forEach((order) => found.add(String(order.id).toLowerCase()));
  }
  return found;
};

export async function identifyOrphanOrderAssets({
  candidates,
  getExistingIds,
  getReferencedPaths = null,
  now = new Date(),
  gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
}) {
  const recognised = (candidates || []).map((candidate) => ({
    ...candidate,
    orderId: getOrderIdFromManagedAssetPath({ bucket: candidate.bucket, objectPath: candidate.objectPath }),
  })).filter((candidate) => candidate.orderId);
  const oldEnough = recognised.filter((candidate) => isOldEnoughForOrphanDeletion({
    createdAt: candidate.createdAt,
    now,
    gracePeriodMs,
  }));
  const existingIds = await getExistingIds(new Set(oldEnough.map((candidate) => candidate.orderId)));
  const referencedPaths = getReferencedPaths ? await getReferencedPaths(oldEnough) : null;
  const orphans = oldEnough.filter((candidate) => (
    !existingIds.has(candidate.orderId)
    || (referencedPaths && !referencedPaths.has(assetKey(candidate)))
  ));

  return {
    orphans,
    inspected: (candidates || []).length,
    skippedUnrecognised: (candidates || []).length - recognised.length,
    skippedFresh: recognised.length - oldEnough.length,
    skippedWithParent: oldEnough.length - orphans.length,
  };
}

const getCursor = async ({ supabaseAdmin, provider, bucket }) => {
  const { data, error } = await supabaseAdmin
    .from("order_asset_reconciliation_cursors")
    .select("cursor")
    .eq("provider", provider)
    .eq("bucket", bucket)
    .maybeSingle();
  if (error) throw error;
  return data?.cursor || "";
};

export const getReferencedOrderAssetPaths = async ({ supabaseAdmin, candidates }) => {
  const orderIds = [...new Set((candidates || []).map((candidate) => candidate.orderId).filter(Boolean))];
  const referenced = new Set();
  for (const ids of chunk(orderIds, ORDER_LOOKUP_BATCH_SIZE)) {
    if (!ids.length) continue;
    const [{ data: orders, error: ordersError }, { data: files, error: filesError }, { data: catalogFiles, error: catalogFilesError }] = await Promise.all([
      supabaseAdmin.from("orders").select("id,order_file_url,preview_image,reference_images,invoice_payment").in("id", ids),
      supabaseAdmin.from("order_production_files").select("order_id,url").in("order_id", ids),
      supabaseAdmin.from("order_files").select("order_id,provider,bucket,object_key,status,deleted_at").in("order_id", ids),
    ]);
    if (ordersError) throw ordersError;
    if (filesError) throw filesError;
    if (catalogFilesError) throw catalogFilesError;
    for (const order of orders || []) {
      const urls = [order.preview_image, order.invoice_payment]
        .concat(toUrlList(order.reference_images), toUrlList(order.order_file_url));
      for (const url of urls) {
        const reference = referenceToAsset(url);
        if (reference) referenced.add(assetKey(reference));
      }
    }
    for (const file of files || []) {
      const reference = referenceToAsset(file.url);
      if (reference) referenced.add(assetKey(reference));
    }
    // order_files is the canonical manifest. A pending, uploading, or uploaded
    // record protects its object even when the order columns have not yet been
    // materialised. Only explicitly failed/deleted or soft-deleted records may
    // become reconciliation candidates after the grace period.
    for (const file of catalogFiles || []) {
      if (file.deleted_at || ["failed", "deleted"].includes(file.status)) continue;
      if (file.provider && file.bucket && file.object_key) {
        referenced.add(assetKey({ provider: file.provider, bucket: file.bucket, objectPath: file.object_key }));
      }
    }
  }
  return referenced;
};

const saveCursor = async ({ supabaseAdmin, provider, bucket, cursor }) => {
  const { error } = await supabaseAdmin
    .from("order_asset_reconciliation_cursors")
    .upsert({ provider, bucket, cursor: cursor || null, updated_at: new Date().toISOString() }, {
      onConflict: "provider,bucket",
    });
  if (error) throw error;
};

const enqueueOrphans = async ({ supabaseAdmin, orphans }) => {
  if (!orphans.length) return 0;
  const { error } = await supabaseAdmin
    .from("order_asset_deletion_outbox")
    .upsert(orphans.map((asset) => ({
      order_id: asset.orderId,
      provider: asset.provider,
      bucket: asset.bucket,
      target_kind: "object",
      object_path: asset.objectPath,
    })), {
      onConflict: "provider,bucket,target_kind,object_path",
      ignoreDuplicates: true,
    });
  if (error) throw error;
  return orphans.length;
};

const listSupabaseCandidates = async ({ supabaseAdmin, bucket, cursor }) => {
  const { data, error } = await supabaseAdmin.rpc("list_order_storage_assets", {
    p_bucket: bucket,
    p_after_name: cursor || null,
    p_limit: RECONCILIATION_PAGE_SIZE,
  });
  if (error) throw error;
  const rows = data || [];
  return {
    candidates: rows.map((row) => ({
      provider: "supabase",
      bucket,
      objectPath: row.object_path,
      createdAt: row.created_at,
    })),
    nextCursor: rows.length === RECONCILIATION_PAGE_SIZE ? rows.at(-1)?.object_path || "" : "",
  };
};

export async function reconcileOrphanOrderAssets({
  env = process.env,
  clientFactory = createClient,
  r2List = listR2OrderObjects,
  now = () => new Date(),
} = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const supabaseAdmin = clientFactory(envResult.supabaseUrl, envResult.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const summary = {
    inspected: 0,
    queued: 0,
    skippedUnrecognised: 0,
    skippedFresh: 0,
    skippedWithParent: 0,
    sources: 0,
  };
  const processSource = async ({ provider, bucket, list }) => {
    const cursor = await getCursor({ supabaseAdmin, provider, bucket });
    const page = await list(cursor);
    const identified = await identifyOrphanOrderAssets({
      candidates: page.candidates,
      getExistingIds: (ids) => getExistingOrderIds({ supabaseAdmin, orderIds: ids }),
      getReferencedPaths: (candidates) => getReferencedOrderAssetPaths({ supabaseAdmin, candidates }),
      now: now(),
    });
    summary.inspected += identified.inspected;
    summary.skippedUnrecognised += identified.skippedUnrecognised;
    summary.skippedFresh += identified.skippedFresh;
    summary.skippedWithParent += identified.skippedWithParent;
    summary.queued += await enqueueOrphans({ supabaseAdmin, orphans: identified.orphans });
    summary.sources += 1;
    await saveCursor({ supabaseAdmin, provider, bucket, cursor: page.nextCursor });
  };

  try {
    for (const bucket of SUPABASE_ORDER_BUCKETS) {
      await processSource({
        provider: "supabase",
        bucket,
        list: (cursor) => listSupabaseCandidates({ supabaseAdmin, bucket, cursor }),
      });
    }
    const r2 = getR2Config(env);
    if (r2.configured) {
      await processSource({
        provider: "r2",
        bucket: r2.bucket,
        list: async (cursor) => {
          const page = await r2List({
            bucket: r2.bucket,
            prefix: "orders/",
            continuationToken: cursor,
            maxKeys: RECONCILIATION_PAGE_SIZE,
            env,
          });
          return {
            candidates: (page.objects || []).map((object) => ({
              provider: "r2",
              bucket: r2.bucket,
              objectPath: object.key,
              createdAt: object.lastModified,
            })),
            nextCursor: page.nextContinuationToken || "",
          };
        },
      });
    }
  } catch (error) {
    console.error("[order-asset-reconciliation] Fallo al reconciliar archivos", error?.message || error);
    return internalError("No se pudo reconciliar los archivos de orden.", "ORDER_ASSET_RECONCILIATION_FAILED");
  }

  return jsonResponse(200, summary);
}
