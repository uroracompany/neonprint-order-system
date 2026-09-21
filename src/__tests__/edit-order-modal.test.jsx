import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditOrderModal from "../components/orders/EditOrderModal";
import { adminApiFetch } from "../utils/adminApi";

const { resolveOrderAssetUrl, uploadOrderAsset, canDecodeAsImage, compressImage } = vi.hoisted(() => ({
  resolveOrderAssetUrl: vi.fn(),
  uploadOrderAsset: vi.fn(),
  canDecodeAsImage: vi.fn(),
  compressImage: vi.fn(),
}));

vi.mock("../utils/adminApi", () => ({
  adminApiFetch: vi.fn(),
}));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl,
  requiresOrderAssetGateway: () => true,
  openOrderAssetUrl: vi.fn(),
}));

vi.mock("../utils/uploadOrderAsset", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadOrderAsset,
}));

vi.mock("../utils/imageValidation", async (importOriginal) => ({
  ...(await importOriginal()),
  canDecodeAsImage,
  compressImage,
}));

const completeOrder = {
  id: "order-1",
  client_id: "client-1",
  client_name: "JP Morgan",
  client_contact: "809-293-2323",
  invoice_number: "FAC-001",
  description: "Impresion de lona para evento",
  material: "Lona, Vinil",
  termination_type: "Mate",
  delivery_date: "2026-09-15T12:00:00.000Z",
  status: "Pending",
  order_design_type: "EXTERNAL_DESING",
  order_file_url: [],
  reference_images: [],
};

const renderModal = (order = completeOrder, props = {}) => render(
  <EditOrderModal
    open
    onClose={vi.fn()}
    onUpdated={vi.fn()}
    order={order}
    editMode="seller"
    productionCatalog={{
      materials: { ploteo: ["Lona", "Vinil", "Acrilico"] },
      terminations: { ploteo: ["Mate"] },
    }}
    clients={[{ id: "client-1", name: "JP Morgan", phone: "809-293-2323" }]}
    {...props}
  />
);

