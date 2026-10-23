import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDetailModal } from "../pages/page-designer.jsx";
import { ORDER_STATUS } from "../utils/constants";

const { rpc, resolveOrderAssetUrl, uploadOrderAsset, maybeSingle, channel, removeChannel } = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveOrderAssetUrl: vi.fn(),
  uploadOrderAsset: vi.fn(),
  maybeSingle: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const NativeURL = URL;

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        not: vi.fn(() => Promise.resolve({ data: [], error: null })),
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null })),
          maybeSingle,
        })),
      })),
    })),
    channel,
    removeChannel,
    rpc,
  },
}));

vi.mock("../utils/fileAccess", () => ({ resolveOrderAssetUrl }));
vi.mock("../utils/uploadOrderAsset", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadOrderAsset,
}));
vi.mock("../utils/imageValidation", async (importOriginal) => ({
  ...(await importOriginal()),
  canDecodeAsImage: vi.fn(() => Promise.resolve({ valid: true })),
  compressImage: vi.fn((file) => Promise.resolve(file)),
}));

const orderId = "57aacf7a-0e05-4dd0-9f97-77911fd03bd9";
const designerId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const ref = (name) => `supabase://order-docs/orders/${orderId}/ref-images/${name}.webp`;

const baseOrder = {
  id: orderId,
  created_at: "2026-08-29T10:00:00.000Z",
  updated_at: "2026-08-29T10:00:00.000Z",
  status: ORDER_STATUS.IN_DESIGN,
  designer_id: designerId,
  client_name: "Cliente de prueba",
  client_contact: "8090000000",
  description: "Orden de prueba",
  material: "Vinilo",
  order_type: "normal",
  order_file_url: null,
  order_production_files: [],
  reference_images: [ref("seller"), ref("designer")],
  order_files: [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", provider: "supabase", bucket: "order-docs", object_key: `orders/${orderId}/ref-images/seller.webp`, category: "reference", status: "uploaded", uploaded_by: sellerId },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", provider: "supabase", bucket: "order-docs", object_key: `orders/${orderId}/ref-images/designer.webp`, category: "reference", status: "uploaded", uploaded_by: designerId },
  ],
};

const renderModal = (order = baseOrder, props = {}) => {
  const onRefresh = props.onRefresh || vi.fn(() => Promise.resolve());
  const result = render(
    <OrderDetailModal
      onClose={() => {}}
      order={order}
      designerFiles={[]}
      designerPreview={order.preview_image}
      onRefresh={onRefresh}
      onSendToQuotation={() => {}}
      quotationSending={false}
      currentUserId={designerId}
      {...props}
    />,
  );
  return { ...result, onRefresh };
};

