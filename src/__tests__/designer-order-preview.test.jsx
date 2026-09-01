import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDetailModal } from "../pages/page-designer.jsx";
import { ORDER_STATUS } from "../utils/constants";

const { resolveOrderAssetUrl } = vi.hoisted(() => ({ resolveOrderAssetUrl: vi.fn() }));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl,
  openOrderAssetUrl: vi.fn(),
  requiresOrderAssetGateway: () => false,
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
      })),
    })),
    rpc: vi.fn(),
  },
}));

const baseOrder = {
  id: "57aacf7a-0e05-4dd0-9f97-77911fd03bd9",
  created_at: "2026-08-29T10:00:00.000Z",
  updated_at: "2026-08-29T10:00:00.000Z",
  status: ORDER_STATUS.IN_DESIGN,
  client_name: "Cliente de prueba",
  client_contact: "8090000000",
  description: "Orden de prueba",
  material: "Vinilo",
  order_type: "normal",
  seller_name: "Vendedor de prueba",
  order_file_url: null,
};

const renderModal = (order) => render(
  <OrderDetailModal
    onClose={() => {}}
    order={order}
    designerFiles={[]}
    designerPreview={order.preview_image}
    onRefresh={() => Promise.resolve()}
    onSendToQuotation={() => {}}
    quotationSending={false}
  />
);

describe("Designer OrderDetailModal preview", () => {
  beforeEach(() => {
    resolveOrderAssetUrl.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a persisted Supabase preview using its resolved temporary URL", async () => {
    resolveOrderAssetUrl.mockResolvedValue("https://signed.example.com/orders/order-1/preview.webp");

    renderModal({
      ...baseOrder,
      preview_image: "supabase://order-previews/orders/57aacf7a-0e05-4dd0-9f97-77911fd03bd9/preview/preview.webp",
    });

    const preview = await screen.findByAltText("Preview");
    expect(preview).toHaveAttribute("src", "https://signed.example.com/orders/order-1/preview.webp");
    expect(resolveOrderAssetUrl).toHaveBeenCalledWith("supabase://order-previews/orders/57aacf7a-0e05-4dd0-9f97-77911fd03bd9/preview/preview.webp");
  });

  it("does not let a stale preview resolution overwrite the next order", async () => {
    let resolveFirst;
    let resolveSecond;
    resolveOrderAssetUrl
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { rerender } = renderModal({
      ...baseOrder,
      preview_image: "supabase://order-previews/orders/57aacf7a-0e05-4dd0-9f97-77911fd03bd9/preview/first.webp",
    });

    await waitFor(() => expect(resolveOrderAssetUrl).toHaveBeenCalledTimes(1));
    rerender(
      <OrderDetailModal
        onClose={() => {}}
        order={{
          ...baseOrder,
          id: "4566d1bf-5273-4cf5-a72e-8f902d4df4c0",
          preview_image: "supabase://order-previews/orders/4566d1bf-5273-4cf5-a72e-8f902d4df4c0/preview/second.webp",
        }}
        designerFiles={[]}
        designerPreview="supabase://order-previews/orders/4566d1bf-5273-4cf5-a72e-8f902d4df4c0/preview/second.webp"
        onRefresh={() => Promise.resolve()}
        onSendToQuotation={() => {}}
        quotationSending={false}
      />
    );

    await waitFor(() => expect(resolveOrderAssetUrl).toHaveBeenCalledTimes(2));
    resolveSecond("https://signed.example.com/orders/order-2/preview.webp");
    expect(await screen.findByAltText("Preview")).toHaveAttribute("src", "https://signed.example.com/orders/order-2/preview.webp");

    resolveFirst("https://signed.example.com/orders/order-1/preview.webp");
    await waitFor(() => expect(screen.getByAltText("Preview")).toHaveAttribute("src", "https://signed.example.com/orders/order-2/preview.webp"));
  });
});
