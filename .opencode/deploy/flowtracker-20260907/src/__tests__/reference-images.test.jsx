import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  getOrderFiles,
  getReferenceImages,
  hasAnyOrderAsset,
  serializeReferenceImages,
} from "../utils/orderAssets";
import { OrderDetailModal } from "../pages/pages-seller.jsx";

const { resolveOrderAssetUrl } = vi.hoisted(() => ({
  resolveOrderAssetUrl: vi.fn(),
}));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl,
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

const baseOrder = {
  id: "12345678-1234-1234-1234-123456789abc",
  created_at: "2026-06-03T10:00:00.000Z",
  status: "Pending",
  payment_status: "Pending_Payment",
  client_name: "Cliente Demo",
  description: "Orden demo",
  material: "Vinilo",
  order_type: "normal",
  order_design_type: "INTERNAL_DESING",
};

describe("orderAssets reference_images", () => {
  it("normaliza valores vacios", () => {
    expect(getReferenceImages({ reference_images: null })).toEqual([]);
    expect(getReferenceImages({ reference_images: undefined })).toEqual([]);
    expect(getReferenceImages({ reference_images: "" })).toEqual([]);
  });

  it("normaliza JSONB array de URLs", () => {
    const refs = ["https://example.com/ref1.jpg", "https://example.com/ref2.png"];
    expect(getReferenceImages({ reference_images: refs })).toEqual(refs);
  });

  it("normaliza JSON string legado", () => {
    const refs = ["https://example.com/ref1.jpg", "https://example.com/ref2.png"];
    expect(getReferenceImages({ reference_images: JSON.stringify(refs) })).toEqual(refs);
  });

  it("normaliza URL directa y objeto con url", () => {
    expect(getReferenceImages({ reference_images: "https://example.com/ref.jpg" })).toEqual(["https://example.com/ref.jpg"]);
    expect(getReferenceImages({ reference_images: { url: "https://example.com/ref.jpg" } })).toEqual(["https://example.com/ref.jpg"]);
  });

  it("mantiene archivos de diseno separados de imagenes de referencia", () => {
    const order = {
      order_file_url: JSON.stringify(["https://example.com/design.pdf"]),
      reference_images: ["https://example.com/ref.jpg"],
    };

    expect(getOrderFiles(order)).toEqual(["https://example.com/design.pdf"]);
    expect(getReferenceImages(order)).toEqual(["https://example.com/ref.jpg"]);
    expect(serializeReferenceImages(order.reference_images)).toEqual(["https://example.com/ref.jpg"]);
  });
});

describe("Seller OrderDetailModal reference_images", () => {
  beforeEach(() => {
    resolveOrderAssetUrl.mockReset();
    resolveOrderAssetUrl.mockImplementation(async (url) => url);
  });

  it("muestra imagenes de referencia aunque no haya preview ni archivos principales", () => {
    render(
      <OrderDetailModal
        open
        onClose={() => {}}
        order={{ ...baseOrder, reference_images: ["https://example.com/ref.jpg"] }}
      />
    );

    expect(screen.getByText("Archivos Adjuntos")).toBeInTheDocument();
    expect(screen.getByText("Imágenes de referencia")).toBeInTheDocument();
  });

  it("no muestra seccion de adjuntos si no hay assets", () => {
    render(<OrderDetailModal open onClose={() => {}} order={baseOrder} />);

    expect(hasAnyOrderAsset(baseOrder)).toBe(false);
    expect(screen.queryByText("Archivos Adjuntos")).not.toBeInTheDocument();
  });

  it("muestra preview, archivos principales y referencias cuando existen", () => {
    render(
      <OrderDetailModal
        open
        onClose={() => {}}
        order={{
          ...baseOrder,
          preview_image: "https://example.com/preview.jpg",
          order_file_url: JSON.stringify(["https://example.com/design.pdf"]),
          reference_images: ["https://example.com/ref.jpg"],
        }}
      />
    );

    expect(screen.getByText("Orden de Trabajo")).toBeInTheDocument();
    expect(screen.getByText("Diseño del cliente")).toBeInTheDocument();
    expect(screen.getByText("Imágenes de referencia")).toBeInTheDocument();
  });

  it("resuelve una imagen de referencia privada antes de mostrarla", async () => {
    const privateReference = "supabase://order-docs/orders/12345678-1234-1234-1234-123456789abc/ref-images/ref.webp";
    const signedReference = "https://signed.example.com/orders/order-1/ref.webp";
    resolveOrderAssetUrl.mockResolvedValue(signedReference);

    render(
      <OrderDetailModal
        open
        onClose={() => {}}
        order={{ ...baseOrder, reference_images: [privateReference] }}
      />
    );

    const image = await screen.findByAltText("Ref 1");
    expect(image).toHaveAttribute("src", signedReference);
    expect(image.closest("a")).toHaveAttribute("href", signedReference);
    expect(image).not.toHaveAttribute("src", privateReference);
    expect(resolveOrderAssetUrl).toHaveBeenCalledWith(privateReference);
  });

  it("resuelve de nuevo al cambiar de orden e ignora una respuesta tardia", async () => {
    const firstReference = "supabase://order-docs/orders/order-1/ref-images/first.webp";
    const secondReference = "supabase://order-docs/orders/order-2/ref-images/second.webp";
    let resolveFirstReference;

    resolveOrderAssetUrl.mockImplementation((url) => {
      if (url === firstReference) {
        return new Promise((resolve) => {
          resolveFirstReference = resolve;
        });
      }
      return Promise.resolve("https://signed.example.com/orders/order-2/second.webp");
    });

    const { rerender } = render(
      <OrderDetailModal
        open
        onClose={() => {}}
        order={{ ...baseOrder, id: "order-1", reference_images: [firstReference] }}
      />
    );

    rerender(
      <OrderDetailModal
        open
        onClose={() => {}}
        order={{ ...baseOrder, id: "order-2", reference_images: [secondReference] }}
      />
    );

    const image = await screen.findByAltText("Ref 1");
    expect(image).toHaveAttribute("src", "https://signed.example.com/orders/order-2/second.webp");

    resolveFirstReference("https://signed.example.com/orders/order-1/first.webp");
    await waitFor(() => {
      expect(screen.getByAltText("Ref 1")).toHaveAttribute("src", "https://signed.example.com/orders/order-2/second.webp");
    });
  });

  it("resuelve el preview privado mediante el mismo gateway", async () => {
    const privatePreview = "supabase://order-previews/orders/12345678-1234-1234-1234-123456789abc/preview/preview.webp";
    const signedPreview = "https://signed.example.com/orders/order-1/preview.webp";
    resolveOrderAssetUrl.mockResolvedValue(signedPreview);

    render(
      <OrderDetailModal
        open
        onClose={() => {}}
        order={{ ...baseOrder, preview_image: privatePreview }}
      />
    );

    const image = await screen.findByAltText("preview");
    expect(image).toHaveAttribute("src", signedPreview);
    expect(resolveOrderAssetUrl).toHaveBeenCalledWith(privatePreview);
  });
});
