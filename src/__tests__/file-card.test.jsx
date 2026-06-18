import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileCard from "../components/FileCard";

describe("FileCard", () => {
  afterEach(() => {
    cleanup();
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
});
