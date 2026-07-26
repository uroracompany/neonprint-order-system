import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/useAuth", () => ({
  useAuth: useAuthMock,
}));

const LoginState = () => {
  const location = useLocation();
  return <div>{location.state?.loginMessage || "login"}</div>;
};

let ProtectedRoute;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ default: ProtectedRoute } = await import("../ProtectedRoute.jsx"));
});

describe("ProtectedRoute MFA enforcement", () => {
  it("blocks admin sessions that are not aal2", () => {
    useAuthMock.mockReturnValue({
      loading: false,
      user: { id: "admin-1" },
      profile: { role: "admin", employment_status: true },
      mfaLevel: "aal1",
      hasVerifiedMfaFactor: true,
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/" element={<LoginState />} />
          <Route
            path="/dashboard"
            element={<ProtectedRoute allowed={["admin"]}><div>Admin OK</div></ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/verifica el segundo factor/i)).toBeInTheDocument();
  });

  it("allows admin sessions with aal2", () => {
    useAuthMock.mockReturnValue({
      loading: false,
      user: { id: "admin-1" },
      profile: { role: "admin", employment_status: true },
      mfaLevel: "aal2",
      hasVerifiedMfaFactor: true,
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={<ProtectedRoute allowed={["admin"]}><div>Admin OK</div></ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Admin OK")).toBeInTheDocument();
  });

  it("allows admin sessions without an enrolled MFA factor", () => {
    useAuthMock.mockReturnValue({
      loading: false,
      user: { id: "admin-1" },
      profile: { role: "admin", employment_status: true },
      mfaLevel: "aal1",
      hasVerifiedMfaFactor: false,
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={<ProtectedRoute allowed={["admin"]}><div>Admin OK</div></ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Admin OK")).toBeInTheDocument();
  });
});
