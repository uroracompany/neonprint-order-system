import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const handler = readFileSync(resolve("server/kpi-data-handler.js"), "utf8");

describe("contrato de estadísticas individuales de clientes", () => {
  it("expone una acción administrativa por client_id y comparte la agregación del workspace", () => {
    expect(handler).toContain("case 'client_workspace_detail'");
    expect(handler).toContain("buildClientWorkspace(supabase, { clientId })");
    expect(handler).toContain("client_id");
    expect(handler).toContain("CLIENT_WORKSPACE_CLIENT_NOT_FOUND");
    expect(handler).toContain("requireAdmin(env.authHeader, env)");
  });

  it("mantiene las métricas históricas y la actividad mensual en el contrato compartido", () => {
    expect(handler).toContain("cancelled_orders");
    expect(handler).toContain("urgent_911_orders");
    expect(handler).toContain("internal_design_orders");
    expect(handler).toContain("monthly_activity");
    expect(handler).toContain("payment: { credit_active: 0, partial_active: 0, pending_active: 0 }");
  });
});
