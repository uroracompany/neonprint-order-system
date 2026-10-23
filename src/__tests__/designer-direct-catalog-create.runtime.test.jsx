import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  insertError: null,
  failNextMaterialRead: false,
  areaLoadPromise: null,
  insertedMaterials: [],
  fromCalls: [],
  showActionNotification: vi.fn(),
  authUser: { id: "designer-1", email: "designer@example.test" },
  authProfile: { first_name: "Ana", last_name: "Diseñadora" },
  notificationsApi: null,
  reviewsApi: null,
  returnsApi: null,
  assignmentsApi: null,
}));
state.notificationsApi = {
  notifications: [], archivedNotifications: [], unreadCount: 0, loading: false, archivedLoading: false, toasts: [],
  markAsRead: vi.fn(), markAllAsRead: vi.fn(), archive: vi.fn(), deleteNotification: vi.fn(), dismissToast: vi.fn(),
  deleteNotificationsByScope: vi.fn(), notificationSoundEnabled: false, notificationSoundLoading: false,
  setNotificationSoundEnabled: vi.fn(), refresh: vi.fn(), showActionNotification: state.showActionNotification,
};
state.reviewsApi = { pendingByOrder: {}, acknowledgingOrderId: null, acknowledgeOrder: vi.fn(), acknowledgeError: null };
state.returnsApi = { incomingByOrder: {}, historyByOrder: {}, refresh: vi.fn() };
state.assignmentsApi = { pendingByOrder: {}, acknowledgeOrder: vi.fn() };

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn((table) => {
      state.fromCalls.push(table);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        not: vi.fn(() => query),
        order: vi.fn(() => query),
        insert: vi.fn(async (record) => {
          if (state.insertError) return { error: state.insertError };
          state.insertedMaterials.push(record);
          return { error: null };
        }),
        then: (resolve, reject) => {
          if (table === "production_areas" && state.areaLoadPromise) {
            return state.areaLoadPromise.then(resolve, reject);
          }
          if (table === "materials" && state.failNextMaterialRead) {
            state.failNextMaterialRead = false;
            return Promise.resolve({ data: null, error: { code: "08006", message: "temporary read failure" } }).then(resolve, reject);
          }
          const data = table === "materials"
            ? state.insertedMaterials
            : table === "production_areas"
              ? [{ code: "active-area", label: "Impresión" }]
              : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: state.authUser, profile: state.authProfile, signOut: vi.fn() }),
}));
vi.mock("../hooks/useNotifications", () => ({
  default: () => state.notificationsApi,
}));
vi.mock("../hooks/useOrderEventReviews", () => ({ default: () => state.reviewsApi }));
vi.mock("../hooks/useOrderReturnHandoffs", () => ({ default: () => state.returnsApi }));
vi.mock("../hooks/useNewOrderAssignments", () => ({ default: () => state.assignmentsApi }));
vi.mock("../hooks/useOrdersRealtimeSync", () => ({ default: () => undefined }));
vi.mock("../hooks/useOrderParticipation", () => ({ useOrderParticipation: () => ({ events: [], loading: false, error: null }) }));
vi.mock("../utils/clients", () => ({
  loadClients: vi.fn(async () => []),
  searchClients: vi.fn(async () => []),
  orderMatchesClientFilter: () => true,
  formatPhone: (value) => value,
}));

