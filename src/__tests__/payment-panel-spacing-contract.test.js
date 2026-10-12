import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/page-quote.jsx", "utf8");
const styles = readFileSync("src/css-components/page-quote.css", "utf8");

describe("payment panel spacing contract", () => {
  it("uses a uniform vertical gap scoped to the payment panel without inherited double margins", () => {
    expect(styles).toMatch(
      /\.pq-payment-panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*12px;/s,
    );
    expect(styles).toMatch(
      /\.pq-payment-panel > \.pq-panel-title,\s*\.pq-payment-panel > \.pq-readonly-note,\s*\.pq-payment-panel > \.pq-preview-block,\s*\.pq-payment-panel > \.pq-upload-hint,\s*\.pq-payment-panel \.pq-manage-payment-btn\s*\{\s*margin:\s*0;/s,
    );
  });

  it("keeps payment actions grouped horizontally with responsive wrapping and explicit spacing", () => {
    expect(page).toContain('className="pq-payment-actions"');
    expect(styles).toMatch(
      /\.pq-payment-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*12px;/s,
    );
    expect(styles).toMatch(
      /\.pq-payment-actions > \.pq-manage-payment-btn\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/s,
    );
  });

  it("does not add a second inline margin to the payment receipt preview", () => {
    const paymentSection = page.slice(page.indexOf('className="pq-panel pq-payment-panel"'), page.indexOf("{/* Acciones del modal para cotizar orden */}"));
    expect(paymentSection).toContain('className="pq-preview-block"');
    expect(paymentSection).not.toContain('className="pq-preview-block" style={{ marginTop: 16 }}');
  });
});