describe("Designer reference images", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
    channel.mockReset().mockImplementation(() => {
      const subscription = {
        on: vi.fn(),
        subscribe: vi.fn(),
      };
      subscription.on.mockReturnValue(subscription);
      subscription.subscribe.mockReturnValue(subscription);
      return subscription;
    });
    removeChannel.mockReset().mockResolvedValue(undefined);
    uploadOrderAsset.mockReset();
    resolveOrderAssetUrl.mockReset();
    resolveOrderAssetUrl.mockImplementation(async (assetRef) => `https://signed.example.test/${assetRef.split("/").pop()}`);
    createObjectURL.mockReset().mockImplementation((file) => `blob:designer-reference/${file.name}`);
    revokeObjectURL.mockReset();
    class URLWithObjectUrls extends NativeURL {}
    URLWithObjectUrls.createObjectURL = createObjectURL;
    URLWithObjectUrls.revokeObjectURL = revokeObjectURL;
    vi.stubGlobal("URL", URLWithObjectUrls);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves private preview and references before rendering images", async () => {
    renderModal({ ...baseOrder, preview_image: `supabase://order-previews/orders/${orderId}/preview/work.webp` });

    expect(screen.getAllByText("Cargando imagen...").length).toBeGreaterThan(0);
    const referenceImage = await screen.findByAltText("Ref 1");
    const previewImage = await screen.findByAltText("Imagen de orden de trabajo");
    expect(referenceImage).toHaveAttribute("src", "https://signed.example.test/seller.webp");
    expect(previewImage).toHaveAttribute("src", "https://signed.example.test/work.webp");
    expect(referenceImage).toHaveClass("is-loading");
    expect(previewImage).toHaveClass("is-loading");
    fireEvent.load(referenceImage);
    fireEvent.load(previewImage);
    await waitFor(() => {
      expect(referenceImage).not.toHaveClass("is-loading");
      expect(previewImage).not.toHaveClass("is-loading");
    });
  });

  it("keeps seller references readonly and exposes actions only for the designer-owned record", async () => {
    renderModal();
    await screen.findByAltText("Ref 1");

    expect(screen.getAllByTitle("Reemplazar imagen")).toHaveLength(1);
    expect(screen.getAllByTitle("Eliminar imagen")).toHaveLength(1);
  });

  it("shows an error only after the reference resolver rejects", async () => {
    resolveOrderAssetUrl.mockRejectedValue(new Error("gateway failed"));
    renderModal();

    expect(screen.getAllByText("Cargando imagen...").length).toBeGreaterThan(0);
    expect(await screen.findAllByText("Ocurrió un problema. Inténtalo nuevamente en unos minutos.")).toHaveLength(2);
  });

  it("ignores a late reference resolution after the modal unmounts", async () => {
    let resolveReference;
    resolveOrderAssetUrl.mockImplementation(() => new Promise((resolve) => { resolveReference = resolve; }));
    const { unmount } = renderModal();

    await waitFor(() => expect(resolveOrderAssetUrl).toHaveBeenCalled());
    unmount();
    resolveReference("https://signed.example.test/late.webp");
    await Promise.resolve();
    expect(screen.queryByAltText("Ref 1")).not.toBeInTheDocument();
  });

  it("removes a designer-owned reference through the specialized versioned RPC", async () => {
    const { onRefresh } = renderModal();
    await screen.findByAltText("Ref 1");
    fireEvent.click(screen.getByTitle("Eliminar imagen"));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("designer_manage_reference_images", {
      p_order_id: orderId,
      p_expected_updated_at: baseOrder.updated_at,
      p_additions: [],
      p_remove_file_ids: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("does not offer uploads after the shared limit of three references", () => {
    const third = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", provider: "supabase", bucket: "order-docs", object_key: `orders/${orderId}/ref-images/third.webp`, category: "reference", status: "uploaded", uploaded_by: sellerId };
    renderModal({ ...baseOrder, reference_images: [...baseOrder.reference_images, ref("third")], order_files: [...baseOrder.order_files, third] });

    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.queryByText("Agregar imágenes de referencia")).not.toBeInTheDocument();
  });

  it("identifies optional and required assets and keeps the empty reference state minimal", async () => {
    const emptyOrder = { ...baseOrder, reference_images: [], order_files: [] };
    const { container } = renderModal(emptyOrder);
    expect(screen.getByText("0/3")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay imágenes de referencia.")).not.toBeInTheDocument();
    expect(container.querySelector(".pd-reference-empty")).not.toBeInTheDocument();
    expect(screen.getByText("(Opcional)")).toBeInTheDocument();
    expect(screen.getAllByText("(Obligatorio)")).toHaveLength(2);

    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    expect(uploadInput.closest(".file-upload-zone")).toHaveClass("file-upload-zone--reference-optional");
    expect(screen.getByRole("button", { name: "Agregar imágenes de referencia" })).toBeInTheDocument();
    fireEvent.change(uploadInput, { target: { files: [new File(["one"], "nueva.webp", { type: "image/webp", lastModified: 11 })] } });
    await screen.findByAltText("Vista previa de nueva.webp");
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay imágenes de referencia.")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".pd-reference-pending-status")).toHaveLength(1);
  });

  it("hides the empty state when saved references exist", () => {
    renderModal(baseOrder);
    expect(screen.queryByText("Aún no hay imágenes de referencia.")).not.toBeInTheDocument();
    expect(document.querySelector(".pd-reference-empty")).not.toBeInTheDocument();
  });

  it("uses one owned remove and one uploaded addition for replacement", async () => {
    uploadOrderAsset.mockResolvedValue(ref("replacement"));
    const { container } = renderModal();
    await screen.findByAltText("Ref 1");
    fireEvent.click(screen.getByTitle("Reemplazar imagen"));
    const replacementInput = container.querySelector(".file-upload-zone--hidden-picker input[type=file]");
    fireEvent.change(replacementInput, { target: { files: [new File(["image"], "replacement.webp", { type: "image/webp" })] } });

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("designer_manage_reference_images", expect.objectContaining({
      p_additions: [ref("replacement")],
      p_remove_file_ids: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    })));
  });

  it("keeps the picker visible while there is capacity and hides it at the combined limit", async () => {
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    fireEvent.change(uploadInput, { target: { files: [new File(["one"], "one.webp", { type: "image/webp", lastModified: 1 })] } });
    await screen.findByText("1 imagen pendiente");
    expect(screen.getByText("Agregar imágenes de referencia")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    fireEvent.change(uploadInput, { target: { files: [new File(["two"], "two.webp", { type: "image/webp", lastModified: 2 })] } });
    expect(await screen.findByText("2 imagenes pendientes")).toBeInTheDocument();
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.getByText("Guardar imágenes")).toBeInTheDocument();
    expect(screen.queryByText("Agregar imágenes de referencia")).not.toBeInTheDocument();
  });

  it("does not create another pending card or preview URL for a duplicate file", async () => {
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    const selectedFile = new File(["same"], "duplicada.webp", { type: "image/webp", lastModified: 15 });
    fireEvent.change(uploadInput, { target: { files: [selectedFile] } });
    await screen.findByAltText("Vista previa de duplicada.webp");

    fireEvent.change(uploadInput, { target: { files: [new File(["same"], "duplicada.webp", { type: "image/webp", lastModified: 15 })] } });

    expect(await screen.findAllByAltText("Vista previa de duplicada.webp")).toHaveLength(1);
    expect(screen.getByText("1 imagen pendiente")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("disables cancel, save and individual removal while pending images are uploading", async () => {
    let resolveUpload;
    uploadOrderAsset.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const file = new File(["image"], "subiendo.webp", { type: "image/webp", lastModified: 16 });
    fireEvent.change(container.querySelector(".pd-reference-upload input[type=file]"), { target: { files: [file] } });
    await screen.findByAltText("Vista previa de subiendo.webp");

    fireEvent.click(screen.getByRole("button", { name: "Guardar imágenes" }));

    const savingButton = await screen.findByRole("button", { name: "Guardando..." });
    expect(savingButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar subiendo.webp" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cerrar detalles de la orden" })).toBeDisabled();

    resolveUpload(ref("subiendo"));
    await waitFor(() => expect(screen.queryByAltText("Vista previa de subiendo.webp")).not.toBeInTheDocument());
  });

  it("removes one pending image, revokes only its URL, preserves other previews and frees capacity", async () => {
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    const first = new File(["one"], "one.webp", { type: "image/webp", lastModified: 21 });
    const second = new File(["two"], "two.webp", { type: "image/webp", lastModified: 22 });
    fireEvent.change(uploadInput, { target: { files: [first, second] } });

    const retainedPreview = await screen.findByAltText("Vista previa de two.webp");
    const removedPreviewUrl = "blob:designer-reference/one.webp";
    fireEvent.click(screen.getByRole("button", { name: "Quitar one.webp" }));

    await waitFor(() => expect(screen.queryByAltText("Vista previa de one.webp")).not.toBeInTheDocument());
    expect(screen.getByAltText("Vista previa de two.webp")).toHaveAttribute("src", retainedPreview.getAttribute("src"));
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Agregar imágenes de referencia")).toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith(removedPreviewUrl);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    const availableUploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    expect(availableUploadInput).not.toBe(uploadInput);
    fireEvent.change(availableUploadInput, { target: { files: [new File(["three"], "three.webp", { type: "image/webp", lastModified: 23 })] } });
    await screen.findByAltText("Vista previa de three.webp");
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.queryByText("Agregar imágenes de referencia")).not.toBeInTheDocument();
  });

  it("previews pending reference images with accessible names and revokes their URLs on cancel", async () => {
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const file = new File(["image"], "referencia-frente.webp", { type: "image/webp", lastModified: 5 });
    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    fireEvent.change(uploadInput, { target: { files: [file] } });

    const preview = await screen.findByAltText("Vista previa de referencia-frente.webp");
    expect(preview).toHaveAttribute("src", "blob:designer-reference/referencia-frente.webp");
    expect(screen.getByText("referencia-frente.webp")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay imágenes de referencia.")).not.toBeInTheDocument();
    expect(screen.getByText("Agregar imágenes de referencia")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(file);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByAltText("Vista previa de referencia-frente.webp")).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:designer-reference/referencia-frente.webp");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([rpcName]) => rpcName === "designer_manage_reference_images")).toHaveLength(0);
  });

  it("discards pending drafts and revokes their URLs when the detail modal closes", async () => {
    const onClose = vi.fn();
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    }, { onClose });
    const file = new File(["image"], "al-cerrar.webp", { type: "image/webp", lastModified: 51 });
    fireEvent.change(container.querySelector(".pd-reference-upload input[type=file]"), { target: { files: [file] } });
    await screen.findByAltText("Vista previa de al-cerrar.webp");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar detalles de la orden" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:designer-reference/al-cerrar.webp");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([rpcName]) => rpcName === "designer_manage_reference_images")).toHaveLength(0);
  });

  it("keeps pending images and their preview available to retry after a save error", async () => {
    uploadOrderAsset
      .mockRejectedValueOnce(new Error("Storage no disponible"))
      .mockResolvedValue(ref("retry"));
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const file = new File(["image"], "reintentar.webp", { type: "image/webp", lastModified: 31 });
    fireEvent.change(container.querySelector(".pd-reference-upload input[type=file]"), { target: { files: [file] } });
    const preview = await screen.findByAltText("Vista previa de reintentar.webp");

    fireEvent.click(screen.getByRole("button", { name: "Guardar imágenes" }));
    expect(await screen.findByText("Storage no disponible")).toBeInTheDocument();
    expect(screen.getByAltText("Vista previa de reintentar.webp")).toHaveAttribute("src", preview.getAttribute("src"));
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar imágenes" })).toBeEnabled();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Guardar imágenes" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("designer_manage_reference_images", expect.objectContaining({
      p_additions: [ref("retry")],
      p_remove_file_ids: [],
    })));
    await waitFor(() => expect(screen.queryByAltText("Vista previa de reintentar.webp")).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith(preview.getAttribute("src"));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes pending reference preview URLs after save and when the modal unmounts", async () => {
    uploadOrderAsset.mockResolvedValue(ref("uploaded"));
    const { container, unmount } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const file = new File(["image"], "referencia-lateral.webp", { type: "image/webp", lastModified: 6 });
    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    fireEvent.change(uploadInput, { target: { files: [file] } });
    await screen.findByAltText("Vista previa de referencia-lateral.webp");

    fireEvent.click(screen.getByRole("button", { name: "Guardar imágenes" }));
    await waitFor(() => expect(screen.queryByAltText("Vista previa de referencia-lateral.webp")).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:designer-reference/referencia-lateral.webp");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    revokeObjectURL.mockClear();
    const secondFile = new File(["image"], "referencia-trasera.webp", { type: "image/webp", lastModified: 7 });
    fireEvent.change(uploadInput, { target: { files: [secondFile] } });
    await screen.findByAltText("Vista previa de referencia-trasera.webp");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:designer-reference/referencia-trasera.webp");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