vi.mock("../components/Sidebar", () => ({ default: () => null }));
vi.mock("../components/ui/AssignModal", () => ({ AssignModal: () => null }));
vi.mock("../components/ui/ArchiveOrderModal", () => ({ default: () => null }));
vi.mock("../components/ui/FileUploadZone", () => ({ default: () => null }));
vi.mock("../components/orders/OrderReviewCard", () => ({ default: () => null }));
vi.mock("../components/orders/OrderReviewBadge", () => ({ default: () => null }));
vi.mock("../components/orders/NewOrderBadge", () => ({ default: () => null }));
vi.mock("../components/ui/Badge", () => ({ StatusBadge: () => null }));
vi.mock("../components/ui/Pagination", () => ({ Pagination: () => null }));
vi.mock("../components/ui/ClientCombobox", () => ({ ClientFilterSelect: () => null }));
vi.mock("../components/ui/FilterSelect", () => ({ FilterSelect: () => null }));
vi.mock("../components/NotificationCenter", () => ({ default: () => null }));
vi.mock("../components/FileCard", () => ({ default: () => null }));
vi.mock("../components/orders/ProductionAssignmentModal", () => ({ default: () => null }));
vi.mock("../components/designer/DesignerProfileModule", () => ({ default: () => null }));
vi.mock("../components/designer/DesignerNotificationsModule", () => ({ default: () => null }));
vi.mock("../components/orders/ReturnToCashierModal", () => ({ default: () => null }));
vi.mock("../components/orders/ReturnToDesignerModal", () => ({ default: () => null }));
vi.mock("../components/orders/OrderReturnHandoff", () => ({ OrderReturnHandoffPanel: () => null }));
vi.mock("../components/FlowTracker", () => ({ FlowTracker: () => null }));
vi.mock("../components/orders/OrderTrackingLink", () => ({ default: () => null }));
vi.mock("../components/orders/OrderParticipationTimeline", () => ({ OrderParticipationTimelineContent: () => null }));

