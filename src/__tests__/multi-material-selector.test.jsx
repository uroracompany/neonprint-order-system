import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultiMaterialSelector } from "../pages/pages-seller";

describe("MultiMaterialSelector", () => {
  const defaultOptions = ["Vinilo", "Banner", "Lona", "PVC", "Acrilico"];

  it("renderiza el placeholder cuando no hay seleccion", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={defaultOptions} />);
    expect(screen.getByText("Seleccionar materiales...")).toBeInTheDocument();
  });

  it("abre el dropdown al hacer clic", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    expect(screen.getByText("Vinilo")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
  });

  it("muestra los materiales seleccionados como chips", () => {
    render(<MultiMaterialSelector selected={["Vinilo", "Banner"]} onChange={() => {}} options={defaultOptions} />);
    expect(screen.getByText("Vinilo")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
  });

  it("llama a onChange al seleccionar un material", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Vinilo"));
    expect(onChange).toHaveBeenCalledWith(["Vinilo"]);
  });

  it("llama a onChange al remover un material seleccionado", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={["Vinilo", "Banner"]} onChange={onChange} options={defaultOptions} />);
    const removeButtons = screen.getAllByRole("button");
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(["Banner"]);
  });

  it("muestra la opcion de agregar material personalizado", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    expect(screen.getByText("Agregar material personalizado")).toBeInTheDocument();
  });

  it("permite agregar un material personalizado", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Agregar material personalizado"));
    const input = screen.getByPlaceholderText("Escribe el nombre del material...");
    fireEvent.change(input, { target: { value: "Acetato" } });
    fireEvent.click(screen.getByText("Agregar"));
    expect(onChange).toHaveBeenCalledWith(["Acetato"]);
  });

  it("no agrega un material personalizado vacio", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Agregar material personalizado"));
    const btn = screen.getByText("Agregar");
    expect(btn).toBeDisabled();
  });

  it("agrega material personalizado con Enter", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Agregar material personalizado"));
    const input = screen.getByPlaceholderText("Escribe el nombre del material...");
    fireEvent.change(input, { target: { value: "Tela Metallica" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Tela Metallica"]);
  });

  it("asigna clase custom a chips de materiales personalizados", () => {
    render(<MultiMaterialSelector selected={["Acetato"]} onChange={() => {}} options={defaultOptions} />);
    const chip = screen.getByText("Acetato").closest(".ps-chip");
    expect(chip).toHaveClass("ps-chip--custom");
  });

  it("no asigna clase custom a chips de materiales existentes", () => {
    render(<MultiMaterialSelector selected={["Vinilo"]} onChange={() => {}} options={defaultOptions} />);
    const chip = screen.getByText("Vinilo").closest(".ps-chip");
    expect(chip).not.toHaveClass("ps-chip--custom");
  });
});
