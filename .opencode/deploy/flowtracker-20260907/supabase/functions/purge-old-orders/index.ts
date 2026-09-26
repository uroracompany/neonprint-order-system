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

type PurgeClaim = {
  order_id: string;
  claim_token: string;
  asset_manifest: Record<string, unknown> | null;
};

type ManifestObject = {
  provider: "supabase" | "r2";
  bucket: "order-docs" | "order-previews" | "payment-invoice";
  object_key: string;
};

type StorageError = {
  provider?: string;
  bucket: string;
  prefix: string;
  key?: string;
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

const PURGE_BUCKETS = new Set(["order-docs", "order-previews", "payment-invoice"]);

const textEncoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (value: string) =>
  toHex(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));

const hmacSha256 = async (key: ArrayBuffer | Uint8Array | string, value: string) => {
  const rawKey = typeof key === "string" ? textEncoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(value));
};

const encodeRfc3986 = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const normalizePath = (path = "") =>
  String(path || "")
    .split("/")
    .filter(Boolean)
    .map(encodeRfc3986)
    .join("/");

const formatAmzDate = (date = new Date()) => {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
};

const getR2Config = () => {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET") || Deno.env.get("R2_BUCKET_PROD") || Deno.env.get("R2_BUCKET_DEV");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return { configured: false as const };
  }

  return {
    configured: true as const,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    service: "s3",
  };
};

const getSignatureKey = async (secretAccessKey: string, dateStamp: string, region: string, service: string) => {
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
};

const signedR2Delete = async (key: string) => {
  const r2 = getR2Config();
  if (!r2.configured) throw new Error("R2 no esta configurado.");

  const { amzDate, dateStamp } = formatAmzDate();
  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${normalizePath(r2.bucket)}/${normalizePath(key)}`;
  const payloadHash = await sha256Hex("");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const credentialScope = `${dateStamp}/${r2.region}/${r2.service}/aws4_request`;
  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await getSignatureKey(r2.secretAccessKey, dateStamp, r2.region, r2.service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(`${r2.endpoint}${canonicalUri}`, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 DELETE fallo (${response.status}): ${text || response.statusText}`);
  }
};

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

  // dry_run deliberately uses the legacy read-only candidate query. Claiming is
  // a durable mutation and must never occur during a dry run.
  const { data: candidates, error: candidateError } = await supabase.rpc(
    dryRun ? "purge_old_orders_batch" : "claim_old_orders_for_purge",
    { p_cutoff: cutoff, p_limit: limit },
  );

  if (candidateError) {
    console.error("order purge candidate query failed", candidateError);
    return jsonResponse(500, { error: candidateError.message });
  }

  const orders = (candidates || []) as Array<PurgeCandidate | PurgeClaim>;
  const result = {
    cutoff,
    dry_run: dryRun,
    candidate_count: orders.length,
    purged: [] as string[],
    claimed: dryRun ? [] as string[] : orders.map((order) => order.order_id),
    skipped: [] as Array<{ order_id: string; errors: StorageError[] }>,
    failed: [] as Array<{ order_id: string; message: string }>,
  };

  for (const order of orders) {
    if (dryRun) {
      continue;
    }

    const claim = order as PurgeClaim;
    const storageResult = await removeOrderStorage(supabase, claim.asset_manifest);

    if (storageResult.errors.length > 0) {
      const { error: logError } = await supabase.rpc(
        "record_order_purge_storage_result",
        {
          p_order_id: claim.order_id,
          p_claim_token: claim.claim_token,
          p_storage_files_deleted: storageResult.removed,
          p_storage_errors: storageResult.errors,
        },
      );

      if (logError) {
        console.error("order purge storage error audit failed", {
          order_id: claim.order_id,
          error: logError,
        });
      }

      result.skipped.push({ order_id: claim.order_id, errors: storageResult.errors });
      continue;
    }

    const { error: storageRecordError } = await supabase.rpc(
      "record_order_purge_storage_result",
      {
        p_order_id: claim.order_id,
        p_claim_token: claim.claim_token,
        p_storage_files_deleted: storageResult.removed,
        p_storage_errors: [],
      },
    );
    if (storageRecordError) {
      result.failed.push({ order_id: claim.order_id, message: storageRecordError.message });
      continue;
    }

    const { error: purgeError } = await supabase.rpc(
      "purge_claimed_order_after_storage",
      {
        p_order_id: claim.order_id,
        p_claim_token: claim.claim_token,
        p_cutoff: cutoff,
      },
    );

    if (purgeError) {
      console.error("order purge database delete failed", {
        order_id: claim.order_id,
        error: purgeError,
      });
      result.failed.push({ order_id: claim.order_id, message: purgeError.message });
      continue;
    }

    result.purged.push(claim.order_id);
  }

  console.log("old order purge completed", result);
  return jsonResponse(200, result);
});