vi.mock("../components/orders/CreateOrderModal", () => ({
  default: ({ open, productionCatalog, clients, clientToSelect, onAddNewClient }) => open
    ? <div data-testid="create-order-modal">
      <span>{JSON.stringify({ productionCatalog, clients, clientToSelect })}</span>
      <button type="button" onClick={onAddNewClient}>Agregar cliente desde orden</button>
    </div>
    : null,
  ProductionFileDetailsModal: () => null,
  Modal: ({ open, title, children }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null,
  Field: ({ label, children }) => <label>{label}{children}</label>,
}));
vi.mock("../components/ui/CreateClientModal", () => ({
  default: ({ open, onCreated, onClose }) => open
    ? <section data-testid="create-client-modal">
      <button type="button" onClick={async () => {
        await onCreated({ id: "client-new", name: "Cliente nuevo", phone: "8295550101" });
        onClose();
      }}>Guardar cliente de prueba</button>
    </section>
    : null,
}));
import PageDesigner from "../pages/page-designer";

const renderDesigner = () => render(<PageDesigner />);

const fillMaterialForm = () => {
  fireEvent.change(screen.getByLabelText(/^Nombre del material/), { target: { value: "Lona premium" } });
  fireEvent.change(screen.getByLabelText(/^Área de producción/), { target: { value: "active-area" } });
};

describe("Designer direct catalog creation runtime", () => {
  beforeEach(() => {
    state.insertError = null;
    state.failNextMaterialRead = false;
    state.areaLoadPromise = null;
    state.insertedMaterials = [];
    state.fromCalls = [];
    state.showActionNotification.mockClear();
  });

  afterEach(() => cleanup());

  it("opens the client form directly without opening order creation, then registers the client", async () => {
    renderDesigner();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    expect(await screen.findByTestId("create-client-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("create-order-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente de prueba" }));
    await waitFor(() => expect(state.showActionNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Cliente registrado" })));
    expect(screen.queryByTestId("create-order-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nueva orden" }));
    expect(await screen.findByTestId("create-order-modal")).toHaveTextContent("Cliente nuevo");
    expect(screen.getByTestId("create-order-modal")).toHaveTextContent('"clientToSelect":null');
  });

  it("keeps client creation from the order selector and preselects the created client", async () => {
    renderDesigner();
    fireEvent.click(screen.getByRole("button", { name: "Nueva orden" }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar cliente desde orden" }));
    fireEvent.click(await screen.findByRole("button", { name: "Guardar cliente de prueba" }));

    await waitFor(() => expect(screen.getByTestId("create-order-modal")).toHaveTextContent('"clientToSelect":{"id":"client-new"'));
  });

  it("opens materials directly with active areas, inserts successfully and refreshes the order catalog", async () => {
    renderDesigner();
    fireEvent.click(screen.getByRole("button", { name: "Crear materiales" }));
    expect(await screen.findByRole("dialog", { name: "Agregar material" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Impresión" })).toHaveValue("active-area");
    fillMaterialForm();
    fireEvent.click(screen.getByRole("button", { name: "Agregar material" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Agregar material" })).not.toBeInTheDocument());
    expect(state.insertedMaterials).toEqual([{ name: "Lona premium", production_area_code: "active-area" }]);
    expect(state.showActionNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Material creado" }));

    fireEvent.click(screen.getByRole("button", { name: "Nueva orden" }));
    expect(await screen.findByTestId("create-order-modal")).toHaveTextContent("Lona premium");
  });

  it("announces area loading and associates labels with the material form controls", async () => {
    let resolveAreas;
    state.areaLoadPromise = new Promise((resolve) => { resolveAreas = resolve; });
    renderDesigner();
    fireEvent.click(screen.getByRole("button", { name: "Crear materiales" }));

    const dialog = await screen.findByRole("dialog", { name: "Agregar material" });
    expect(within(dialog).getByLabelText(/^Nombre del material/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Área de producción/)).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Cargando áreas de producción");

    resolveAreas({ data: [{ code: "active-area", label: "Impresión" }], error: null });
    expect(await within(dialog).findByRole("option", { name: "Impresión" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Área de producción/)).toBeEnabled();
  });

  it.each([
    ["duplicate", { code: "23505", message: "duplicate key" }, "Ya existe un material"],
    ["permission", { code: "42501", message: "permission denied" }, "No tienes permiso"],
  ])("retains the form and entered values on %s errors", async (_name, error, message) => {
    state.insertError = error;
    renderDesigner();
    fireEvent.click(screen.getByRole("button", { name: "Crear materiales" }));
    await screen.findByRole("dialog", { name: "Agregar material" });
    await screen.findByRole("option", { name: "Impresión" });
    fillMaterialForm();
    fireEvent.click(screen.getByRole("button", { name: "Agregar material" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(/^Nombre del material/)).toHaveValue("Lona premium");
    expect(screen.getByLabelText(/^Área de producción/)).toHaveValue("active-area");
    expect(state.insertedMaterials).toHaveLength(0);
  });

  it("recovers a failed catalog refresh after closing and reopening without changing or duplicating the inserted material", async () => {
    renderDesigner();
    fireEvent.click(screen.getByRole("button", { name: "Crear materiales" }));
    await screen.findByRole("dialog", { name: "Agregar material" });
    await screen.findByRole("option", { name: "Impresión" });
    fillMaterialForm();
    state.failNextMaterialRead = true;
    fireEvent.click(screen.getByRole("button", { name: "Agregar material" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El material ya se guardó");
    expect(state.insertedMaterials).toHaveLength(1);
    const nameInput = screen.getByLabelText(/^Nombre del material/);
    const areaSelect = screen.getByLabelText(/^Área de producción/);
    expect(nameInput).toBeDisabled();
    expect(areaSelect).toBeDisabled();
    // Even if a script dispatches a change event to the disabled controls,
    // retry must use the exact payload that was already inserted.
    fireEvent.change(nameInput, { target: { value: "Nombre cambiado" } });
    fireEvent.change(areaSelect, { target: { value: "another-area" } });
    expect(nameInput).toHaveValue("Lona premium");
    expect(areaSelect).toHaveValue("active-area");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Agregar material" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Crear materiales" }));
    expect(await screen.findByRole("dialog", { name: "Agregar material" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Impresión" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre del material/)).toHaveValue("Lona premium");
    expect(screen.getByLabelText(/^Nombre del material/)).toBeDisabled();
    expect(screen.getByLabelText(/^Área de producción/)).toHaveValue("active-area");
    expect(screen.getByLabelText(/^Área de producción/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar actualización" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Agregar material" })).not.toBeInTheDocument());
    expect(state.insertedMaterials).toHaveLength(1);
    expect(state.showActionNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Material creado",
      message: 'El material "Lona premium" se agregó correctamente.',
      metadata: expect.objectContaining({ material_name: "Lona premium" }),
    }));
  });
});
