import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  invoice_assignment_mode: "seller",
  seller_id: "seller-1",
  created_by: "seller-1",
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
    actorId="seller-1"
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

    expect(screen.getByLabelText("Número de Facturación")).toHaveValue("FAC-001");
    expect(screen.getByLabelText("Número de Facturación")).toBeEnabled();
    expect(screen.getByDisplayValue("809-293-2323")).toBeDisabled();
    expect(screen.getByDisplayValue("Impresion de lona para evento")).toBeVisible();
    expect(screen.getByDisplayValue("2026-09-15")).toBeVisible();
    expect(screen.queryByDisplayValue("Mate")).not.toBeInTheDocument();
    expect(screen.queryByText("Lona")).not.toBeInTheDocument();
    expect(screen.queryByText("Vinil")).not.toBeInTheDocument();
  });

  it("persiste el número de facturación desde Editar orden", async () => {
    adminApiFetch.mockResolvedValue({
      response: { ok: true },
      result: { order: { ...completeOrder, invoice_number: "FAC-002" } },
    });
    renderModal();

    const invoiceInput = screen.getByLabelText("Número de Facturación");
    fireEvent.change(invoiceInput, { target: { value: "FAC-002" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: expect.objectContaining({ invoice_number: "FAC-002" }),
    })));
  });

  it("mantiene el código de Caja visible pero de solo lectura", () => {
    renderModal({
      ...completeOrder,
      invoice_assignment_mode: "cashier",
      invoice_number: "FAC-CAJA-001",
    });

    expect(screen.getByLabelText("Número de Facturación")).toHaveValue("FAC-CAJA-001");
    expect(screen.getByLabelText("Número de Facturación")).toBeDisabled();
    expect(screen.getByText("Caja administra este código de facturación.")).toBeVisible();
  });

  it("permite a Semi-Admin editar su código en Diseño, pero no el de Caja", () => {
    const designOrder = {
      ...completeOrder,
      status: "in_Design",
      order_design_type: "INTERNAL_DESING",
    };
    const { rerender } = renderModal(designOrder, {
      isSemiAdmin: true,
      actorId: "seller-1",
    });

    expect(screen.getByLabelText("Número de Facturación")).toBeEnabled();

    rerender(
      <EditOrderModal
        open
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        order={{ ...designOrder, invoice_assignment_mode: "cashier" }}
        editMode="seller"
        isSemiAdmin
        actorId="seller-1"
        productionCatalog={{}}
        clients={[]}
      />,
    );
    expect(screen.getByLabelText("Número de Facturación")).toBeDisabled();
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

    const detailsButton = screen.getByRole("button", { name: "Detalles" });
    expect(detailsButton).toHaveClass("fc-file-action-attention");
    await user.click(detailsButton);
    expect(screen.getByRole("button", { name: "Detalles" })).not.toHaveClass("fc-file-action-attention");
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
    expect(screen.queryByLabelText("Número de Facturación")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha de entrega")).not.toBeInTheDocument();
    expect(screen.getByText("Archivos e imagen de orden de trabajo")).toBeVisible();
    expect(screen.getByText("Imagen de orden de trabajo")).toBeVisible();
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

  it("shows the add-files zone before existing files and work-order image in Semi-Admin Design", async () => {
    const designOrder = {
      ...completeOrder,
      status: "in_Design",
      preview_image: "https://assets.example.test/work-order.webp",
      order_production_files: [{
        id: "production-file-1",
        url: "https://assets.example.test/La-Oracion.pdf",
        filename: "La Oracion.pdf",
        status: "pending",
      }],
    };
    renderModal(designOrder, { assetsOnly: true, semiAdminVariant: true });
    await screen.findByAltText("Imagen de orden de trabajo");

    const addFiles = screen.getByRole("group", { name: "Agregar archivos" });
    const existingFile = screen.getByText("La Oracion.pdf");
    const workOrderLabel = screen.getByText("Imagen de orden de trabajo", { selector: ".ps-label" });

    expect(addFiles.compareDocumentPosition(existingFile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(existingFile.compareDocumentPosition(workOrderLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const editButton = screen.getByRole("button", { name: "Editar detalles" });
    expect(editButton).toBeVisible();
    expect(editButton).toHaveAttribute("title", "Editar archivo y detalles de La Oracion.pdf");
  });

  it("preserves the existing attachment order outside Semi-Admin Design", () => {
    const designOrder = {
      ...completeOrder,
      status: "in_Design",
      order_production_files: [{
        id: "production-file-1",
        url: "https://assets.example.test/La-Oracion.pdf",
        filename: "La Oracion.pdf",
        status: "pending",
      }],
    };
    renderModal(designOrder, { assetsOnly: true });

    const existingFile = screen.getByText("La Oracion.pdf");
    const addFiles = screen.getByRole("group", { name: "Agregar archivos" });

    expect(existingFile.compareDocumentPosition(addFiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("bloquea el guardado de Semi-Admin sin una imagen de orden de trabajo", async () => {
    const user = userEvent.setup();
    renderModal(completeOrder, { assetsOnly: true, requireWorkOrder: true });

    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    expect(screen.getAllByText("La imagen de orden de trabajo es obligatoria. Adjunta la imagen de orden de trabajo antes de continuar.")[0]).toBeVisible();
    expect(adminApiFetch).not.toHaveBeenCalled();
  });

  it("resolves persisted preview references through the shared asset gateway", async () => {
    renderModal({
      ...completeOrder,
      preview_image: "supabase://order-previews/orders/order-1/preview.webp",
    }, { assetsOnly: true });

    const preview = await screen.findByAltText("Imagen de orden de trabajo");
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

  it("elimina de forma persistente la imagen de orden de trabajo guardada", async () => {
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

    await screen.findByAltText("Imagen de orden de trabajo");
    await user.click(document.querySelector(".ps-preview-del-btn"));

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/seller-orders", expect.objectContaining({
      action: "update",
      changes: expect.objectContaining({ preview_image: null }),
      removed_file_urls: ["supabase://order-previews/orders/order-1/preview.webp"],
      asset_operation: "manage_assets",
      asset_removal_only: true,
    })));
    expect(screen.queryByAltText("Imagen de orden de trabajo")).not.toBeInTheDocument();
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

    const input = screen.getByRole("group", { name: "Subir imagen de orden de trabajo" }).querySelector('input[type="file"]');
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

    const input = screen.getByRole("group", { name: "Subir imagen de orden de trabajo" }).querySelector('input[type="file"]');
    await user.upload(input, new File(["orden"], "orden.webp", { type: "image/webp" }));
    await user.click(screen.getByRole("button", { name: "Guardar archivos ->" }));

    await waitFor(() => expect(screen.getByText(/Error al actualizar/i)).toBeVisible());
    expect(onAssetSaved).not.toHaveBeenCalled();
  });
});
