import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const isAuthSessionPersistenceEnabledMock = vi.hoisted(() => vi.fn(() => false));
const authContextMock = vi.hoisted(() => ({ user: null, profile: undefined }));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    auth: authMock,
    from: fromMock,
  },
}));

vi.mock("../utils/authManager", () => ({
  isAuthSessionPersistenceEnabled: isAuthSessionPersistenceEnabledMock,
  setAuthSessionPersistence: setAuthSessionPersistenceMock,
  signOutAuth: signOutAuthMock,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => authContextMock,
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

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  vi.clearAllMocks();
  authContextMock.user = null;
  authContextMock.profile = undefined;
  isAuthSessionPersistenceEnabledMock.mockReturnValue(false);
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
  it("starts every login entry empty and disables browser credential autofill", () => {
    renderLobby();

    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    const form = screen.getByRole("button", { name: /acceder al sistema/i }).closest("form");

    expect(email).toHaveValue("");
    expect(password).toHaveValue("");
    expect(form).toHaveAttribute("autocomplete", "off");
    expect(email).toHaveAttribute("autocomplete", "off");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(email).toHaveAttribute("name", "np-login-identifier");
    expect(password).toHaveAttribute("name", "np-login-secret");
    expect(email).toHaveAttribute("readonly");
    expect(password).toHaveAttribute("readonly");
  });

  it("clears a native autofill value when the user starts interacting", async () => {
    const user = userEvent.setup();
    renderLobby();

    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    email.value = "otro-usuario@empresa.com";
    password.value = "credencial-ajena";

    fireEvent.focus(email);
    fireEvent.focus(password);

    expect(email).toHaveValue("");
    expect(password).toHaveValue("");

    await user.type(email, "propio@empresa.com");
    await user.type(password, "MiClaveSegura");
    expect(email).toHaveValue("propio@empresa.com");
    expect(password).toHaveValue("MiClaveSegura");
  });

  it("keeps fields empty after the Login component is re-entered", () => {
    const view = renderLobby();
    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    email.value = "previous@example.com";
    password.value = "previous-password";

    view.unmount();
    renderLobby();

    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
  });

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
    isAuthSessionPersistenceEnabledMock.mockReturnValue(true);
    authMock.signInWithPassword.mockResolvedValue({
      data: null,
      error: { status: 404, message: "User not found" },
    });

    const user = userEvent.setup();
    renderLobby();

    await user.type(screen.getByLabelText("Correo electrónico"), "missing@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "WrongPassword123");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByText(/correo o contraseña incorrectos/i)).toBeInTheDocument();
    expect(screen.queryByText(/cuenta no encontrada|user not found/i)).not.toBeInTheDocument();
    expect(signOutAuthMock).not.toHaveBeenCalled();
    expect(setAuthSessionPersistenceMock).toHaveBeenNthCalledWith(2, true);
  });

  it("shows a clear connection message instead of calling a technical failure invalid credentials", async () => {
    authMock.signInWithPassword.mockRejectedValue(new Error("fetch failed"));

    const user = userEvent.setup();
    renderLobby();

    await user.type(screen.getByLabelText("Correo electrónico"), "delivery@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "password");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByText(/no pudimos conectarnos/i)).toBeInTheDocument();
    expect(screen.queryByText(/correo o contraseña incorrectos/i)).not.toBeInTheDocument();
  });

  it("cleans only the new local session when profile validation fails after login", async () => {
    isAuthSessionPersistenceEnabledMock.mockReturnValue(true);
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: "delivery-user" }, session: { access_token: "new-session-token" } },
      error: null,
    });
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: null, error: new Error("profile unavailable") })),
        })),
      })),
    });

    const user = userEvent.setup();
    renderLobby();
    await user.type(screen.getByLabelText("Correo electrónico"), "delivery@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "SecurePass123");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByText(/no pudimos validar tu perfil/i)).toBeInTheDocument();
    expect(signOutAuthMock).toHaveBeenCalledWith({ scope: "local" });
    expect(setAuthSessionPersistenceMock).toHaveBeenLastCalledWith(true);
  });

  it("restores prior persistence after rejecting an inactive account", async () => {
    isAuthSessionPersistenceEnabledMock.mockReturnValue(true);
    mockProfile({ role: "delivery", employment_status: false });
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: "inactive-user" }, session: { access_token: "candidate-token" } },
      error: null,
    });

    const user = userEvent.setup();
    renderLobby();
    await user.type(screen.getByLabelText("Correo electrónico"), "inactive@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "SecurePass123");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByText(/cuenta está desactivada/i)).toBeInTheDocument();
    expect(signOutAuthMock).toHaveBeenCalledWith({ scope: "local" });
    expect(setAuthSessionPersistenceMock).toHaveBeenLastCalledWith(true);
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
      expect(screen.getByText(/acceso concedido/i)).toBeInTheDocument();
    });
    const mfaCallIndex = authMock.mfa.challengeAndVerify.mock.invocationCallOrder[0];
    const persistenceCallOrder = setAuthSessionPersistenceMock.mock.invocationCallOrder;
    const persistenceCallIndex = persistenceCallOrder[persistenceCallOrder.length - 1];
    expect(persistenceCallIndex).toBeGreaterThan(mfaCallIndex);
    expect(setAuthSessionPersistenceMock).toHaveBeenLastCalledWith(true);
  });

  it("cleans up an admin candidate and restores persistence when MFA fails", async () => {
    isAuthSessionPersistenceEnabledMock.mockReturnValue(true);
    mockProfile({ role: "admin", employment_status: true });
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-user" }, session: { access_token: "candidate-token" } },
      error: null,
    });
    authMock.mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
      error: null,
    });
    authMock.mfa.challengeAndVerify.mockResolvedValue({ error: new Error("invalid code") });
    vi.spyOn(window, "prompt").mockReturnValue("123456");

    const user = userEvent.setup();
    renderLobby();
    await user.type(screen.getByLabelText("Correo electrónico"), "admin@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "SecurePass123");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByText(/verifica el segundo factor para continuar/i)).toBeInTheDocument();
    expect(signOutAuthMock).toHaveBeenCalledWith({ scope: "local" });
    expect(setAuthSessionPersistenceMock).toHaveBeenLastCalledWith(true);
  });

  it("promotes a normal session only after profile validation succeeds", async () => {
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: "delivery-user" }, session: { access_token: "candidate-token" } },
      error: null,
    });

    const user = userEvent.setup();
    renderLobby();
    await user.type(screen.getByLabelText("Correo electrónico"), "delivery@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "SecurePass123");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    await waitFor(() => expect(screen.getByText(/acceso concedido/i)).toBeInTheDocument());
    expect(setAuthSessionPersistenceMock).toHaveBeenNthCalledWith(1, false);
    expect(setAuthSessionPersistenceMock).toHaveBeenLastCalledWith(true);
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
