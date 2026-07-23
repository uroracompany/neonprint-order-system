import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import KPIAlertsPanel from "../components/kpi/KPIAlertsPanel";
import { adminApiFetch } from "../utils/adminApi";

vi.mock("../utils/adminApi", () => ({
  adminApiFetch: vi.fn(),
}));

const mountedRoots = [];

const alertsData = {
  alerts_center: {
    generated_at: "2026-07-23T15:06:00.000Z",
    summary: {
      health_score: 72,
      active_count: 1,
      total_count: 1,
      critical_count: 1,
      high_count: 0,
      medium_count: 0,
      info_count: 0,
      affected_modules: [{ name: "Ordenes", count: 1 }],
      next_action: "Atender primero las columnas de mayor prioridad y documentar el estado.",
      last_scan_at: "2026-07-23T15:06:00.000Z",
    },
    alerts: [
      {
        alert_key: "orders:stuck",
        type: "stalled_orders",
        category: "Ordenes",
        severity: "critical",
        status: "nueva",
        title: "Ordenes estancadas",
        description: "7 ordenes sin movimiento por mas de 7 dias.",
        affected_area: "Ventas y caja",
        entity_type: "orders",
        entity_id: "ORD-OPS",
        detected_at: "2026-07-23T15:06:00.000Z",
        impact: "Puede retrasar entregas y comprometer promesas activas.",
        possible_cause: "Falta de asignacion o bloqueo en aprobacion operativa.",
        recommended_action: "Revisar ordenes antiguas y reasignar responsables.",
        action_target: { module: "orders" },
        evidence: {
          orders_count: 7,
          oldest_days: 9,
        },
      },
    ],
  },
};

function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<KPIAlertsPanel data={alertsData} />);
  });
  mountedRoots.push({ root, container });
  return container;
}

async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function mouseDown(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await flush();
}

function getIncidentRow(container) {
  return Array.from(container.querySelectorAll(".kpi-alert-center-row"))
    .find(element => element.textContent.includes("Ordenes estancadas"));
}

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
  document.body.style.overflow = "";
});

describe("KPIAlertsPanel incident detail modal", () => {
  it("opens the selected incident with complete detail and closes from the close button", async () => {
    const container = renderPanel();
    const row = getIncidentRow(container);

    expect(row).toHaveAttribute("aria-haspopup", "dialog");
    expect(row).toHaveAttribute("aria-expanded", "false");

    await click(row);

    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName("Ordenes estancadas");
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.textContent).toContain("Critica");
    expect(dialog.textContent).toContain("Nueva Alerta");
    expect(dialog.textContent).toContain("ID");
    expect(dialog.textContent).toContain("ORD-OPS");
    expect(dialog.querySelector(".kpi-alert-modal-priority svg")).toBeInTheDocument();
    expect(dialog.querySelector(".kpi-alert-center-status.new svg")).toBeInTheDocument();
    expect(dialog.querySelectorAll(".kpi-alert-modal-entity svg")).toHaveLength(2);
    expect(dialog.textContent).toContain("Ventas y caja");
    expect(dialog.textContent).toContain("Puede retrasar entregas y comprometer promesas activas.");
    expect(dialog.textContent).toContain("Falta de asignacion o bloqueo en aprobacion operativa.");
    expect(dialog.textContent).toContain("Revisar ordenes antiguas y reasignar responsables.");
    expect(dialog.textContent).toContain("orders count");
    expect(dialog.textContent).toContain("7");

    await click(dialog.querySelector('[aria-label="Cerrar detalle del incidente"]'));

    expect(document.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("closes with Escape and backdrop click", async () => {
    const container = renderPanel();
    const row = getIncidentRow(container);

    await click(row);
    expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();

    await pressEscape();
    expect(document.querySelector('[role="dialog"]')).not.toBeInTheDocument();

    await click(row);
    expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();

    await mouseDown(document.querySelector(".kpi-alert-modal-overlay"));
    expect(document.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it("marks an open incident as attended by reusing the resolved status", async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: {} });
    const container = renderPanel();
    const row = getIncidentRow(container);

    await click(row);

    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const attendButton = Array.from(dialog.querySelectorAll("button"))
      .find(element => element.textContent.includes("Marcar atendida"));

    expect(attendButton).toBeInTheDocument();

    await click(attendButton);

    expect(adminApiFetch).toHaveBeenCalledWith("/api/kpi-data", {
      action: "update_alert_state",
      alert_key: "orders:stuck",
      status: "resuelta",
    });
    expect(dialog.textContent).toContain("Atendida");
    expect(dialog.textContent).not.toContain("Nueva Alerta");
    expect(dialog.textContent).not.toContain("Marcar atendida");
  });
});
