import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDetailModal } from "../pages/page-designer.jsx";
import { ORDER_STATUS } from "../utils/constants";

const { rpc, resolveOrderAssetUrl, uploadOrderAsset } = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveOrderAssetUrl: vi.fn(),
  uploadOrderAsset: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null })) })) })) })),
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
    uploadOrderAsset.mockReset();
    resolveOrderAssetUrl.mockReset();
    resolveOrderAssetUrl.mockImplementation(async (assetRef) => `https://signed.example.test/${assetRef.split("/").pop()}`);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resolves private preview and references before rendering images", async () => {
    renderModal({ ...baseOrder, preview_image: `supabase://order-previews/orders/${orderId}/preview/work.webp` });

    expect(screen.getAllByText("Cargando imagen...").length).toBeGreaterThan(0);
    const referenceImage = await screen.findByAltText("Ref 1");
    const previewImage = await screen.findByAltText("Preview");
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

  it("accumulates distinct file selections within the remaining shared capacity", async () => {
    const { container } = renderModal({
      ...baseOrder,
      reference_images: [ref("seller")],
      order_files: [baseOrder.order_files[0]],
    });
    const uploadInput = container.querySelector(".pd-reference-upload input[type=file]");
    fireEvent.change(uploadInput, { target: { files: [new File(["one"], "one.webp", { type: "image/webp", lastModified: 1 })] } });
    await screen.findByText("1 imagen pendiente");
    fireEvent.change(uploadInput, { target: { files: [new File(["two"], "two.webp", { type: "image/webp", lastModified: 2 })] } });
    expect(await screen.findByText("2 imagenes pendientes")).toBeInTheDocument();
    expect(screen.getByText("Guardar imágenes")).toBeInTheDocument();
    expect(screen.queryByText("Agregar imágenes de referencia")).not.toBeInTheDocument();
  });
});
