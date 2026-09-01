import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const deliveryPage = readFileSync(resolve("src/pages/page-delivery.jsx"), "utf8");

describe("Delivery selective rework UI contract", () => {
  it("uses the dedicated reverse command with the order version rather than a direct update", () => {
    expect(deliveryPage).toContain('supabase.rpc("delivery_revert_order_to_completed"');
    expect(deliveryPage).toContain("p_expected_updated_at: order.updated_at");
    expect(deliveryPage).not.toContain('.from("orders").update');
  });

  it("only serializes selected files with a trimmed per-file correction note", () => {
    expect(deliveryPage).toContain('supabase.rpc("delivery_return_completed_files_to_production"');
    expect(deliveryPage).toContain("selectedReworkItems.map");
    expect(deliveryPage).toContain("file_id: file.id, correction_note");
    expect(deliveryPage).toContain("String(reworkSelections[file.id] || \"\").trim()");
    expect(deliveryPage).toContain("selectedReworkItems.length === 0 || hasInvalidReworkNote");
  });

  it("keeps correction details accessible and retains the dialog while a request fails", () => {
    expect(deliveryPage).toContain('role="dialog" aria-modal="true" aria-labelledby="pd-rework-title"');
    expect(deliveryPage).toContain("reworkDialogRef.current?.querySelectorAll");
    expect(deliveryPage).toContain("reworkTriggerRef.current?.focus()");
    expect(deliveryPage).toContain('aria-hidden={reworkOpen || undefined}');
    expect(deliveryPage).toContain('aria-invalid={noteInvalid || undefined}');
    expect(deliveryPage).toContain("setReworkError(getReworkErrorMessage(error))");
    expect(deliveryPage).toContain("Actualiza la lista e inténtalo de nuevo.");
  });

  it("confirms a successful return locally in addition to the durable server notification", () => {
    expect(deliveryPage).toContain("La devolución fue enviada correctamente a Producción.");
    expect(deliveryPage).toContain("inert={reworkOpen}");
  });
});
