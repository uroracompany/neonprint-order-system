import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const makeAdminToken = () => "Bearer valid-admin-token";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: makeAdminToken(),
};

const makeAdminUpdateClient = ({
  tokenUserId = "admin-1",
  tokenError = null,
  currentRole = "admin",
  currentProfileError = null,
  duplicateProfiles = [],
  duplicateError = null,
  getUserError = null,
  authError = null,
  previousProfile = {
    id: "user-1",
    name: "Ana",
    email: "ana@example.com",
    role: "designer",
    employment_status: true,
  },
  previousProfileError = null,
  profileError = null,
  rollbackError = null,
  profileData = {
    id: "user-1",
    name: "Maria",
    email: "maria@example.com",
    role: "seller",
    employment_status: true,
  },
} = {}) => {
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));
  const authUpdate = vi.fn(async () => ({ error: authError }));
  const getUserById = vi.fn(async (id) => {
    if (id === tokenUserId) {
      return { data: { user: { id: tokenUserId } }, error: null };
    }
    return { data: { user: { id } }, error: getUserError };
  });
  const updateEqResults = [];
  const profileUpdate = vi.fn((payload) => ({
    eq: vi.fn(() => {
      const eqResult = {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: profileData, error: profileError })),
        })),
        then: (resolve, reject) => Promise.resolve({ data: null, error: rollbackError }).then(resolve, reject),
        payload,
      };
      updateEqResults.push(eqResult);
      return eqResult;
    }),
  }));

  const duplicateBuilder = {
    ilike: vi.fn(() => duplicateBuilder),
    neq: vi.fn(() => duplicateBuilder),
    limit: vi.fn(() => duplicateBuilder),
    then: (resolve, reject) => Promise.resolve({ data: duplicateProfiles, error: duplicateError }).then(resolve, reject),
  };

  const select = vi.fn((columns) => {
    if (columns === "id") return duplicateBuilder;

    return {
      eq: vi.fn((column, value) => ({
        single: vi.fn(async () => {
          if (value === tokenUserId) {
            return {
              data: {
                id: tokenUserId,
                name: "Admin",
                email: "admin@example.com",
                role: currentRole,
                employment_status: true,
              },
              error: currentProfileError,
            };
          }

          return {
            data: previousProfile,
            error: previousProfileError,
          };
        }),
      })),
    };
  });

  return {
    auth: {
      getUser,
      admin: {
        getUserById,
        updateUserById: authUpdate,
      },
    },
    from: vi.fn(() => ({
      select,
      update: profileUpdate,
    })),
    getUser,
    authUpdate,
    getUserById,
    profileUpdate,
    updateEqResults,
  };
};

const makeAdminCreateClient = ({
  tokenUserId = "admin-1",
  tokenError = null,
  currentRole = "admin",
  currentProfileError = null,
} = {}) => {
  const getUserById = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));
  const insert = vi.fn(async () => ({ error: null }));
  const deleteUser = vi.fn(async () => ({ error: null }));
  const createUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));

  const currentSingle = vi.fn(async () => ({
    data: {
      id: tokenUserId,
      name: "Admin",
      email: "admin@example.com",
      role: currentRole,
      employment_status: true,
    },
    error: currentProfileError,
  }));

  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: currentSingle,
    })),
  }));

  return {
    auth: {
      getUser,
      admin: {
        getUserById,
        createUser,
        deleteUser,
      },
    },
    from: vi.fn(() => ({ select, insert })),
    insert,
    createUser,
    deleteUser,
    getUser,
    getUserById,
  };
};

const makeAdminListClient = ({
  tokenUserId = "admin-1",
  tokenError = null,
  currentRole = "admin",
  currentProfileError = null,
  users = [{ id: "user-1", name: "Ana", email: "ana@example.com", role: "seller", employment_status: true }],
  usersError = null,
  firstUsersError = null,
  fallbackUsers = [{ id: "user-1", name: "Ana", role: "seller", employment_status: true }],
} = {}) => {
  const getUserById = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));

  const currentSingle = vi.fn(async () => ({
    data: {
      id: tokenUserId,
      name: "Admin",
      email: "admin@example.com",
      role: currentRole,
      employment_status: true,
    },
    error: currentProfileError,
  }));

  const rangeUsers = vi.fn(async () => ({
    data: firstUsersError ? null : users,
    error: firstUsersError || usersError,
    count: firstUsersError ? null : users.length,
  }));
  const rangeFallbackUsers = vi.fn(async () => ({
    data: fallbackUsers,
    error: usersError,
    count: fallbackUsers.length,
  }));

  const select = vi.fn((columns) => {
    if (String(columns).includes("email")) {
      return {
        eq: vi.fn(() => ({
          single: currentSingle,
        })),
        or: vi.fn(() => ({
          order: vi.fn(() => ({ range: rangeUsers })),
        })),
        order: vi.fn(() => ({ range: rangeUsers })),
      };
    }

    return {
      eq: vi.fn(() => ({
        single: currentSingle,
      })),
      or: vi.fn(() => ({
        order: vi.fn(() => ({ range: rangeFallbackUsers })),
      })),
      order: vi.fn(() => ({ range: rangeFallbackUsers })),
    };
  });

  return {
    auth: {
      getUser,
      admin: {
        getUserById,
      },
    },
    from: vi.fn(() => ({ select })),
    getUser,
    getUserById,
    currentSingle,
    orderUsers: rangeUsers,
    orderFallbackUsers: rangeFallbackUsers,
  };
};

