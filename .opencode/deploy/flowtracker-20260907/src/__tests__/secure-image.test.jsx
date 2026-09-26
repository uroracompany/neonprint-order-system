import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useSecureFileUrl } = vi.hoisted(() => ({ useSecureFileUrl: vi.fn() }));

vi.mock("../hooks/useSecureFileUrl", () => ({
  useSecureFileUrl,
  resolveBatchSecureUrls: vi.fn(),
  getSecureUrlRefreshDelay: () => 570_000,
}));

import { SecureImageLink } from "../components/ui/SecureImage";

describe("SecureImageLink", () => {
  it("renders a real loading indicator instead of an undefined icon", () => {
    useSecureFileUrl.mockReturnValue({ loading: true, resolvedUrl: null, error: null, openInNewTab: vi.fn() });

    render(<SecureImageLink url="supabase://order-previews/orders/order-1/preview/a.webp">Abrir</SecureImageLink>);

    const loadingMessage = screen.getByText("Cargando...");
    expect(loadingMessage).toBeInTheDocument();
    expect(loadingMessage.parentElement?.tagName).toBe("SPAN");
  });

  it("passes only the resolved signed URL to render-prop previews", () => {
    const signedUrl = "https://signed.example.com/preview.webp";
    useSecureFileUrl.mockReturnValue({ loading: false, resolvedUrl: signedUrl, error: null, openInNewTab: vi.fn() });

    render(
      <SecureImageLink url="supabase://order-previews/orders/order-1/preview/a.webp">
        {(resolvedUrl) => <img src={resolvedUrl} alt="Vista segura" />}
      </SecureImageLink>,
    );

    expect(screen.getByAltText("Vista segura")).toHaveAttribute("src", signedUrl);
    expect(screen.getByRole("link")).toHaveAttribute("href", signedUrl);
  });
});
