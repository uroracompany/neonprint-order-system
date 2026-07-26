import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
    enroll: vi.fn(),
    challengeAndVerify: vi.fn(),
  },
}));

const fromMock = vi.hoisted(() => vi.fn());
const signOutAuthMock = vi.hoisted(() => vi.fn(async () => undefined));
const setAuthSessionPersistenceMock = vi.hoisted(() => vi.fn());

vi.mock("../../supabaseClient", () => ({
  supabase: {
    auth: authMock,
    from: fromMock,
  },
}));

vi.mock("../utils/authManager", () => ({
  isAuthSessionPersistenceEnabled: vi.fn(() => false),
  setAuthSessionPersistence: setAuthSessionPersistenceMock,
  signOutAuth: signOutAuthMock,
}));

const mockProfile = (profile = { role: "delivery", employment_status: true }) => {
  fromMock.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({ data: profile, error: null })),
      })),
    })),
  });
};

const renderLobby = () => render(
  <MemoryRouter>
    <Lobby />
  </MemoryRouter>
);

let Lobby;

beforeEach(async () => {
  vi.clearAllMocks();
  mockProfile();
  authMock.signInWithPassword.mockResolvedValue({
    data: { user: { id: "delivery-user" } },
    error: null,
  });
  authMock.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  authMock.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: "aal1" },
    error: null,
  });
  authMock.mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  authMock.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  ({ default: Lobby } = await import("../pages/lobby.jsx"));
});

describe("secure login", () => {
  it("keeps the original visible login surface without new UX controls", () => {
    renderLobby();

    expect(screen.getByText(/gestiona cada/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acceder al sistema/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /olvide mi contrasena/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/recordar sesion/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mostrar contrasena/i })).not.toBeInTheDocument();
  });

  it("sends the password exactly as typed and normalizes only the email", async () => {
    const user = userEvent.setup();
    renderLobby();

    await user.type(screen.getByLabelText("Correo electrónico"), " Delivery@Example.com ");
    await user.type(screen.getByLabelText("Contraseña"), " SecurePass123 ");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    await waitFor(() => {
      expect(authMock.signInWithPassword).toHaveBeenCalledWith({
        email: "Delivery@Example.com",
        password: " SecurePass123 ",
        options: undefined,
      });
    });
    expect(setAuthSessionPersistenceMock).toHaveBeenCalledWith(false);
  });

  it("uses a generic error message for failed login attempts", async () => {
    authMock.signInWithPassword.mockResolvedValue({
      data: null,
      error: { status: 404, message: "User not found" },
    });

    const user = userEvent.setup();
    renderLobby();

    await user.type(screen.getByLabelText("Correo electrónico"), "missing@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "WrongPassword123");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByText(/credenciales invalidas o acceso no disponible/i)).toBeInTheDocument();
    expect(screen.queryByText(/cuenta no encontrada|user not found/i)).not.toBeInTheDocument();
    expect(signOutAuthMock).toHaveBeenCalled();
  });

  it("requires MFA verification for admin profiles", async () => {
    mockProfile({ role: "admin", employment_status: true });
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-user" } },
      error: null,
    });
    authMock.mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
      error: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("123456");

    const user = userEvent.setup();
    renderLobby();

    await user.type(screen.getByLabelText("Correo electrónico"), "admin@example.com");
    await user.type(screen.getByLabelText("Contraseña"), " SecurePass123 ");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    await waitFor(() => {
      expect(authMock.mfa.challengeAndVerify).toHaveBeenCalledWith({
        factorId: "factor-1",
        code: "123456",
      });
    });
  });

  it("allows admin login when no verified MFA factor is enrolled", async () => {
    mockProfile({ role: "admin", employment_status: true });
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-user" } },
      error: null,
    });
    authMock.mfa.listFactors.mockResolvedValue({
      data: { totp: [] },
      error: null,
    });

    const user = userEvent.setup();
    renderLobby();

    await user.type(screen.getByRole("textbox", { name: /correo/i }), "admin@example.com");
    await user.type(screen.getByLabelText(/contrase/i), " SecurePass123 ");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    await waitFor(() => {
      expect(authMock.mfa.challengeAndVerify).not.toHaveBeenCalled();
      expect(screen.getByText(/acceso concedido/i)).toBeInTheDocument();
    });
  });
});
