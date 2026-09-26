import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductionProfileModule from "../components/production/ProductionProfileModule";
import { adminApiFetch } from "../utils/adminApi";

vi.mock("../utils/adminApi", () => ({
  adminApiFetch: vi.fn(),
}));

vi.mock("../hooks/useOrdersRealtimeSync", () => ({
  default: vi.fn(),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }) => <div>{children}</div>,
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }) => <div>{children}</div>,
  Cell: () => null,
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const fileStatusRows = [
  { key: "pending", name: "Pendiente", value: 1, percentage: 16.7 },
  { key: "in_production", name: "En produccion", value: 2, percentage: 33.3 },
  { key: "in_termination", name: "En terminacion", value: 1, percentage: 16.7 },
  { key: "completed", name: "Completado", value: 2, percentage: 33.3 },
];

const makeResult = (productionFileStatus) => ({
  profile: { id: "producer-1", name: "Productor Uno", employment_status: true },
  metrics: {
    orders_completed: 1,
    completion_rate: 50,
    orders_active: 2,
    orders_delivered: 0,
    orders_cancelled: 0,
    total_orders: 2,
    goals_achieved: 1,
    files_processed: productionFileStatus.total,
    avg_completion_time: 0,
    termination_rate: 50,
  },
  ranking: {},
  analytics: {
    order_types: { rows: [], total: 0 },
    trends: { "30d": [] },
    top_materials: [{ name: "Acrilico", count: 2, percentage: 100 }],
    top_clients: [{ name: "Cliente Uno", count: 2, percentage: 100 }],
    status_summary: {
      in_production: 1,
      in_termination: 0,
      delivered: 0,
      completed: 1,
      cancelled: 0,
    },
    production_file_status: productionFileStatus,
  },
});

describe("ProductionProfileModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra los estados de archivos como pastel en la tercera carta y una sola barra de produccion", async () => {
    adminApiFetch.mockResolvedValue({
      response: { ok: true },
      result: makeResult({ total: 6, rows: fileStatusRows }),
    });

    render(<ProductionProfileModule authUser={{ id: "producer-1" }} />);

    expect(await screen.findByText("Estado de archivos")).toBeInTheDocument();
    expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
    expect(screen.getAllByTestId("bar-chart")).toHaveLength(1);
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getAllByText("En produccion").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("33.3%")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
    expect(headings.indexOf("Clientes con mas ordenes")).toBeLessThan(headings.indexOf("Materiales mas trabajados"));
    expect(headings.indexOf("Materiales mas trabajados")).toBeLessThan(headings.indexOf("Estado de archivos"));
    expect(headings.filter((heading) => heading === "Estado de produccion")).toHaveLength(1);
  });

  it("muestra el estado vacio cuando no hay archivos", async () => {
    adminApiFetch.mockResolvedValue({
      response: { ok: true },
      result: makeResult({ total: 0, rows: fileStatusRows.map((row) => ({ ...row, value: 0, percentage: 0 })) }),
    });

    render(<ProductionProfileModule authUser={{ id: "producer-1" }} />);

    expect(await screen.findByText("Sin datos de archivos")).toBeInTheDocument();
    expect(screen.queryByTestId("pie-chart")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("bar-chart")).toHaveLength(1);
  });
});