const makeAdminOrdersClient = ({
  tokenUserId = "admin-1",
  tokenError = null,
  currentRole = "admin",
  currentProfileError = null,
  orders = [{
    id: "order-1",
    client_name: "JP MORGAN",
    status: "in_Quote",
    payment_status: "Pending_Payment",
    price: null,
    invoice_payment: null,
    is_archived_admin: false,
  }],
  ordersError = null,
} = {}) => {
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));

  const currentSingle = vi.fn(async () => ({
    data: {
      id: tokenUserId,
      name: "Admin",
      email: "admin@example.com",
      role: currentRole,
      employment_status: true,
    },
    error: currentProfileError,
  }));

  const profileSelect = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: currentSingle,
    })),
  }));

  const orderRange = vi.fn(async () => ({
    data: ordersError ? null : orders,
    error: ordersError,
    count: ordersError ? null : orders.length,
  }));

  const orderBuilder = {
    eq: vi.fn(() => orderBuilder),
    or: vi.fn(() => orderBuilder),
    gte: vi.fn(() => orderBuilder),
    order: vi.fn(() => ({ range: orderRange })),
  };

  const orderSelect = vi.fn(() => orderBuilder);

  return {
    auth: {
      getUser,
      admin: {
        getUserById: vi.fn(),
      },
    },
    from: vi.fn((table) => (
      table === "profiles"
        ? { select: profileSelect }
        : { select: orderSelect }
    )),
    getUser,
    currentSingle,
    orderBuilder,
    orderRange,
    orderSelect,
  };
};

const makeAdminSetStatusClient = ({
  currentRole = "admin",
  profileError = null,
  statusData = {
    id: "user-1",
    name: "Ana",
    email: "ana@example.com",
    role: "seller",
    employment_status: false,
  },
  statusError = null,
} = {}) => {
  const getUserById = vi.fn(async () => ({
    data: { user: { id: "admin-1" } },
    error: null,
  }));
  const getUser = vi.fn(async () => ({
    data: { user: { id: "admin-1" } },
    error: null,
  }));

  const currentSingle = vi.fn(async () => ({
    data: {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      role: currentRole,
      employment_status: true,
    },
    error: profileError,
  }));

  const statusSingle = vi.fn(async () => ({
    data: statusData,
    error: statusError,
  }));

  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: currentSingle,
    })),
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: statusSingle,
      })),
    })),
  }));

  return {
    auth: {
      getUser,
      admin: {
        getUserById,
      },
    },
    from: vi.fn(() => ({ select, update })),
    getUser,
    getUserById,
    update,
    statusSingle,
  };
};

