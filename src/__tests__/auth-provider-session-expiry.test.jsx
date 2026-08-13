import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authManagerMock = vi.hoisted(() => ({
  invalidationHandler: null,
  clearCachedAuthSession: vi.fn(),
  consumeAuthNotice: vi.fn(() => null),
  getAuthSession: vi.fn(),
  maintainAuthSession: vi.fn(),
  setCachedAuthSession: vi.fn(),
  signOutAuth: vi.fn(),
  startAuthSessionMonitor: vi.fn(() => vi.fn()),
  subscribeToAuthInvalidation: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  authChangeHandler: null,
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
  },
  onAuthStateChange: vi.fn(),
}));

const profileQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/authManager", () => ({
  ...authManagerMock,
  subscribeToAuthInvalidation: vi.fn((listener) => {
    authManagerMock.invalidationHandler = listener;
    return () => { authManagerMock.invalidationHandler = null; };
  }),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    auth: authMock,
    from: profileQueryMock,
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

const LoginState = () => {
  const location = useLocation();
  return <div>{location.state?.loginNotice || "login"}</div>;
};

let AuthProvider;
let ProtectedRoute;

beforeEach(async () => {
  vi.clearAllMocks();
  authManagerMock.invalidationHandler = null;
  authManagerMock.getAuthSession.mockResolvedValue({
    access_token: "valid-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "delivery-user" },
  });
  authMock.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  authMock.mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  authMock.onAuthStateChange.mockImplementation((handler) => {
    authMock.authChangeHandler = handler;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  profileQueryMock.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "delivery-user", role: "delivery", employment_status: true },
          error: null,
        })),
      })),
    })),
  });
  ({ AuthProvider } = await import("../contexts/AuthProvider.jsx"));
  ({ default: ProtectedRoute } = await import("../ProtectedRoute.jsx"));
});

describe("AuthProvider session expiration", () => {
  it("mantiene visible un perfil de administrador durante la renovacion del token", async () => {
    authManagerMock.getAuthSession.mockResolvedValue({
      access_token: "valid-admin-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "admin-user" },
    });
    profileQueryMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: "admin-user", role: "admin", employment_status: true },
            error: null,
          })),
        })),
      })),
    });

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route path="/admin" element={<ProtectedRoute allowed={["admin"]}><div>Admin ready</div></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();

    let resolveAal;
    let resolveFactors;
    authMock.mfa.getAuthenticatorAssuranceLevel.mockReturnValue(new Promise((resolve) => { resolveAal = resolve; }));
    authMock.mfa.listFactors.mockReturnValue(new Promise((resolve) => { resolveFactors = resolve; }));

    act(() => {
      authMock.authChangeHandler("TOKEN_REFRESHED", {
        access_token: "refreshed-admin-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "admin-user" },
      });
    });

    expect(screen.getByText("Admin ready")).toBeInTheDocument();

    await act(async () => {
      resolveAal({ data: { currentLevel: "aal1" }, error: null });
      resolveFactors({ data: { totp: [] }, error: null });
    });
  });

  it("redirects an active protected session to login with a friendly expiration notice", async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/delivery"]}>
          <Routes>
            <Route path="/" element={<LoginState />} />
            <Route path="/delivery" element={<ProtectedRoute allowed={["delivery"]}><div>Delivery ready</div></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(await screen.findByText("Delivery ready")).toBeInTheDocument();

    act(() => {
      authManagerMock.invalidationHandler({ notice: "SESSION_EXPIRED" });
    });

    await waitFor(() => {
      expect(screen.getByText("SESSION_EXPIRED")).toBeInTheDocument();
    });
    expect(screen.queryByText("Delivery ready")).not.toBeInTheDocument();
  });
});
