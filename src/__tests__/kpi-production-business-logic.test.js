/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("logica de negocio de KPI Produccion", () => {
  it("resuelve las ordenes de produccion por order_id del archivo y no por fecha de creacion de la orden", () => {
    const handler = readProjectFile("server/kpi-data-handler.js");

    expect(handler).toContain("const orderIds = [...new Set(files.map(file => file.order_id).filter(Boolean))]");
    expect(handler).toContain("supabase.from('orders').select('*').in('id', orderIds)");
    expect(handler).toContain("const periodOrderList = periodOrders || []");
    expect(handler).toContain("const orderDesignToQuote = periodOrderList");
    expect(handler).toContain("const historicalOrderIds = [...new Set(historyFiles.map(file => file.order_id).filter(Boolean))]");
    expect(handler).toContain("supabase.from('orders').select('id, order_type, created_at').in('id', historicalOrderIds)");
  });

  it("cuenta todos los cuellos activos con la misma regla del dashboard y detalle de area", () => {
    const handler = readProjectFile("server/kpi-data-handler.js");

    expect(handler).toContain("const ACTIVE_PRODUCTION_STATUSES = ['pending', 'in_production', 'in_termination']");
    expect(handler).toContain("const bottlenecks = activeFiles");
    expect(handler).toContain(".filter(f => ACTIVE_PRODUCTION_STATUSES.includes(f.status))");
    expect(handler).toContain("const days = daysBetween(getStageStart(f), nowIso) || 0");
    expect(handler).not.toMatch(/const bottlenecks = activeFiles[\s\S]*?\.slice\(0,\s*20\)/);
  });

  it("mantiene porcentajes de calidad dentro de 0 a 100", () => {
    const handler = readProjectFile("server/kpi-data-handler.js");

    expect(handler).toContain("function calculateFirstTimeRight(completedCount, reversionCount)");
    expect(handler).toContain("return roundMetric(clampMetric(((completed - reversions) / completed) * 100), 1)");
    expect(handler).not.toMatch(/\(\(completed(?:Files)?\.length - reversions\) \/ completed(?:Files)?\.length\) \* 100/);
  });

  it("la vista mini usa la misma definicion de carga activa que el resto de Produccion", () => {
    const mini = readProjectFile("src/components/kpi/KPIProductionMini.jsx");

    expect(mini).toContain("(stats.pending || 0) + (stats.in_production || 0) + (stats.in_termination || 0)");
    expect(mini).not.toContain("const totalPending");
  });
});