describe("requireAdmin", () => {
  let requireAdmin;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ requireAdmin } = await import("../../server/auth-middleware.js"));
  });

  it("validates an admin session through Supabase Auth without JWT_SECRET", async () => {
    currentClient = makeAdminListClient();
    const envWithoutJwtSecret = { ...env };
    delete envWithoutJwtSecret.JWT_SECRET;

    const result = await requireAdmin(makeAdminToken(), envWithoutJwtSecret);

    expect(result.authorized).toBe(true);
    expect(result.profile.role).toBe("admin");
    expect(currentClient.getUser).toHaveBeenCalledWith("valid-admin-token");
  });

  it("rejects a valid token when the profile is not admin", async () => {
    currentClient = makeAdminListClient({ currentRole: "seller" });

    const result = await requireAdmin(makeAdminToken(), env);

    expect(result.authorized).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/administrador/);
  });

  it("returns a token error when Supabase Auth rejects the token", async () => {
    currentClient = makeAdminListClient({
      tokenUserId: null,
      tokenError: { message: "invalid jwt" },
    });

    const result = await requireAdmin(makeAdminToken(), env);

    expect(result.authorized).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/sesion/);
  });

  it("returns a connectivity error when Supabase Auth cannot be reached", async () => {
    currentClient = makeAdminListClient({
      tokenUserId: null,
      tokenError: { message: "fetch failed" },
    });

    const result = await requireAdmin(makeAdminToken(), env);

    expect(result.authorized).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toMatch(/Supabase Auth/);
  });
});

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

  it("requires profiles.email to edit users", async () => {
    currentClient = makeAdminUpdateClient({
      duplicateError: { code: "42703", message: "column profiles.email does not exist" },
    });

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/profiles\.email/);
    expect(result.body.error).toMatch(/20260604_add_profiles_email_for_admin_edit/);
    expect(currentClient.profileUpdate).not.toHaveBeenCalled();
    expect(currentClient.authUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-admin users before updating anything", async () => {
    currentClient = makeAdminUpdateClient({ currentRole: "seller" });

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/administrador/);
    expect(currentClient.profileUpdate).not.toHaveBeenCalled();
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

  it("accepts producer roles", async () => {
    currentClient = makeAdminUpdateClient({
      profileData: {
        id: "user-1",
        name: "Maria",
        email: "maria@example.com",
        role: "digital_producer",
        employment_status: true,
      },
    });

    const result = await handleAdminUpdateUser({ ...validPayload, role: "digital_producer" }, env);

    expect(result.status).toBe(200);
    expect(currentClient.profileUpdate).toHaveBeenCalledWith(expect.objectContaining({
      role: "digital_producer",
    }));
  });

  it("does not update auth when profile update fails", async () => {
    currentClient = makeAdminUpdateClient({
      profileError: { message: "duplicate key value violates unique constraint" },
    });

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/No se pudo actualizar el perfil/);
    expect(currentClient.profileUpdate).toHaveBeenCalledWith({
      name: "Maria",
      email: "maria@example.com",
      role: "seller",
    });
    expect(currentClient.authUpdate).not.toHaveBeenCalled();
  });

  it("rolls back profile when auth update fails", async () => {
    currentClient = makeAdminUpdateClient({
      authError: { message: "User already registered" },
      previousProfile: {
        id: "user-1",
        name: "Ana",
        email: "ana@example.com",
        role: "designer",
        employment_status: true,
      },
    });

    const result = await handleAdminUpdateUser(validPayload, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/perfil fue restaurado/i);
    expect(currentClient.authUpdate).toHaveBeenCalled();
    expect(currentClient.profileUpdate).toHaveBeenCalledTimes(2);
    expect(currentClient.profileUpdate).toHaveBeenNthCalledWith(2, {
      name: "Ana",
      email: "ana@example.com",
      role: "designer",
    });
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

  it("creates users with producer roles", async () => {
    currentClient = makeAdminCreateClient();

    const result = await handleAdminCreateUser({
      name: "Luis",
      email: "luis@example.com",
      password: "secret1",
      role: "dtf_producer",
    }, env);

    expect(result.status).toBe(200);
    expect(currentClient.insert).toHaveBeenCalledWith([expect.objectContaining({
      email: "luis@example.com",
      role: "dtf_producer",
    })]);
  });

  it("rejects invalid roles when creating a user", async () => {
    currentClient = makeAdminCreateClient();

    const result = await handleAdminCreateUser({
      name: "Carlos",
      email: "carlos@example.com",
      password: "secret1",
      role: "owner",
    }, env);

    expect(result.status).toBe(400);
    expect(currentClient.createUser).not.toHaveBeenCalled();
  });
});

describe("handleAdminListUsers", () => {
  let handleAdminListUsers;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminListUsers } = await import("../../server/admin-list-users-handler.js"));
  });

  it("lists users for an authenticated admin", async () => {
    currentClient = makeAdminListClient();

    const result = await handleAdminListUsers({}, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(200);
    expect(result.body.users).toEqual([
      { id: "user-1", name: "Ana", email: "ana@example.com", role: "seller", employment_status: true },
    ]);
  });

  it("rejects non-admin users", async () => {
    currentClient = makeAdminListClient({ currentRole: "seller" });

    const result = await handleAdminListUsers({}, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/administrador/);
    expect(currentClient.orderUsers).not.toHaveBeenCalled();
  });

  it("falls back when profiles.email does not exist yet", async () => {
    currentClient = makeAdminListClient({
      firstUsersError: { code: "42703", message: "column profiles.email does not exist" },
    });

    const result = await handleAdminListUsers({}, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(200);
    expect(result.body.users).toEqual([
      { id: "user-1", name: "Ana", email: "", role: "seller", employment_status: true },
    ]);
    expect(currentClient.orderFallbackUsers).toHaveBeenCalled();
  });
});

