import { describe, expect, it } from "vitest";
import {
  getUploadPolicyForBucket,
  isAllowedAttachmentFile,
  isAllowedImageFile,
  normalizeEmailForAuth,
  validateFilesForMode,
  validateUploadPolicy,
} from "../utils/fileValidation";

const makeFile = (name, type = "application/octet-stream", size = 10) => (
  new File([new Blob(["x".repeat(size)], { type })], name, { type })
);

describe("file validation policies", () => {
  it("acepta formatos de imagen permitidos", () => {
    [
      makeFile("a.png", "image/png"),
      makeFile("b.jpg", "image/jpeg"),
      makeFile("c.jpeg", "image/jpeg"),
      makeFile("d.webp", "image/webp"),
      makeFile("e.gif", "image/gif"),
      makeFile("f.heic", "application/octet-stream"),
      makeFile("g.heif", "image/heif"),
    ].forEach((file) => expect(isAllowedImageFile(file)).toBe(true));
  });

  it("rechaza documentos en campos de imagen", () => {
    [
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.doc", "application/msword"),
      makeFile("c.zip", "application/zip"),
      makeFile("d.txt", "text/plain"),
    ].forEach((file) => expect(isAllowedImageFile(file)).toBe(false));
  });

  it("acepta documentos, imagenes y formatos de diseno como adjuntos", () => {
    [
      makeFile("brief.pdf", "application/pdf"),
      makeFile("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      makeFile("sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      makeFile("pack.rar", "application/vnd.rar"),
      makeFile("notes.csv", "text/csv"),
      makeFile("logo.ai", "application/octet-stream"),
      makeFile("mock.psd", "application/octet-stream"),
      makeFile("preview.png", "image/png"),
    ].forEach((file) => expect(isAllowedAttachmentFile(file)).toBe(true));
  });

  it("no acepta octet-stream si la extension no esta permitida", () => {
    expect(isAllowedAttachmentFile(makeFile("malware.exe", "application/octet-stream"))).toBe(false);
  });

  it("normaliza email para auth sin tocar caracteres internos validos", () => {
    expect(normalizeEmailForAuth(" usuario@correo.com ")).toBe("usuario@correo.com");
    expect(normalizeEmailForAuth("\u00A0\uFEFFusuario@correo.com\u200B")).toBe("usuario@correo.com");
  });

  it("aplica limite de multiples archivos", () => {
    const result = validateFilesForMode([makeFile("a.png", "image/png")], {
      mode: "image",
      multiple: true,
      maxFiles: 3,
      existingCount: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("limite");
  });

  it("mapea buckets/categorias a politicas y rechaza combinaciones invalidas", () => {
    expect(getUploadPolicyForBucket({ bucket: "order-previews" })).toBe("image");
    expect(getUploadPolicyForBucket({ bucket: "order-docs", category: "design" })).toBe("attachment");
    expect(validateUploadPolicy({
      bucket: "order-previews",
      category: "preview",
      fileName: "receipt.pdf",
      contentType: "application/pdf",
    }).valid).toBe(false);
    expect(validateUploadPolicy({
      bucket: "order-docs",
      category: "design",
      fileName: "design.ai",
      contentType: "application/octet-stream",
    }).valid).toBe(true);
  });
});
