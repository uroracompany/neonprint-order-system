import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import FileCard from "../components/FileCard";

function NewFileCardHarness() {
  const [needsDetails, setNeedsDetails] = useState(true);

  return (
    <FileCard
      name="diseño.pdf"
      actions={[{
        title: "Ver detalles de diseño.pdf",
        label: "Detalles",
        attention: needsDetails,
        onClick: () => setNeedsDetails(false),
      }]}
    />
  );
}

describe("FileCard details attention", () => {
  it("highlights pending details and clears the highlight after opening them", async () => {
    const user = userEvent.setup();
    render(<NewFileCardHarness />);

    const detailsButton = screen.getByRole("button", { name: "Detalles" });
    expect(detailsButton).toHaveClass("fc-file-action-attention");
    expect(detailsButton).toHaveAttribute("data-details-pending", "true");

    await user.click(detailsButton);

    expect(detailsButton).not.toHaveClass("fc-file-action-attention");
    expect(detailsButton).not.toHaveAttribute("data-details-pending");
  });

  it("does not add the attention state to ordinary file actions", () => {
    render(
      <FileCard
        name="archivo-existente.pdf"
        actions={[{ label: "Detalles", title: "Ver detalles" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Detalles" })).not.toHaveClass("fc-file-action-attention");
  });
});

