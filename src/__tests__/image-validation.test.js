import { describe, expect, it } from "vitest";
import {
  validateReferenceImages,
  REF_IMAGE_CONFIG,
} from "../utils/imageValidation";

describe("validateReferenceImages", () => {
  const makeFile = (name, type, size) => {
    const blob = new Blob(["x".repeat(size)], { type });
    return new File([blob], name, { type });
  };

  it("acepta 3 imagenes JPG validas", () => {
    const files = [
      makeFile("a.jpg", "image/jpeg", 1024 * 1024),
      makeFile("b.jpg", "image/jpeg", 2 * 1024 * 1024),
      makeFile("c.jpg", "image/jpeg", 3 * 1024 * 1024),
    ];
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("acepta archivos PNG y WebP", () => {
    const files = [
      makeFile("a.png", "image/png", 1024 * 1024),
      makeFile("b.webp", "image/webp", 1024 * 1024),
    ];
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(true);
  });

  it("aceuta cualquier formato (HEIC, BMP, SVG) — la validacion de formato es por decoder", () => {
    const files = [
      makeFile("photo.heic", "image/heic", 1024 * 1024),
      makeFile("img.bmp", "image/bmp", 1024 * 1024),
      makeFile("doc.svg", "image/svg+xml", 1024 * 1024),
    ];
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(true);
  });

  it("rechaza mas de 3 imagenes", () => {
    const files = Array.from({ length: 4 }, (_, i) =>
      makeFile(`${i}.jpg`, "image/jpeg", 1024 * 1024)
    );
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("3 imágenes");
  });

  it("rechaza imagen que excede 20MB", () => {
    const files = [
      makeFile("big.jpg", "image/jpeg", 25 * 1024 * 1024),
    ];
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("25.0MB");
    expect(result.errors[0]).toContain("20MB");
  });

  it("rechaza combo: formatos varios con una que excede tamaño", () => {
    const files = [
      makeFile("ok.jpg", "image/jpeg", 1024 * 1024),
      makeFile("ok.heic", "image/heic", 1024 * 1024),
      makeFile("huge.jpg", "image/jpeg", 25 * 1024 * 1024),
    ];
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(false);
    const sizeError = result.errors.find(e => e.includes("25.0MB"));
    expect(sizeError).toBeTruthy();
  });

  it("rechaza cuando el total excede 60MB", () => {
    const files = [
      makeFile("a.jpg", "image/jpeg", 25 * 1024 * 1024),
      makeFile("b.jpg", "image/jpeg", 25 * 1024 * 1024),
      makeFile("c.jpg", "image/jpeg", 25 * 1024 * 1024),
    ];
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("excede"))).toBe(true);
  });

  it("retorna valido para array vacio", () => {
    const result = validateReferenceImages([]);
    expect(result.valid).toBe(true);
  });

  it("retorna valido para null/undefined", () => {
    expect(validateReferenceImages(null).valid).toBe(true);
    expect(validateReferenceImages(undefined).valid).toBe(true);
  });

  it("cortocircuita en count > 3 sin revisar tamaños", () => {
    const files = Array.from({ length: 5 }, (_, i) =>
      makeFile(`${i}.jpg`, "image/jpeg", 1)
    );
    const result = validateReferenceImages(files);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("3 imágenes");
  });
});

describe("REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES", () => {
  it("contiene formatos para preview", () => {
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).toContain("image/jpeg");
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).toContain("image/png");
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).toContain("image/webp");
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).toContain("image/svg+xml");
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).toContain("application/pdf");
  });

  it("no incluye HEIC ni BMP para preview", () => {
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).not.toContain("image/heic");
    expect(REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES).not.toContain("image/bmp");
  });
});