describe("handleAdminListOrders", () => {
  let handleAdminListOrders;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminListOrders } = await import("../../server/admin-list-orders-handler.js"));
  });

  it("lists orders for an authenticated admin", async () => {
    currentClient = makeAdminOrdersClient({
      orders: [
        {
          id: "order-1",
          client_name: "JP MORGAN",
          status: "in_Quote",
          payment_status: "Pending_Payment",
          price: null,
          invoice_payment: null,
          is_archived_admin: false,
        },
      ],
    });

    const result = await handleAdminListOrders({}, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(200);
    expect(result.body.orders).toEqual([
      expect.objectContaining({
        id: "order-1",
        client_name: "JP MORGAN",
        status: "in_Quote",
        payment_status: "Pending_Payment",
        is_archived_admin: false,
      }),
    ]);
    expect(result.body.total).toBe(1);
    expect(currentClient.orderSelect).toHaveBeenCalledWith("*", { count: "exact" });
    expect(currentClient.orderBuilder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(currentClient.orderRange).toHaveBeenCalledWith(0, 499);
  });

  it("returns an empty list when there are no orders", async () => {
    currentClient = makeAdminOrdersClient({ orders: [] });

    const result = await handleAdminListOrders({ pageSize: 25 }, env);

    expect(result.status).toBe(200);
    expect(result.body.orders).toEqual([]);
    expect(result.body.total).toBe(0);
    expect(currentClient.orderRange).toHaveBeenCalledWith(0, 24);
  });

  it("rejects non-admin users before querying orders", async () => {
    currentClient = makeAdminOrdersClient({ currentRole: "seller" });

    const result = await handleAdminListOrders({}, env);

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/administrador/);
    expect(currentClient.orderRange).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens before querying orders", async () => {
    currentClient = makeAdminOrdersClient({
      tokenUserId: null,
      tokenError: { message: "invalid jwt" },
    });

    const result = await handleAdminListOrders({}, env);

    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/sesion/);
    expect(currentClient.orderRange).not.toHaveBeenCalled();
  });

  it("returns database errors instead of an empty list", async () => {
    currentClient = makeAdminOrdersClient({
      ordersError: { message: "permission denied for table orders", code: "42501" },
    });

    const result = await handleAdminListOrders({}, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/permission denied/);
  });

  it("applies pagination and supported filters", async () => {
    currentClient = makeAdminOrdersClient();

    const result = await handleAdminListOrders({
      page: 2,
      pageSize: 10,
      status: "in_Quote",
      archive: "active",
      clientId: "client-1",
      ownerId: "owner-1",
      dateFilter: "week",
      search: "JP MORGAN",
    }, { ...env, now: "2026-06-07T12:00:00.000Z" });

    expect(result.status).toBe(200);
    expect(currentClient.orderBuilder.eq).toHaveBeenCalledWith("status", "in_Quote");
    expect(currentClient.orderBuilder.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(currentClient.orderBuilder.gte).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(currentClient.orderBuilder.or).toHaveBeenCalledWith("is_archived_admin.is.false,is_archived_admin.is.null");
    expect(currentClient.orderBuilder.or).toHaveBeenCalledWith(expect.stringContaining("seller_id.eq.owner-1"));
    expect(currentClient.orderBuilder.or).toHaveBeenCalledWith(expect.stringContaining("client_name.ilike.%JP MORGAN%"));
    expect(currentClient.orderRange).toHaveBeenCalledWith(10, 19);
  });
});

describe("handleAdminSetUserStatus", () => {
  let handleAdminSetUserStatus;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminSetUserStatus } = await import("../../server/admin-set-user-status-handler.js"));
  });

  it("updates only employment_status for an authenticated admin", async () => {
    currentClient = makeAdminSetStatusClient();

    const result = await handleAdminSetUserStatus({
      userId: "user-1",
      employment_status: false,
    }, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(200);
    expect(currentClient.update).toHaveBeenCalledWith({ employment_status: false });
    expect(result.body.user).toEqual({
      id: "user-1",
      name: "Ana",
      email: "ana@example.com",
      role: "seller",
      employment_status: false,
    });
  });

  it("rejects status updates from non-admin users", async () => {
    currentClient = makeAdminSetStatusClient({ currentRole: "seller" });

    const result = await handleAdminSetUserStatus({
      userId: "user-1",
      employment_status: false,
    }, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(403);
    expect(currentClient.update).not.toHaveBeenCalled();
  });

  it("requires a boolean employment_status", async () => {
    currentClient = makeAdminSetStatusClient();

    const result = await handleAdminSetUserStatus({
      userId: "user-1",
      employment_status: "false",
    }, { ...env, authHeader: makeAdminToken() });

    expect(result.status).toBe(400);
    expect(currentClient.update).not.toHaveBeenCalled();
  });
});
