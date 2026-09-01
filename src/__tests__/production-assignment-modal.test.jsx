import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductionAssignmentModal from "../components/orders/ProductionAssignmentModal";

const { from } = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: { from },
}));

const areaRows = [
  { code: "digital", label: "Digital", producer_role: "digital_producer", is_active: true },
  { code: "dtf", label: "DTF", producer_role: "dtf_producer", is_active: true },
  { code: "ploteo", label: "Ploteo", producer_role: "ploteo_producer", is_active: true },
];

const activeUsers = [
  {
    id: "digital-user",
    name: "Ana Digital",
    email: "ana.digital@example.test",
    role: "digital_producer",
    employment_status: true,
    deleted_at: null,
  },
  {
    id: "ploteo-user",
    name: "Pablo Ploteo",
    email: "pablo.ploteo@example.test",
    role: "ploteo_producer",
    employment_status: true,
    deleted_at: null,
  },
];

const baseOrder = {
  id: "12345678-1234-1234-1234-123456789abc",
  client_name: "Cliente NeonPrint",
  description: "Orden de prueba",
  order_production_files: [
    {
      id: "file-digital-1",
      url: "https://example.test/digital-front.pdf",
      filename: "digital-front.pdf",
      production_area_code: "digital",
    },
    {
      id: "file-digital-2",
      url: "https://example.test/digital-back.pdf",
      filename: "digital-back.pdf",
      production_area_code: "digital",
    },
    {
      id: "file-ploteo-1",
      url: "https://example.test/ploteo.pdf",
      filename: "ploteo.pdf",
      production_area_code: "ploteo",
    },
  ],
};

const createQuery = (result) => {
  const promise = Promise.resolve(result);
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    is: vi.fn(() => query),
    then: (resolve, reject) => promise.then(resolve, reject),
  };
  return query;
};

const configureSupabase = ({ areas = areaRows, users = activeUsers, areasResult, usersResult } = {}) => {
  const areaQuery = createQuery(areasResult || { data: areas, error: null });
  const profileQuery = createQuery(usersResult || { data: users, error: null });

  from.mockImplementation((table) => {
    if (table === "production_areas") return areaQuery;
    if (table === "profiles") return profileQuery;
    throw new Error(`Unexpected Supabase table: ${table}`);
  });

  return { areaQuery, profileQuery };
};

const renderModal = (order = baseOrder, { loading = false, onClose = vi.fn(), onConfirm = vi.fn(), title } = {}) => {
  const view = render(
    <ProductionAssignmentModal
      open
      onClose={onClose}
      onConfirm={onConfirm}
      order={order}
      loading={loading}
      title={title}
    />,
  );

  return { ...view, onClose, onConfirm };
};

