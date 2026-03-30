import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../src/stores/auth";

const apiMock = {
  getBootstrapStatus: vi.fn(),
  bootstrapAdministrator: vi.fn(),
  login: vi.fn(),
  getSession: vi.fn(),
  setupPin: vi.fn(),
  pinReenter: vi.fn(),
  warmLock: vi.fn(),
  logout: vi.fn(),
  listMembers: vi.fn(),
  createMember: vi.fn(),
  assignCoach: vi.fn(),
  setFaceConsent: vi.fn(),
  enrollFace: vi.fn(),
  getFaceHistory: vi.fn(),
  createPost: vi.fn(),
  listPosts: vi.fn(),
  recordView: vi.fn(),
  recordSearch: vi.fn(),
  analytics: vi.fn(),
  getDashboard: vi.fn(),
  saveDashboard: vi.fn(),
  createTemplate: vi.fn(),
  listSchedules: vi.fn(),
  createSchedule: vi.fn(),
  generateReport: vi.fn(),
  getInbox: vi.fn(),
  getAdminConsole: vi.fn(),
  createBackup: vi.fn(),
  dryRunRestore: vi.fn()
};

vi.mock("../src/api/client", () => ({
  createApiClient: vi.fn(() => apiMock)
}));

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    Object.values(apiMock).forEach((mock) => mock.mockReset());
  });

  it("restores active session from the server session endpoint", async () => {
    apiMock.getSession.mockResolvedValueOnce({
      session: {
        currentUser: {
          id: 1,
          username: "admin",
          fullName: "System Administrator",
          roles: ["Administrator", "Coach", "Member"]
        },
        sessionSecret: "restored-secret",
        warmLocked: false,
        hasPin: true,
        warmLockMinutes: 5,
        sessionTimeoutMinutes: 30,
        lastActivityAt: "2026-03-29T10:00:00.000Z"
      }
    });

    const store = useAuthStore();
    await store.bootstrap();

    expect(store.bootstrapRequired).toBe(false);
    expect(store.currentUser?.username).toBe("admin");
    expect(store.sessionSecret).toBe("restored-secret");
    expect(store.warmLocked).toBe(false);
  });

  it("bootstraps warm-locked workstation state for PIN resume", async () => {
    apiMock.getSession.mockResolvedValueOnce({
      session: {
        currentUser: {
          id: 1,
          username: "admin",
          fullName: "System Administrator",
          roles: ["Administrator", "Coach", "Member"]
        },
        sessionSecret: null,
        warmLocked: true,
        hasPin: true,
        warmLockMinutes: 5,
        sessionTimeoutMinutes: 30
      }
    });

    const store = useAuthStore();
    await store.bootstrap();

    expect(store.currentUser?.username).toBe("admin");
    expect(store.sessionSecret).toBeNull();
    expect(store.hasPin).toBe(true);
    expect(store.warmLocked).toBe(true);
  });

  it("switches into bootstrap mode when no administrator exists yet", async () => {
    apiMock.getSession.mockRejectedValueOnce(new Error("missing secret"));
    apiMock.getBootstrapStatus.mockResolvedValueOnce({ requiresBootstrap: true });

    const store = useAuthStore();
    await store.bootstrap();

    expect(store.bootstrapRequired).toBe(true);
    expect(store.currentUser).toBeNull();
  });

  it("creates the first administrator through the bootstrap flow", async () => {
    apiMock.bootstrapAdministrator.mockResolvedValueOnce({
      currentUser: {
        id: 1,
        username: "owner",
        fullName: "Facility Owner",
        roles: ["Administrator", "Coach", "Member"]
      },
      sessionSecret: "bootstrap-secret",
      hasPin: false,
      warmLockMinutes: 5,
      sessionTimeoutMinutes: 30
    });

    const store = useAuthStore();
    store.bootstrapRequired = true;
    await store.bootstrapAdministrator("owner", "Facility Owner", "Owner12345!X");

    expect(store.bootstrapRequired).toBe(false);
    expect(store.currentUser?.username).toBe("owner");
    expect(store.sessionSecret).toBe("bootstrap-secret");
  });

  it("logs in and keeps the session secret in memory only", async () => {
    apiMock.login.mockResolvedValueOnce({
      currentUser: {
        id: 1,
        username: "coach",
        fullName: "Coach Carter",
        roles: ["Coach", "Member"]
      },
      sessionSecret: "secret",
      hasPin: false,
      warmLockMinutes: 5,
      sessionTimeoutMinutes: 30
    });

    const store = useAuthStore();
    store.warmLocked = true;
    await store.login("coach", "Coach12345!X");

    expect(store.currentUser?.username).toBe("coach");
    expect(store.sessionSecret).toBe("secret");
    expect(store.warmLocked).toBe(false);
  });

  it("supports PIN setup and PIN re-entry for warm locks", async () => {
    apiMock.setupPin.mockResolvedValueOnce({ hasPin: true });
    apiMock.pinReenter.mockResolvedValueOnce({
      currentUser: {
        id: 1,
        username: "admin",
        fullName: "System Administrator",
        roles: ["Administrator"]
      },
      sessionSecret: "new-secret",
      hasPin: true,
      warmLockMinutes: 5,
      sessionTimeoutMinutes: 30
    });

    const store = useAuthStore();
    store.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    store.hasPin = false;
    store.warmLocked = true;

    await store.setupPin("1234");
    await store.reenterWithPin("1234");

    expect(store.hasPin).toBe(true);
    expect(store.sessionSecret).toBe("new-secret");
    expect(store.warmLocked).toBe(false);
  });

  it("throws when PIN re-entry lacks a known user context", async () => {
    const store = useAuthStore();

    await expect(store.reenterWithPin("1234")).rejects.toThrowError("User context is missing");
  });

  it("logs out and resets workstation state", async () => {
    apiMock.logout.mockResolvedValueOnce({ loggedOut: true });

    const store = useAuthStore();
    store.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    store.sessionSecret = "secret";
    store.hasPin = true;
    store.warmLocked = true;
    store.activeView = "reports";

    await store.logout();

    expect(store.currentUser).toBeNull();
    expect(store.sessionSecret).toBeNull();
    expect(store.hasPin).toBe(false);
    expect(store.activeView).toBe("overview");
  });

  it("persists station tokens and pushes warm lock to the server", async () => {
    apiMock.warmLock.mockResolvedValueOnce({ warmLocked: true });
    const store = useAuthStore();
    store.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    store.sessionSecret = "secret";
    store.hasPin = true;

    store.setStationToken("Lobby-Kiosk-01");
    await store.triggerWarmLock();

    expect(window.localStorage.getItem("sentinelfit.stationToken")).toBe("Lobby-Kiosk-01");
    expect(store.warmLocked).toBe(true);
    expect(store.sessionSecret).toBeNull();
    expect(window.localStorage.getItem("sentinelfit.warmLockContext")).not.toBeNull();
    expect(apiMock.warmLock).toHaveBeenCalled();
  });

  it("rejects unauthorized view activation attempts and falls back to overview", () => {
    const store = useAuthStore();
    store.currentUser = {
      id: 2,
      username: "coach",
      fullName: "Coach User",
      roles: ["Coach", "Member"]
    };

    store.setActiveView("admin");
    expect(store.activeView).toBe("overview");

    store.setActiveView("members");
    expect(store.activeView).toBe("members");

    store.currentUser = null;
    store.setActiveView("inbox");
    expect(store.activeView).toBe("overview");
  });

  it("normalizes unauthorized active views after role changes", () => {
    const store = useAuthStore();
    store.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    store.activeView = "admin";
    store.currentUser = {
      id: 2,
      username: "member",
      fullName: "Member",
      roles: ["Member"]
    };
    store.ensureAuthorizedActiveView();
    expect(store.activeView).toBe("overview");
  });
});