describe("EditOrderModal seller hydration", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    adminApiFetch.mockReset();
    resolveOrderAssetUrl.mockReset();
    uploadOrderAsset.mockReset();
    canDecodeAsImage.mockReset();
    compressImage.mockReset();
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: {} });
    resolveOrderAssetUrl.mockResolvedValue("https://signed.example.test/preview.webp");
    uploadOrderAsset.mockResolvedValue("supabase://order-previews/orders/order-1/preview/work-order.webp");
    canDecodeAsImage.mockResolvedValue({ valid: true });
    compressImage.mockImplementation((file) => Promise.resolve(file));
  });

  it("keeps legacy order-wide material and termination summaries out of the form", () => {
    renderModal();

    expect(screen.getByDisplayValue("809-293-2323")).toBeDisabled();
    expect(screen.getByDisplayValue("Impresion de lona para evento")).toBeVisible();
    expect(screen.getByDisplayValue("2026-09-15")).toBeVisible();
    expect(screen.queryByDisplayValue("Mate")).not.toBeInTheDocument();
    expect(screen.queryByText("Lona")).not.toBeInTheDocument();
    expect(screen.queryByText("Vinil")).not.toBeInTheDocument();
  });

  it("conserva el teléfono internacional del cliente al editar una orden", () => {
    renderModal({
      ...completeOrder,
      client_contact: "+52 55 1234 5678",
    });

    expect(screen.getByDisplayValue("+52 55 1234 5678")).toBeDisabled();
    expect(screen.queryByText(/República Dominicana|809, 829 o 849/i)).not.toBeInTheDocument();
  });

  it("does not allow the existing delivery date to be submitted empty", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(screen.getByDisplayValue("2026-09-15"));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/i }));

    expect(screen.getByText("La fecha de entrega existente no puede quedar vacia.")).toBeVisible();
  });

  it("reuses the shared Details modal for each newly added file", async () => {
    const user = userEvent.setup();
    renderModal();
    const file = new File(["contenido"], "banner.pdf", { type: "application/pdf" });
    const uploadInput = screen.getByRole("group", { name: "Agregar archivos" }).querySelector('input[type="file"]');
    expect(uploadInput).toBeTruthy();

    await user.upload(uploadInput, file);

    await user.click(screen.getByRole("button", { name: "Detalles" }));
    expect(screen.getByRole("heading", { name: "Detalles de Archivo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre visible en seguimiento")).toBeInTheDocument();
    expect(screen.getByLabelText("Área de producción")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre visible en seguimiento de banner.pdf")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre visible en seguimiento"), "Banner principal");
    await user.selectOptions(screen.getByLabelText("Área de producción"), "ploteo");
    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Lona" }));
    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("option", { name: "Mate" }));
    await user.click(screen.getByRole("button", { name: "Guardar Detalles" }));

    expect(screen.queryByRole("heading", { name: "Detalles de Archivo" })).not.toBeInTheDocument();
    expect(screen.getByText("Seguimiento: Banner principal")).toBeInTheDocument();
  });

  it("shows only asset controls and saves only asset changes in assets-only mode", async () => {
    const user = userEvent.setup();
    renderModal(completeOrder, { assetsOnly: true });

    expect(screen.getByText("Gestionar archivos #ORDER-1")).toBeVisible();
    expect(screen.queryByText("Datos del cliente")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cliente registrado")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Descripcion")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha de entrega")).not.toBeInTheDocument();
    expect(screen.getByText("Archivos y Orden de Trabajo")).toBeVisible();
    expect(screen.getByText("Orden de Trabajo")).toBeVisible();
    expect(screen.queryByText("Imagen de preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Vista previa del diseño")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar archivos ->" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: {
        order_file_url: "[]",
        preview_image: null,
        reference_images: [],
      },
    })));
  });

  it("bloquea el guardado de Semi-Admin sin una Orden de Trabajo", async () => {
    const user = userEvent.setup();
    renderModal(completeOrder, { assetsOnly: true, requireWorkOrder: true });

    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    expect(screen.getAllByText("La Orden de Trabajo es obligatoria. Adjunta la Orden de Trabajo antes de continuar.")[0]).toBeVisible();
    expect(adminApiFetch).not.toHaveBeenCalled();
  });

  it("resolves persisted preview references through the shared asset gateway", async () => {
    renderModal({
      ...completeOrder,
      preview_image: "supabase://order-previews/orders/order-1/preview.webp",
    }, { assetsOnly: true });

    const preview = await screen.findByAltText("Orden de Trabajo");
    expect(preview).toHaveAttribute("src", "https://signed.example.test/preview.webp");
    expect(resolveOrderAssetUrl).toHaveBeenCalledWith("supabase://order-previews/orders/order-1/preview.webp");
  });

  it("resolves one or several persisted reference images through the shared asset gateway", async () => {
    const references = [
      "supabase://order-docs/orders/order-1/ref-images/first.webp",
      "supabase://order-docs/orders/order-1/ref-images/second.webp",
    ];
    resolveOrderAssetUrl.mockImplementation(async (assetRef) => `https://signed.example.test/${assetRef.split("/").pop()}`);

    renderModal({ ...completeOrder, reference_images: references }, { assetsOnly: true });

    expect(await screen.findByAltText("first.webp")).toHaveAttribute("src", "https://signed.example.test/first.webp");
    expect(await screen.findByAltText("second.webp")).toHaveAttribute("src", "https://signed.example.test/second.webp");
    expect(resolveOrderAssetUrl).toHaveBeenCalledWith(references[0], { expiresIn: 600, download: false });
    expect(resolveOrderAssetUrl).toHaveBeenCalledWith(references[1], { expiresIn: 600, download: false });
  });

  it("preserves persisted reference images when saving without asset changes", async () => {
    const user = userEvent.setup();
    const existingReference = "supabase://order-docs/orders/order-1/ref-images/existing.webp";
    renderModal({ ...completeOrder, reference_images: [existingReference] }, { assetsOnly: true });

    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: expect.objectContaining({ reference_images: [existingReference] }),
    })));
    expect(uploadOrderAsset).not.toHaveBeenCalled();
  });

  it("preserves existing reference images when saving unchanged and appends a new upload", async () => {
    const user = userEvent.setup();
    const existingReference = "supabase://order-docs/orders/order-1/ref-images/existing.webp";
    const newReference = "supabase://order-docs/orders/order-1/ref-images/new.webp";
    uploadOrderAsset.mockResolvedValue(newReference);
    renderModal({ ...completeOrder, reference_images: [existingReference] }, { assetsOnly: true });

    const input = screen.getByRole("group", { name: "Subir imagenes" }).querySelector('input[type="file"]');
    await user.upload(input, new File(["reference"], "new.webp", { type: "image/webp" }));
    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: expect.objectContaining({ reference_images: [existingReference, newReference] }),
    })));
    expect(uploadOrderAsset).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "order-docs",
      path: expect.stringContaining("orders/order-1/ref-images/"),
    }));
  });

  it("removes only the selected persisted reference image", async () => {
    const user = userEvent.setup();
    const firstReference = "supabase://order-docs/orders/order-1/ref-images/first.webp";
    const secondReference = "supabase://order-docs/orders/order-1/ref-images/second.webp";
    adminApiFetch.mockResolvedValue({
      response: { ok: true },
      result: { order: { ...completeOrder, reference_images: [secondReference], updated_at: "2026-09-07T02:00:00.000Z" } },
    });
    renderModal({ ...completeOrder, reference_images: [firstReference, secondReference], updated_at: "2026-09-07T01:00:00.000Z" }, { assetsOnly: true });

    await screen.findByAltText("first.webp");
    await user.click(document.querySelector(".ps-files-list .ps-file-remove"));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: expect.objectContaining({ reference_images: [secondReference] }),
      removed_file_urls: [firstReference],
      asset_operation: "manage_assets",
      asset_removal_only: true,
    })));
  });

  it("elimina de forma persistente la Orden de Trabajo guardada", async () => {
    const user = userEvent.setup();
    const updatedOrder = {
      ...completeOrder,
      preview_image: null,
      updated_at: "2026-09-05T17:00:00.000Z",
    };
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { order: updatedOrder } });
    renderModal({
      ...completeOrder,
      updated_at: "2026-09-05T16:00:00.000Z",
      preview_image: "supabase://order-previews/orders/order-1/preview.webp",
    }, { assetsOnly: true, requireWorkOrder: true });

    await screen.findByAltText("Orden de Trabajo");
    await user.click(document.querySelector(".ps-preview-del-btn"));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: expect.objectContaining({ preview_image: null }),
      removed_file_urls: ["supabase://order-previews/orders/order-1/preview.webp"],
      asset_operation: "manage_assets",
      asset_removal_only: true,
    })));
    expect(screen.queryByAltText("Orden de Trabajo")).not.toBeInTheDocument();
  });

  it("passes the saved order to its parent before closing the assets modal", async () => {
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    const updatedOrder = { ...completeOrder, preview_image: "https://signed.example.test/new-preview.webp" };
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { order: updatedOrder } });
    const user = userEvent.setup();
    renderModal(completeOrder, { assetsOnly: true, onUpdated, onClose });

    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updatedOrder));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("confirma al Semi-Admin solo después de persistir un archivo nuevo", async () => {
    const user = userEvent.setup();
    const onAssetSaved = vi.fn();
    const updatedOrder = {
      ...completeOrder,
      preview_image: "supabase://order-previews/orders/order-1/preview/work-order.webp",
      updated_at: "2026-09-05T18:00:00.000Z",
    };
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { order: updatedOrder } });
    renderModal(completeOrder, {
      assetsOnly: true,
      requireWorkOrder: true,
      onAssetSaved,
    });

    const input = screen.getByRole("group", { name: "Subir Orden de Trabajo" }).querySelector('input[type="file"]');
    await user.upload(input, new File(["orden"], "orden.webp", { type: "image/webp" }));
    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(onAssetSaved).toHaveBeenCalledWith({
      order: updatedOrder,
      addedAssetCount: 1,
    }));
  });

  it("no confirma archivo cuando la persistencia de la orden falla", async () => {
    const user = userEvent.setup();
    const onAssetSaved = vi.fn();
    adminApiFetch.mockResolvedValue({
      response: { ok: false },
      result: { error: "No se pudo actualizar la orden." },
    });
    renderModal(completeOrder, {
      assetsOnly: true,
      requireWorkOrder: true,
      onAssetSaved,
    });

    const input = screen.getByRole("group", { name: "Subir Orden de Trabajo" }).querySelector('input[type="file"]');
    await user.upload(input, new File(["orden"], "orden.webp", { type: "image/webp" }));
    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(screen.getByText(/Error al actualizar/i)).toBeVisible());
    expect(onAssetSaved).not.toHaveBeenCalled();
  });
});
