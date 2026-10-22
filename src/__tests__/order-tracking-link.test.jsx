import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { supabase } from "../../supabaseClient";
import OrderTrackingLink from "../components/orders/OrderTrackingLink";
import { buildOrderTrackingUrl, PUBLIC_TRACKING_ORIGIN } from "../utils/orderTrackingUrl";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../supabaseClient", () => ({ supabase: { from } }));

describe("buildOrderTrackingUrl", () => {
  it("uses the canonical HTTPS origin and safely encodes the token as one path segment", () => {
    expect(buildOrderTrackingUrl("public/token value")).toBe(
      `${PUBLIC_TRACKING_ORIGIN}/track/public%2Ftoken%20value`,
    );
  });

  it("returns no URL when a token is missing", () => {
    expect(buildOrderTrackingUrl(null)).toBeNull();
    expect(buildOrderTrackingUrl(undefined)).toBeNull();
    expect(buildOrderTrackingUrl("")).toBeNull();
  });
});

describe("OrderTrackingLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an authenticated order token and copies the customer link", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { tracking_token: "public-token" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<OrderTrackingLink orderId="order-1" />);
    const input = await screen.findByLabelText("Enlace de seguimiento para el cliente");
    expect(input).toHaveValue(`${PUBLIC_TRACKING_ORIGIN}/track/public-token`);
    expect(supabase.from).toHaveBeenCalledWith("orders");
    expect(select).toHaveBeenCalledWith("tracking_token");

    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(input.value));
    expect(await screen.findByRole("button", { name: "✓ Copiado" })).toBeInTheDocument();
  });

  it("shows an unavailable state if the order has no tracking token", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) });

    render(<OrderTrackingLink orderId="order-without-token" />);
    expect(await screen.findByText("El enlace estará disponible cuando la orden tenga un token de seguimiento.")).toBeInTheDocument();
  });

  it("uses the supplied token without an additional order read", async () => {
    render(<OrderTrackingLink orderId="order-2" trackingToken="provided-token" />);
    expect(screen.getByLabelText("Enlace de seguimiento para el cliente")).toHaveValue(
      `${PUBLIC_TRACKING_ORIGIN}/track/provided-token`,
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not render the previous order token while the next order token loads", async () => {
    let resolveOrderB;
    const maybeSingle = vi.fn(() => new Promise((resolve) => { resolveOrderB = resolve; }));
    from.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    });
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { rerender } = render(<OrderTrackingLink orderId="order-A" trackingToken="token-A" />);

    expect(screen.getByLabelText("Enlace de seguimiento para el cliente")).toHaveValue(
      `${PUBLIC_TRACKING_ORIGIN}/track/token-A`,
    );
    rerender(<OrderTrackingLink orderId="order-B" />);

    expect(screen.queryByLabelText("Enlace de seguimiento para el cliente")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar enlace" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando enlace de seguimiento");
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => resolveOrderB({ data: { tracking_token: "token-B" }, error: null }));
    expect(screen.getByLabelText("Enlace de seguimiento para el cliente")).toHaveValue(
      `${PUBLIC_TRACKING_ORIGIN}/track/token-B`,
    );
    expect(screen.getByLabelText("Enlace de seguimiento para el cliente")).not.toHaveValue(
      `${PUBLIC_TRACKING_ORIGIN}/track/token-A`,
    );
  });

  it("falls back to document copy when the clipboard API rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    render(<OrderTrackingLink orderId="order-3" trackingToken="fallback-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(await screen.findByRole("button", { name: "✓ Copiado" })).toBeInTheDocument();
  });
});

describe("AdminTrackingLinkField wiring", () => {
  it("uses the same canonical tracking URL builder as order details", () => {
    const dashboardSource = readFileSync("src/pages/dashboard.jsx", "utf8");

    expect(dashboardSource).toContain('import { buildOrderTrackingUrl } from "../utils/orderTrackingUrl";');
    expect(dashboardSource).toMatch(/function AdminTrackingLinkField\([\s\S]*?const trackingUrl = buildOrderTrackingUrl\(token\);/);
  });
});
