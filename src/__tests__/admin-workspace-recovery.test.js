import { describe, expect, it } from "vitest";
import {
  buildAdminWorkspaceRecovery,
  clearAdminWorkspaceRecovery,
  readAdminWorkspaceRecovery,
  writeAdminWorkspaceRecovery,
} from "../utils/adminWorkspaceRecovery";

describe("admin workspace recovery", () => {
  it("restores only a current user's recoverable modal draft", () => {
    const storage = new Map();
    const fakeStorage = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    const recovery = buildAdminWorkspaceRecovery({
      userId: "admin-1",
      activeTab: "clients",
      modal: "create-client",
      clientForm: { name: "Ana", phone: "809-555-1234", ignored: "no" },
      materialFormName: "Vinilo",
    });

    writeAdminWorkspaceRecovery(recovery, fakeStorage);

    expect(readAdminWorkspaceRecovery("admin-1", fakeStorage)).toMatchObject({
      activeTab: "clients",
      modal: "create-client",
      clientForm: { name: "Ana", phone: "809-555-1234", email: "", address: "", notes: "" },
      materialFormName: "Vinilo",
    });
    expect(readAdminWorkspaceRecovery("admin-2", fakeStorage)).toBeNull();

    clearAdminWorkspaceRecovery("admin-1", fakeStorage);
    expect(readAdminWorkspaceRecovery("admin-1", fakeStorage)).toBeNull();
  });

  it("does not create recovery data without an active recoverable modal", () => {
    expect(buildAdminWorkspaceRecovery({ userId: "admin-1", modal: null })).toBeNull();
  });
});
