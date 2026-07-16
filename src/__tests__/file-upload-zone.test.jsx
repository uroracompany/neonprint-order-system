import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApiFetch } from "../utils/adminApi";
import FileUploadZone from "../components/ui/FileUploadZone";

vi.mock("../utils/adminApi", () => ({
  adminApiFetch: vi.fn(),
}));

const imageFile = (name = "preview.png") => new File(["img"], name, { type: "image/png" });

describe("FileUploadZone", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no abre el selector al hacer click en el contenedor dashed", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={vi.fn()} />);

    const zone = screen.getByRole("group", { name: "Subir imagen" });
    fireEvent.click(zone);

    expect(clickSpy).not.toHaveBeenCalled();
    expect(zone).toHaveFocus();
    expect(zone).toHaveClass("is-focused");
    clickSpy.mockRestore();
  });

  it("abre el selector solo con el boton interno", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Subir imagen" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("acepta archivo valido desde paste", () => {
    const onFilesAccepted = vi.fn();
    render(<FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={onFilesAccepted} />);

    fireEvent.paste(screen.getByRole("group", { name: "Subir imagen" }), {
      clipboardData: { files: [imageFile()] },
    });

    expect(onFilesAccepted).toHaveBeenCalledWith(
      [expect.any(File)],
      expect.objectContaining({ source: "paste", showError: expect.any(Function) })
    );
  });

  it("acepta archivo valido desde drag and drop", () => {
    const onFilesAccepted = vi.fn();
    render(<FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={onFilesAccepted} />);

    const zone = screen.getByRole("group", { name: "Subir imagen" });
    fireEvent.click(zone);
    fireEvent.dragOver(zone, {
      dataTransfer: { files: [imageFile()] },
    });

    expect(zone).toHaveFocus();
    expect(zone).toHaveClass("is-focused");
    expect(zone).toHaveClass("is-drag-over");

    fireEvent.drop(zone, {
      dataTransfer: { files: [imageFile()] },
    });

    expect(onFilesAccepted).toHaveBeenCalledWith(
      [expect.any(File)],
      expect.objectContaining({ source: "drop", showError: expect.any(Function) })
    );
    expect(zone).toHaveClass("is-focused");
    expect(zone).not.toHaveClass("is-drag-over");
  });

  it("drag leave retira drag-over pero mantiene foco activo", () => {
    render(<FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={vi.fn()} />);

    const zone = screen.getByRole("group", { name: "Subir imagen" });
    fireEvent.click(zone);
    fireEvent.dragOver(zone, {
      dataTransfer: { files: [imageFile()] },
    });
    expect(zone).toHaveClass("is-drag-over");

    fireEvent.dragLeave(zone, { relatedTarget: null });

    expect(zone).toHaveFocus();
    expect(zone).toHaveClass("is-focused");
    expect(zone).not.toHaveClass("is-drag-over");
  });

  it("acepta imagen arrastrada desde otra pestaña cuando el navegador entrega una URL", async () => {
    const onFilesAccepted = vi.fn();
    adminApiFetch.mockResolvedValue({
      response: { ok: true },
      result: {
        fileName: "imagen.png",
        contentType: "image/png",
        base64: btoa("img"),
      },
    });
    render(<FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={onFilesAccepted} />);

    fireEvent.drop(screen.getByRole("group", { name: "Subir imagen" }), {
      dataTransfer: {
        files: [],
        items: [],
        getData: (type) => (type === "text/uri-list" ? "https://example.com/imagen.png" : ""),
      },
    });

    await waitFor(() => {
      expect(onFilesAccepted).toHaveBeenCalledWith(
        [expect.any(File)],
        expect.objectContaining({ source: "drop", showError: expect.any(Function) })
      );
    });
    expect(onFilesAccepted.mock.calls[0][0][0].name).toBe("imagen.png");
    expect(adminApiFetch).toHaveBeenCalledWith("/api/files", {
      action: "import-url",
      url: "https://example.com/imagen.png",
      mode: "image",
    });
    adminApiFetch.mockReset();
  });

  it("muestra error si la imagen arrastrada desde otra pestaña no se puede importar", async () => {
    const onFilesAccepted = vi.fn();
    const onError = vi.fn();
    adminApiFetch.mockResolvedValue({
      response: { ok: false },
      result: { error: "No se pudo descargar la imagen remota." },
    });
    render(
      <FileUploadZone
        mode="image"
        buttonLabel="Subir imagen"
        onFilesAccepted={onFilesAccepted}
        onError={onError}
      />
    );

    fireEvent.drop(screen.getByRole("group", { name: "Subir imagen" }), {
      dataTransfer: {
        files: [],
        items: [],
        getData: (type) => (type === "text/uri-list" ? "https://example.com/bloqueada.png" : ""),
      },
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("No se pudo descargar"), { source: "drop" });
    });
    expect(onFilesAccepted).not.toHaveBeenCalled();
    adminApiFetch.mockReset();
  });

  it("rechaza archivo invalido y no cambia estado externo", () => {
    const onFilesAccepted = vi.fn();
    const onError = vi.fn();
    const { container } = render(
      <FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={onFilesAccepted} onError={onError} />
    );

    fireEvent.change(container.querySelector("input[type='file']"), {
      target: { files: [new File(["pdf"], "documento.pdf", { type: "application/pdf" })] },
    });

    expect(onFilesAccepted).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no es una imagen"), { source: "picker" });
  });

  it("muestra un unico error interno y lo oculta automaticamente despues de 10 segundos", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={vi.fn()} />
    );

    fireEvent.change(container.querySelector("input[type='file']"), {
      target: { files: [new File(["pdf"], "documento.pdf", { type: "application/pdf" })] },
    });

    expect(screen.getAllByText(/no es una imagen/i)).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(9999);
    });
    expect(screen.getByText(/no es una imagen/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(/no es una imagen/i)).not.toBeInTheDocument();
  });

  it("reinicia el temporizador cuando llega un nuevo error", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FileUploadZone mode="image" buttonLabel="Subir imagen" onFilesAccepted={vi.fn()} />
    );
    const input = container.querySelector("input[type='file']");

    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "documento.pdf", { type: "application/pdf" })] },
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.change(input, {
      target: { files: [new File(["txt"], "nota.txt", { type: "text/plain" })] },
    });
    act(() => {
      vi.advanceTimersByTime(9999);
    });

    expect(screen.getByText(/no es una imagen/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(/no es una imagen/i)).not.toBeInTheDocument();
  });

  it("permite mostrar errores posteriores desde onFilesAccepted dentro de la FileZone", () => {
    const { container } = render(
      <FileUploadZone
        mode="image"
        buttonLabel="Subir imagen"
        onFilesAccepted={(files, { showError }) => {
          expect(files).toHaveLength(1);
          showError("Error posterior de validacion");
        }}
      />
    );

    fireEvent.change(container.querySelector("input[type='file']"), {
      target: { files: [imageFile()] },
    });

    expect(screen.getAllByText("Error posterior de validacion")).toHaveLength(1);
  });

  it("muestra externalError dentro de la FileZone y lo oculta despues de 10 segundos", () => {
    vi.useFakeTimers();
    render(
      <FileUploadZone
        mode="image"
        buttonLabel="Subir imagen"
        onFilesAccepted={vi.fn()}
        externalError="Error de subida"
        externalErrorKey={1}
      />
    );

    expect(screen.getAllByText("Error de subida")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText("Error de subida")).not.toBeInTheDocument();
  });

  it("externalErrorKey permite mostrar nuevamente el mismo mensaje", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <FileUploadZone
        mode="image"
        buttonLabel="Subir imagen"
        onFilesAccepted={vi.fn()}
        externalError="Error repetido"
        externalErrorKey={1}
      />
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText("Error repetido")).not.toBeInTheDocument();

    rerender(
      <FileUploadZone
        mode="image"
        buttonLabel="Subir imagen"
        onFilesAccepted={vi.fn()}
        externalError="Error repetido"
        externalErrorKey={2}
      />
    );

    expect(screen.getAllByText("Error repetido")).toHaveLength(1);
  });

  it("un picker oculto revela solo el error interno cuando recibe externalError", () => {
    render(
      <FileUploadZone
        mode="image"
        className="file-upload-zone--hidden-picker"
        buttonLabel="Cambiar recibo"
        onFilesAccepted={vi.fn()}
        externalError="No se pudo subir"
        externalErrorKey={1}
      />
    );

    const zone = screen.getByRole("group", { name: "Cambiar recibo" });
    expect(zone).toHaveClass("is-error");
    expect(screen.getAllByText("No se pudo subir")).toHaveLength(1);
  });

  it("replaceMode reemplaza la preview", () => {
    function PreviewHarness() {
      const [fileName, setFileName] = useState("actual.png");
      return (
        <>
          <span data-testid="preview-name">{fileName}</span>
          <FileUploadZone
            mode="image"
            replaceMode
            buttonLabel="Cambiar imagen"
            onFilesAccepted={([file]) => setFileName(file.name)}
          />
        </>
      );
    }

    const { container } = render(<PreviewHarness />);
    fireEvent.change(container.querySelector("input[type='file']"), {
      target: { files: [imageFile("nueva.png")] },
    });

    expect(screen.getByTestId("preview-name")).toHaveTextContent("nueva.png");
  });

  it("expone la experiencia estandar con boton Seleccionar desde el ordenador", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(
      <FileUploadZone
        mode="image"
        replaceMode
        buttonLabel="Seleccionar desde el ordenador"
        hint="PNG, JPG, JPEG, WebP, GIF, HEIC o HEIF. Max. 10 MB"
        onFilesAccepted={vi.fn()}
      />
    );

    const zone = screen.getByRole("group", { name: "Seleccionar desde el ordenador" });
    const button = screen.getByRole("button", { name: "Seleccionar desde el ordenador" });

    expect(zone).toHaveClass("file-upload-zone--standard");
    expect(zone).not.toHaveClass("file-upload-zone--compact");
    expect(screen.getByText(/Max\. 10 MB/i)).toBeInTheDocument();

    fireEvent.click(zone);
    expect(zone).toHaveFocus();
    expect(zone).toHaveClass("is-focused");
    expect(clickSpy).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("expone variante compacta para recibos sin convertir todo el contenedor en boton", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(
      <FileUploadZone
        mode="image"
        variant="compact"
        buttonLabel="Subir imagen del recibo"
        onFilesAccepted={vi.fn()}
      />
    );

    const zone = screen.getByRole("group", { name: "Subir imagen del recibo" });
    expect(zone).toHaveClass("file-upload-zone--compact");
    expect(screen.getByRole("button", { name: "Subir imagen del recibo" }).querySelector("svg")).toBeTruthy();

    fireEvent.click(zone);
    expect(clickSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Subir imagen del recibo" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
