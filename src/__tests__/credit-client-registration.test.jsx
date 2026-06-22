/* global process */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateClientModal from "../components/ui/CreateClientModal";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const getCssRuleBody = (css, selector) => {
  const match = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
};

const getZIndex = (css, selector) => {
  const body = getCssRuleBody(css, selector);
  const match = body.match(/z-index:\s*(\d+)/);
  return match ? Number(match[1]) : null;
};

describe("registro de cliente desde credito en cotizacion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra la accion inline sin abrir automaticamente el modal de cliente", () => {
    const source = readProjectFile("src/pages/page-quote.jsx");

    expect(source).toContain("const [creditClientRequired, setCreditClientRequired] = useState(false)");
    expect(source).toContain("setCreditClientRequired(true)");
    expect(source).toContain("Para crear una orden a crédito, el cliente debe estar registrado.");
    expect(source).toContain('Registrar Cliente {order.client_name || "sin nombre"}');
    expect(source).toContain("onClick={() => onCreditClientRequired?.(order)}");
    expect(source).not.toContain("onCreditClientRequired?.(order);\n      if (onValidationError)");
  });

  it("vincula el cliente creado sin aprobar credito automaticamente", () => {
    const source = readProjectFile("src/pages/page-quote.jsx");

    expect(source).toContain("setOrders(prev => prev.map(item => item.id === linkedOrder.id ? linkedOrder : item))");
    expect(source).toContain("setSelectedOrder(linkedOrder)");
    expect(source).not.toContain("await applyCreditToOrder(linkedOrder)");
  });

  it("no contamina notas del cliente ni llama la rpc de credito sin cliente", () => {
    const source = readProjectFile("src/pages/page-quote.jsx");
    const applyCreditStart = source.indexOf("const applyCreditToOrder = async (order) => {");
    const creditRpc = source.indexOf('rpc("mark_order_as_credit"', applyCreditStart);
    const clientGuard = source.indexOf("if (!order?.client_id)", applyCreditStart);

    expect(source).toContain('notes: ""');
    expect(source).not.toContain("notes: order?.description");
    expect(clientGuard).toBeGreaterThan(applyCreditStart);
    expect(creditRpc).toBeGreaterThan(clientGuard);
  });

  it("muestra el modal de cliente por encima del detalle de orden sin tapar toasts globales", () => {
    const clientModalCss = readProjectFile("src/components/ui/CreateClientModal.css");
    const quoteCss = readProjectFile("src/css-components/page-quote.css");
    const notificationsCss = readProjectFile("src/components/NotificationCenter.css");

    const clientModalZIndex = getZIndex(clientModalCss, ".crm-overlay");
    const quoteModalZIndex = getZIndex(quoteCss, ".pq-overlay");
    const toastZIndex = getZIndex(notificationsCss, ".nc-toast-stack");

    expect(clientModalZIndex).toBe(1500);
    expect(quoteModalZIndex).toBe(1200);
    expect(clientModalZIndex).toBeGreaterThan(quoteModalZIndex);
    expect(clientModalZIndex).toBeLessThan(toastZIndex);
  });

  it("reutiliza un cliente existente por telefono en vez de crear duplicado", async () => {
    const existingClient = {
      id: "client-1",
      name: "Cliente Existente",
      phone: "809-555-1234",
    };
    const searchBuilder = {
      select: vi.fn(() => searchBuilder),
      order: vi.fn(() => searchBuilder),
      limit: vi.fn(() => searchBuilder),
      or: vi.fn(async () => ({ data: [existingClient], error: null })),
      insert: vi.fn(),
    };
    const supabase = {
      from: vi.fn(() => searchBuilder),
    };
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateClientModal
        open
        onClose={onClose}
        onCreated={onCreated}
        supabase={supabase}
        userId="user-1"
        initialValues={{ name: "Cliente Existente", phone: "8095551234" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar cliente" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(existingClient, { reusedExisting: true });
    });
    expect(searchBuilder.insert).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
