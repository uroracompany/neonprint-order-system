import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");

describe("Semi-Administración client notification contract", () => {
  it("uses the global notification center for new and reused clients", () => {
    const page = read("src/pages/pages-seller.jsx");
    const start = page.indexOf("const handleNewClientCreated");
    const end = page.indexOf("//", start + 20);
    const handler = page.slice(start, end > start ? end : start + 1800);

    expect(handler).toContain("notif.showActionNotification");
    expect(handler).toContain('event_kind: options.reusedExisting ? "client_reused" : "client_created"');
    expect(handler).toContain('variant: "success"');
    expect(handler).not.toContain('showToast("Cliente creado correctamente.")');
  });
});
