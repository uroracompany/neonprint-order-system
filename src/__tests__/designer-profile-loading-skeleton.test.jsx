import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { adminApiFetchMock } = vi.hoisted(() => ({ adminApiFetchMock: vi.fn() }));

vi.mock("../utils/adminApi", () => ({ adminApiFetch: adminApiFetchMock }));
vi.mock("../hooks/useOrdersRealtimeSync", () => ({ default: () => {} }));
vi.mock("../components/profile/ProfilePeriodControl", () => ({
  default: ({ value, onChange }) => (
    <label>Periodo<select aria-label="Periodo del perfil" value={value} onChange={(event) => onChange(event.target.value)}><option value="all">Todo</option><option value="month">Mes</option></select></label>
  ),
}));
vi.mock("recharts", () => {
  const Chart = ({ children }) => <div>{children}</div>;
  return {
    Bar: Chart, BarChart: Chart, CartesianGrid: Chart, Cell: Chart, Line: Chart,
    LineChart: Chart, Pie: Chart, PieChart: Chart, ResponsiveContainer: Chart,
    Tooltip: Chart, XAxis: Chart, YAxis: Chart,
  };
});

import DesignerProfileModule from "../components/designer/DesignerProfileModule";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const success = (name) => ({
  response: { ok: true },
  result: { profile: { name, role: "designer", employment_status: true }, metrics: {}, ranking: {}, analytics: {} },
});

describe("Designer profile loading skeleton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("matches ranking, quality, six metrics and the six-card analytics layout during initial load", () => {
    adminApiFetchMock.mockReturnValue(new Promise(() => {}));
    render(<DesignerProfileModule authUser={{ id: "designer-1" }} fallbackProfile={{ name: "Ana", role: "designer" }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Cargando Mi Perfil");
    expect(document.querySelector(".pd-profile-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".pd-profile-skeleton-layout > article")).toHaveLength(2);
    expect(document.querySelector(".pd-profile-skeleton-layout .ps-profile-ranking-panel")).toBeInTheDocument();
    expect(document.querySelector(".pd-profile-skeleton-layout .ps-profile-goals-panel")).toBeInTheDocument();
    expect(document.querySelectorAll(".pd-profile-skeleton-metrics > .ps-profile-metric-card")).toHaveLength(6);
    expect(document.querySelector(".pd-profile-skeleton-analytics-heading")).toBeInTheDocument();
    expect(document.querySelectorAll(".pd-profile-skeleton-analytics .ps-profile-analytics-card")).toHaveLength(6);
    expect(document.querySelector(".ps-profile-analytics-card.wide")).toBeInTheDocument();
    expect(document.querySelector(".ps-profile-analytics-card.full")).toBeInTheDocument();
    expect(document.querySelector(".pd-profile-skeleton-analytics")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the previous profile while changing period and preserves it if refresh fails", async () => {
    const periodRefresh = deferred();
    adminApiFetchMock.mockResolvedValueOnce(success("Perfil anterior")).mockReturnValueOnce(periodRefresh.promise);
    render(<DesignerProfileModule authUser={{ id: "designer-1", email: "ana@example.com" }} />);

    expect(await screen.findByRole("heading", { name: "Perfil anterior" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Periodo del perfil"), { target: { value: "month" } });

    expect(screen.getByRole("heading", { name: "Perfil anterior" })).toBeInTheDocument();
    expect(document.querySelector(".ps-profile")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Actualizando Mi Perfil");

    periodRefresh.reject(new Error("Fallo de red"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Fallo de red"));
    expect(screen.getByRole("heading", { name: "Perfil anterior" })).toBeInTheDocument();
    expect(document.querySelector(".ps-profile")).toHaveAttribute("aria-busy", "false");
  });

  it("ends initial loading and shows the existing alert on request failure", async () => {
    adminApiFetchMock.mockRejectedValue(new Error("Servicio no disponible"));
    render(<DesignerProfileModule authUser={{ id: "designer-2" }} />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Servicio no disponible"));
    expect(document.querySelector(".pd-profile-skeleton")).not.toBeInTheDocument();
  });
});