describe("ProductionAssignmentModal", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("loads participating areas and confirms the exact assignment object", async () => {
    const { areaQuery, profileQuery } = configureSupabase();
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    const dialog = await screen.findByRole("dialog", { name: "Asignar Producción" });
    const selects = await screen.findAllByRole("combobox");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "pam-title");
    expect(dialog).toHaveAttribute("aria-describedby", "pam-description");
    expect(screen.getByText("Selecciona un responsable por cada área participante.")).toHaveAttribute("id", "pam-description");
    expect(dialog).toHaveClass("pq-dialog--production-assignment");
    expect(dialog.querySelector("header")).toBeInTheDocument();
    expect(dialog.querySelector("footer")).toBeInTheDocument();

    expect(screen.getByText("Digital")).toBeInTheDocument();
    expect(screen.getByText("Ploteo")).toBeInTheDocument();
    expect(screen.queryByText("DTF")).not.toBeInTheDocument();
    expect(screen.getByText("2 archivos")).toBeInTheDocument();
    expect(screen.getByText("1 archivo")).toBeInTheDocument();
    expect(selects).toHaveLength(2);
    expect(selects[0]).toBeInstanceOf(HTMLSelectElement);
    expect(selects[1]).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enviar a Producción" })).toBeDisabled();

    expect(areaQuery.select).toHaveBeenCalledWith("code,label,producer_role,is_active");
    expect(areaQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(profileQuery.select).toHaveBeenCalledWith("id,name,email,role,employment_status,deleted_at");
    expect(profileQuery.in).toHaveBeenCalledWith("role", ["digital_producer", "ploteo_producer"]);
    expect(profileQuery.eq).toHaveBeenCalledWith("employment_status", true);
    expect(profileQuery.is).toHaveBeenCalledWith("deleted_at", null);

    await user.selectOptions(selects[0], "digital-user");
    await user.selectOptions(selects[1], "ploteo-user");

    const sendButton = screen.getByRole("button", { name: "Enviar a Producción" });
    expect(selects[0]).toHaveValue("digital-user");
    expect(selects[1]).toHaveValue("ploteo-user");
    expect(sendButton).toBeEnabled();

    await user.click(sendButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      digital: "digital-user",
      ploteo: "ploteo-user",
    });
  });

  it("keeps the native selectors and actions accessible through the dialog contract", async () => {
    configureSupabase({
      areas: [areaRows[0]],
      users: [activeUsers[0]],
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      ...baseOrder,
      order_production_files: [baseOrder.order_production_files[0]],
    }, { onClose });

    const dialog = await screen.findByRole("dialog", { name: "Asignar Producción" });
    const heading = screen.getByRole("heading", { name: "Asignar Producción" });
    const description = screen.getByText("Selecciona un responsable por cada área participante.");
    const select = screen.getByRole("combobox");
    const cancelButton = screen.getByRole("button", { name: "Cancelar" });
    const sendButton = screen.getByRole("button", { name: "Enviar a Producción" });

    expect(dialog).toContainElement(heading);
    expect(dialog).toContainElement(description);
    expect(heading).toHaveAttribute("id", "pam-title");
    expect(select).toHaveDisplayValue("Seleccionar responsable");
    expect(select).toHaveValue("");
    expect(select).toHaveAttribute("class", expect.stringContaining("pq-input"));
    expect(cancelButton).toHaveAttribute("type", "button");
    expect(sendButton).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveAttribute("type", "button");

    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("blocks sending when any production file is unclassified", async () => {
    configureSupabase({
      areas: [areaRows[0]],
      users: [activeUsers[0]],
    });
    const order = {
      ...baseOrder,
      order_production_files: [
        baseOrder.order_production_files[0],
        {
          id: "file-unclassified",
          url: "https://example.test/unclassified.pdf",
          filename: "unclassified.pdf",
          production_area_code: null,
        },
      ],
    };
    const { onConfirm } = renderModal(order);

    expect(await screen.findByRole("alert")).toHaveTextContent("Clasifica todos los archivos antes de continuar.");
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enviar a Producción" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the no-files error and does not query profiles when the order has no files", async () => {
    const { profileQuery } = configureSupabase();
    const { onConfirm } = renderModal({
      ...baseOrder,
      order_production_files: [],
      order_file_url: null,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("La orden no tiene archivos clasificados para producción.");
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Enviar a Producción" })).toBeDisabled();
    expect(profileQuery.select).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows an explicit no-active-user failure and keeps the area unavailable", async () => {
    configureSupabase({
      areas: [areaRows[0]],
      usersResult: { data: [], error: { message: "profiles unavailable" } },
    });
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      ...baseOrder,
      order_production_files: [baseOrder.order_production_files[0]],
    });

    expect(await screen.findByText("No hay usuarios activos para esta área.")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
    const sendButton = screen.getByRole("button", { name: "Enviar a Producción" });
    expect(sendButton).toBeDisabled();

    await user.click(sendButton);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("exposes the loading status and disables submission while options are pending", async () => {
    let resolveAreas;
    const areasPromise = new Promise((resolve) => {
      resolveAreas = resolve;
    });
    configureSupabase({ areasResult: areasPromise });
    renderModal();

    expect(await screen.findByRole("status")).toHaveTextContent("Cargando responsables…");
    expect(screen.getByRole("button", { name: "Enviar a Producción" })).toBeDisabled();

    resolveAreas({ data: areaRows, error: null });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("keeps selectors and both buttons disabled during the parent submission", async () => {
    configureSupabase({
      areas: [areaRows[0]],
      users: [activeUsers[0]],
    });
    renderModal({
      ...baseOrder,
      order_production_files: [baseOrder.order_production_files[0]],
    }, { loading: true });

    expect(await screen.findByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  });
});
