import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { finalizeOrderFileCompletion, verifyPaymentReceiptBytes } from "../../server/storage-gateway.js";

const ascii = (value) => [...new TextEncoder().encode(value)];
const binary = (base64) => new Uint8Array(Buffer.from(base64, "base64"));
const png = binary("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==");
const jpeg = binary("/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjEzLjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAARABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAIAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AA//Z");
const gif = binary("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
const webp = binary("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAgA0JaQAA3AA/vuUAAA=");
const bmff = (brand) => new Uint8Array([0, 0, 0, 24, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0, ...ascii("mif1")]);
const paymentRecord = (provider = "supabase") => ({
  id: `${provider}-record`,
  order_id: "c2eb9744-c24b-4772-a865-1e2c82b116e6",
  provider,
  bucket: provider === "r2" ? "payment-r2" : "payment-invoice",
  object_key: "orders/c2eb9744-c24b-4772-a865-1e2c82b116e6/payment-1788060343974-recibo.png",
  uploaded_by: "c2eb9744-c24b-4772-a865-1e2c82b116e6",
  category: "payment",
  content_type: "image/png",
});
const r2Env = {
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET: "payment-r2",
};

const completionAdmin = ({ bytes }) => {
  const updates = [];
  const result = {
    eq: () => result,
    select: () => result,
    single: async () => ({ data: { ...updates.at(-1) }, error: null }),
  };
  return {
    updates,
    admin: {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://receipt.test/verified" }, error: null }),
        }),
      },
      from: () => ({
        update: (fields) => {
          updates.push(fields);
          return result;
        },
      }),
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("payment receipt storage verification", () => {
  it.each([
    [png, "image/png", "image/png"],
    [jpeg, "image/jpg", "image/jpeg"],
    [gif, "image/gif", "image/gif"],
    [webp, "image/webp", "image/webp"],
  ])("recognizes stored receipt bytes for each supported format", async (bytes, declaredContentType, expectedType) => {
    await expect(verifyPaymentReceiptBytes({ bytes, declaredContentType })).resolves.toEqual({ valid: true, contentType: expectedType });
  });

  it("rejects arbitrary, malformed, mismatched, and oversized declared images", async () => {
    await expect(verifyPaymentReceiptBytes({ bytes: ascii("not an image"), declaredContentType: "image/png" })).resolves.toMatchObject({ valid: false });
    await expect(verifyPaymentReceiptBytes({ bytes: png, declaredContentType: "image/jpeg" })).resolves.toMatchObject({ valid: false });
    await expect(verifyPaymentReceiptBytes({ bytes: bmff("avif"), declaredContentType: "image/heif" })).resolves.toMatchObject({ valid: false });
    await expect(verifyPaymentReceiptBytes({ bytes: new Uint8Array(10 * 1024 * 1024 + 1), declaredContentType: "image/png" })).resolves.toMatchObject({ valid: false });
  });

  it.each([
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    [new Uint8Array(ascii("GIF89a")), "image/gif"],
    [new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]), "image/webp"],
    [bmff("heic"), "image/heic"],
    [bmff("mif1"), "image/heif"],
  ])("rejects truncated or unsupported receipt bytes", async (bytes, declaredContentType) => {
    await expect(verifyPaymentReceiptBytes({ bytes, declaredContentType })).resolves.toMatchObject({ valid: false });
  });

  it("rejects HEIC and HEIF with the generic supported-format error", async () => {
    await expect(verifyPaymentReceiptBytes({ bytes: bmff("heic"), declaredContentType: "image/heic" }))
      .resolves.toMatchObject({ valid: false, error: expect.stringMatching(/PNG.*JPG.*WebP.*GIF/i) });
    await expect(verifyPaymentReceiptBytes({ bytes: bmff("mif1"), declaredContentType: "image/heif" }))
      .resolves.toMatchObject({ valid: false, error: expect.stringMatching(/PNG.*JPG.*WebP.*GIF/i) });
  });

  it("rejects a decoded image beyond the 12 megapixel limit", async () => {
    const oversized = await sharp({
      create: { width: 4000, height: 3001, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    await expect(verifyPaymentReceiptBytes({ bytes: oversized, declaredContentType: "image/png" }))
      .resolves.toMatchObject({ valid: false });
  });

  it("marks a mocked Supabase payment completion failed unless server-read bytes verify", async () => {
    const invalid = completionAdmin({ bytes: new Uint8Array(ascii("not an image")) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not an image", { status: 200 })));
    const invalidResult = await finalizeOrderFileCompletion({
      supabaseAdmin: invalid.admin,
      fileRecord: paymentRecord(),
      failed: false,
      env: {},
    });
    expect(invalidResult.validationError).toBeTruthy();
    expect(invalid.updates).toHaveLength(1);
    expect(invalid.updates[0]).toMatchObject({ status: "failed", payment_image_verified_at: null });

    const valid = completionAdmin({ bytes: png });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { status: 200 })));
    const validResult = await finalizeOrderFileCompletion({
      supabaseAdmin: valid.admin,
      fileRecord: paymentRecord(),
      failed: false,
      env: {},
    });
    expect(validResult.data).toMatchObject({ status: "uploaded", content_type: "image/png" });
    expect(valid.updates[0]).toMatchObject({ status: "uploaded", content_type: "image/png" });
    expect(valid.updates[0].payment_image_verified_at).toEqual(expect.any(String));
  });

  it("applies the same mocked R2 completion invariant before exposing a payment receipt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not an image", {
      status: 200,
      headers: { "content-length": "12" },
    })));
    const invalid = completionAdmin({ bytes: png });
    const invalidResult = await finalizeOrderFileCompletion({
      supabaseAdmin: invalid.admin,
      fileRecord: paymentRecord("r2"),
      failed: false,
      env: r2Env,
    });
    expect(invalidResult.validationError).toBeTruthy();
    expect(invalid.updates).toHaveLength(1);
    expect(invalid.updates[0]).toMatchObject({ status: "failed", payment_image_verified_at: null });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(png, {
      status: 200,
      headers: { "content-length": String(png.byteLength) },
    })));
    const valid = completionAdmin({ bytes: new Uint8Array(ascii("not used for R2")) });
    const validResult = await finalizeOrderFileCompletion({
      supabaseAdmin: valid.admin,
      fileRecord: paymentRecord("r2"),
      failed: false,
      env: r2Env,
    });
    expect(validResult.data).toMatchObject({ status: "uploaded", content_type: "image/png" });
    expect(valid.updates[0].payment_image_verified_at).toEqual(expect.any(String));
  });
});