const removeOrderStorage = async (
  supabase: ReturnType<typeof createClient>,
  manifest: Record<string, unknown> | null,
) => {
  let removed = 0;
  const errors: StorageError[] = [];

  // A claim is an immutable deletion contract. Never inspect current orders,
  // order_files or Storage prefixes: they may have changed after the claim.
  const objects = Array.isArray(manifest?.objects)
    ? manifest.objects as Array<Partial<ManifestObject>>
    : [];
  const targets = objects.filter((object): object is ManifestObject => (
    (object.provider === "supabase" || object.provider === "r2")
    && typeof object.bucket === "string"
    && PURGE_BUCKETS.has(object.bucket)
    && typeof object.object_key === "string"
    && object.object_key.trim().length > 0
  ));

  const explicitSupabaseTargets = targets
    .filter((object) => object.provider === "supabase")
    .map((object) => ({ bucket: object.bucket, path: object.object_key }));

  const explicitSupabaseResult = await removeSupabaseObjects(supabase, explicitSupabaseTargets);
  removed += explicitSupabaseResult.removed;
  errors.push(...explicitSupabaseResult.errors);

  const r2Targets = targets
    .filter((object) => object.provider === "r2")
    .map((object) => ({ bucket: object.bucket, key: object.object_key }));

  const r2Result = await removeR2Objects(r2Targets);
  removed += r2Result.removed;
  errors.push(...r2Result.errors);

  return { removed, errors };
};

const removeSupabaseObjects = async (
  supabase: ReturnType<typeof createClient>,
  targets: Array<{ bucket: string; path: string }>,
) => {
  let removed = 0;
  const errors: StorageError[] = [];
  const grouped = new Map<string, Set<string>>();

  for (const target of targets) {
    if (!target.bucket || !target.path) continue;
    if (!grouped.has(target.bucket)) grouped.set(target.bucket, new Set());
    grouped.get(target.bucket)?.add(target.path);
  }

  for (const [bucket, pathSet] of grouped) {
    const paths = [...pathSet];
    if (!paths.length) continue;

    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      errors.push({ provider: "supabase", bucket, prefix: paths.join(","), message: error.message });
    } else {
      removed += paths.length;
    }
  }

  return { removed, errors };
};

const removeR2Objects = async (targets: Array<{ bucket: string; key: string }>) => {
  let removed = 0;
  const errors: StorageError[] = [];
  const deduped = new Map<string, { bucket: string; key: string }>();

  for (const target of targets) {
    if (!target.key) continue;
    deduped.set(`${target.bucket}:${target.key}`, target);
  }

  if (!deduped.size) return { removed, errors };

  for (const target of deduped.values()) {
    try {
      await signedR2Delete(target.key);
      removed += 1;
    } catch (error) {
      errors.push({
        provider: "r2",
        bucket: target.bucket,
        prefix: "",
        key: target.key,
        message: error instanceof Error ? error.message : "No se pudo borrar el objeto en R2.",
      });
    }
  }

  return { removed, errors };
};
