import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

const makeAdminUpdateClient = ({
  duplicateProfiles = [],
  duplicateError = null,
  getUserError = null,
  authError = null,
  profileError = null,
  profileData = {
    id: "user-1",
    name: "Maria",
    email: "maria@example.com",
    role: "seller",
    employment_status: true,
  },
} = {}) => {
  const authUpdate = vi.fn(async () => ({ error: authError }));
  const getUserById = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: getUserError }));
  const profileUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: profileData, error: profileError })),
      })),
    })),
  }));

  const duplicateBuilder = {
    ilike: vi.fn(() => duplicateBuilder),
    neq: vi.fn(() => duplicateBuilder),
    limit: vi.fn(() => duplicateBuilder),
    then: (resolve, reject) => Promise.resolve({ data: duplicateProfiles, error: duplicateError }).then(resolve, reject),
  };

  return {
    auth: {
      admin: {
        getUserById,
        updateUserById: authUpdate,
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => duplicateBuilder),
      update: profileUpdate,
    })),
    authUpdate,
    getUserById,
    profileUpdate,
  };
};

const makeAdminCreateClient = () => {
  const insert = vi.fn(async () => ({ error: null }));
  const deleteUser = vi.fn(async () => ({ error: null }));
  const createUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));

  return {
    auth: {
      admin: {
        createUser,
        deleteUser,
      },
    },
    from: vi.fn(() => ({ insert })),
    insert,
    createUser,
    deleteUser,
  };
};

describe("handleAdminUpdateUser", () => {
  let handleAdminUpdateUser;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminUpdateUser } = await import("../../server/admin-update-user-handler.js"));
  });

  const validPayload = {
    userId: "user-1",
    name: "Maria",
    email: "Maria@Example.com",
    role: "seller",
  };

  it("updates auth and profile without changing password when password is empty", async () => {
    currentClient = makeAdminUpdateClient();

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(200);
    expect(currentClient.authUpdate).toHaveBeenCalledWith("user-1", {
      email: "maria@example.com",
      user_metadata: {
        lastname: "Maria",
        name: "Maria",
        display_name: "Maria",
      },
    });
    expect(currentClient.profileUpdate).toHaveBeenCalledWith({
      name: "Maria",
      email: "maria@example.com",
      role: "seller",
    });
  });

  it("updates auth password when a valid password is provided", async () => {
    currentClient = makeAdminUpdateClient();

    const result = await handleAdminUpdateUser({ ...validPayload, password: "secret1" }, env);

    expect(result.status).toBe(200);
    expect(currentClient.authUpdate).toHaveBeenCalledWith("user-1", expect.objectContaining({
      password: "secret1",
    }));
  });

  it("rejects duplicated profile email from another user", async () => {
    currentClient = makeAdminUpdateClient({ duplicateProfiles: [{ id: "user-2" }] });

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/Ya existe otro usuario/);
    expect(currentClient.authUpdate).not.toHaveBeenCalled();
  });

  it("rejects short passwords", async () => {
    currentClient = makeAdminUpdateClient();

    const result = await handleAdminUpdateUser({ ...validPayload, password: "123" }, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/al menos 6/);
  });

  it("rejects invalid roles", async () => {
    currentClient = makeAdminUpdateClient();

    const result = await handleAdminUpdateUser({ ...validPayload, role: "owner" }, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/rol/);
  });

  it("returns 404 when the auth user does not exist", async () => {
    currentClient = makeAdminUpdateClient({ getUserError: { message: "User not found" } });

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(404);
    expect(result.body.error).toBe("User not found");
  });

  it("requires server Supabase environment variables", async () => {
    currentClient = makeAdminUpdateClient();

    const result = await handleAdminUpdateUser(validPayload, {});

    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/SUPABASE_URL/);
  });
});

describe("handleAdminCreateUser", () => {
  let handleAdminCreateUser;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminCreateUser } = await import("../../server/admin-create-user-handler.js"));
  });

  it("stores email in profiles when creating a user", async () => {
    currentClient = makeAdminCreateClient();

    const result = await handleAdminCreateUser({
      name: "Carlos",
      email: "Carlos@Example.com",
      password: "secret1",
      role: "designer",
    }, env);

    expect(result.status).toBe(200);
    expect(currentClient.insert).toHaveBeenCalledWith([{
      id: "user-1",
      name: "Carlos",
      email: "carlos@example.com",
      role: "designer",
      employment_status: true,
    }]);
  });
});
