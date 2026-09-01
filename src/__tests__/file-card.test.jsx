import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileCard from "../components/FileCard";

const { openOrderAssetUrl } = vi.hoisted(() => ({ openOrderAssetUrl: vi.fn() }));

vi.mock("../utils/fileAccess", () => ({
  openOrderAssetUrl,
  requiresOrderAssetGateway: (url) => /^(?:r2|supabase):\/\//.test(url || "") || /\/storage\/v1\/object\//.test(url || ""),
}));

describe("FileCard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    openOrderAssetUrl.mockReset();
  });

  it("renders the file header without an extra metadata body by default", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <FileCard
        name="arte-final.pdf"
        secondaryText="2.4 MB"
        onRemove={onRemove}
      />
    );

    expect(screen.getByText("arte-final.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.4 MB")).toBeInTheDocument();
    expect(container.querySelector(".fc-file-main")).toBeInTheDocument();
    expect(container.querySelector(".fc-file-actions")).toBeInTheDocument();
    expect(container.querySelector(".fc-file-extra")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Eliminar"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders a compact tracking summary and a caller-provided remove icon", () => {
    render(
      <FileCard
        name="banner.pdf"
        secondaryText="1.2 MB"
        detailText="Seguimiento: Banner principal"
        removeIcon={<span data-testid="trash-icon">papelera</span>}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("Seguimiento: Banner principal")).toBeInTheDocument();
    expect(screen.getByTestId("trash-icon")).toBeInTheDocument();
  });

  it("renders editable metadata below the main file row when children are provided", () => {
    const { container } = render(
      <FileCard name="banner.pdf" secondaryText="1.1 MB">
        <div className="production-file-meta">
          <label className="production-file-field">
            <span className="production-file-field-label">Nombre visible en seguimiento</span>
            <input aria-label="Nombre visible en seguimiento de banner.pdf" />
          </label>
          <label className="production-file-field">
            <span className="production-file-field-label">Area de produccion</span>
            <select aria-label="Area de produccion de banner.pdf" />
          </label>
        </div>
      </FileCard>
    );

    const item = container.querySelector(".fc-file-item");
    const main = container.querySelector(".fc-file-main");
    const extra = container.querySelector(".fc-file-extra");

    expect(item).toHaveClass("fc-file-item-with-extra");
    expect(main).toBeInTheDocument();
    expect(extra).toBeInTheDocument();
    expect(item.children[0]).toBe(main);
    expect(item.children[1]).toBe(extra);
    expect(screen.getByLabelText("Nombre visible en seguimiento de banner.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Area de produccion de banner.pdf")).toBeInTheDocument();
  });

  it("uses the protected resolver for a Supabase asset reference", async () => {
    openOrderAssetUrl.mockResolvedValue(undefined);
    render(<FileCard name="arte-final.pdf" url="supabase://order-docs/orders/order-1/files/arte-final.pdf" />);

    const download = screen.getByTitle("Descargar");
    fireEvent.click(download);

    await waitFor(() => expect(openOrderAssetUrl).toHaveBeenCalledWith({
      url: "supabase://order-docs/orders/order-1/files/arte-final.pdf",
      fileName: "arte-final.pdf",
      download: true,
    }));
    expect(download).toHaveAttribute("href", "supabase://order-docs/orders/order-1/files/arte-final.pdf");
  });

  it("keeps an external URL as a normal link", () => {
    render(<FileCard name="referencia.pdf" url="https://example.com/referencia.pdf" />);

    expect(screen.getByTitle("Descargar")).toHaveAttribute("href", "https://example.com/referencia.pdf");
  });

  it("shows a recoverable error after a protected download fails", async () => {
    openOrderAssetUrl.mockRejectedValue(new Error("No autorizado para descargar este archivo."));
    render(<FileCard name="arte-final.pdf" url="r2://order-docs/orders/order-1/files/arte-final.pdf" />);

    fireEvent.click(screen.getByTitle("Descargar"));

    expect(await screen.findByRole("alert")).toHaveTextContent("No autorizado para descargar este archivo.");
    await waitFor(() => expect(screen.getByTitle("Descargar")).not.toHaveAttribute("aria-disabled"));
  });

  it("shows progress and prevents duplicate protected download clicks", async () => {
    let finishDownload;
    openOrderAssetUrl.mockImplementation(() => new Promise((resolve) => {
      finishDownload = resolve;
    }));
    const { container } = render(<FileCard name="arte-final.pdf" url="supabase://order-docs/orders/order-1/files/arte-final.pdf" />);

    const download = screen.getByTitle("Descargar");
    fireEvent.click(download);

    expect(await screen.findByRole("status")).toHaveTextContent("Preparando descarga…");
    expect(container.querySelector(".fc-file-item")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(download);
    expect(openOrderAssetUrl).toHaveBeenCalledTimes(1);

    finishDownload();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
