import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/AuthProvider.jsx";
import Lobby from "../pages/lobby.jsx";

const authMock = vi.hoisted(() => ({
  authChangeHandler: null,
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
  },
}));
const fromMock = vi.hoisted(() => vi.fn());
const authManagerMock = vi.hoisted(() => ({
  clearCachedAuthSession: vi.fn(),
  consumeAuthNotice: vi.fn(() => null),
  expireAuthSession: vi.fn(),
  getAuthSession: vi.fn(),
  isInvalidRefreshTokenError: vi.fn(() => false),
  refreshAuthSession: vi.fn(),
  setCachedAuthSession: vi.fn(),
  signOutAuth: vi.fn(),
  subscribeToAuthInvalidation: vi.fn(() => () => undefined),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    auth: authMock,
    from: fromMock,
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("../utils/authManager", () => ({
  ...authManagerMock,
  isAuthSessionPersistenceEnabled: vi.fn(() => false),
  setAuthSessionPersistence: vi.fn(),
}));

const profile = {
  id: "digital-producer-user",
  name: "Productor Digital",
  email: "productordigital1@neonprintcompany.com",
  role: "digital_producer",
  employment_status: true,
  deleted_at: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  authMock.authChangeHandler = null;
  authMock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  authMock.onAuthStateChange.mockImplementation((handler) => {
    authMock.authChangeHandler = handler;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  authMock.signInWithPassword.mockImplementation(async () => {
    const session = {
      access_token: "digital-producer-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id },
    };
    queueMicrotask(() => authMock.authChangeHandler?.("SIGNED_IN", session));
    return { data: session, error: null };
  });
  authMock.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  authMock.mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  fromMock.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({ data: profile, error: null })),
      })),
    })),
  });

});

const AppShell = () => (
  <AuthProvider>
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/production" element={<div>Production ready</div>} />
      </Routes>
    </MemoryRouter>
  </AuthProvider>
);

describe("digital producer login navigation", () => {
  it("navigates to production after the session and profile are published", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.type(screen.getByLabelText("Correo electrónico"), profile.email);
    await user.type(screen.getByLabelText("Contraseña"), "valid-password");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    await waitFor(() => expect(screen.getByText("Production ready")).toBeInTheDocument());
    expect(screen.queryByText(/acceso concedido/i)).not.toBeInTheDocument();
  });

  it("replaces the redirect message when the provider profile validation fails", async () => {
    const profileResponses = [
      () => Promise.resolve({ data: profile, error: null }),
      () => Promise.reject(new Error("profile unavailable")),
    ];
    fromMock.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => (profileResponses.shift() || (() => Promise.resolve({ data: profile, error: null })))()),
        })),
      })),
    }));

    const user = userEvent.setup();
    render(<AppShell />);

    await user.type(screen.getByLabelText("Correo electrónico"), profile.email);
    await user.type(screen.getByLabelText("Contraseña"), "valid-password");
    await user.click(screen.getByRole("button", { name: /acceder al sistema/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos validar tu perfil/i);
    expect(screen.queryByText(/acceso concedido/i)).not.toBeInTheDocument();
    expect(authManagerMock.signOutAuth).toHaveBeenCalledWith({ scope: "local", suppressRemoteError: true });
  });
});
