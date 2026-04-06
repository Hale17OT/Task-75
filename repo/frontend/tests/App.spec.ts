import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import App from "../src/App.vue";
import { useAuthStore } from "../src/stores/auth";

describe("App", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("crypto", webcrypto as unknown as Crypto);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "123e4567-e89b-12d3-a456-426614174001"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/auth/bootstrap/status")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                requiresBootstrap: false
              }
            })
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              session: null,
              warmLocked: false,
              currentUser: null,
              hasPin: false,
              warmLockMinutes: 5,
              sessionTimeoutMinutes: 30,
              lastActivityAt: null
            }
          })
        });
      })
    );
  });

  it("renders the sign-in shell when no session is active", async () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()]
      }
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Offline Operations Control Center");
    expect(wrapper.text()).toContain("Operator sign-in");
  });

  it("can warm-lock the current session when a PIN exists", async () => {
    const store = useAuthStore();
    store.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    store.sessionSecret = "secret";
    store.hasPin = true;

    await store.triggerWarmLock();

    expect(store.warmLocked).toBe(true);
    expect(store.sessionSecret).toBeNull();
  });

  it("resets protected view state when switching from admin to coach on the same workstation", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (url.includes("/api/auth/bootstrap/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              requiresBootstrap: false
            }
          })
        });
      }

      if (url.includes("/api/auth/login") && method === "POST") {
        if (body?.username === "admin") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                currentUser: {
                  id: 1,
                  username: "admin",
                  fullName: "System Administrator",
                  roles: ["Administrator", "Coach", "Member"]
                },
                sessionSecret: btoa("admin-secret-admin-secret-admin-secret!!"),
                hasPin: false,
                warmLockMinutes: 5,
                sessionTimeoutMinutes: 30
              }
            })
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              currentUser: {
                id: 2,
                username: "coach",
                fullName: "Default Coach",
                roles: ["Coach"]
              },
              sessionSecret: btoa("coach-secret-coach-secret-coach-secret!!"),
              hasPin: false,
              warmLockMinutes: 5,
              sessionTimeoutMinutes: 30
            }
          })
        });
      }

      if (url.includes("/api/auth/logout") && method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              loggedOut: true
            }
          })
        });
      }

      if (url.includes("/api/reports/schedules")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              schedules: []
            }
          })
        });
      }

      if (url.includes("/api/reports/recipients")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              recipients: []
            }
          })
        });
      }

      if (url.includes("/api/reports/inbox")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              inbox: []
            }
          })
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: {}
        })
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()]
      }
    });
    await flushPromises();

    const store = useAuthStore();

    await store.login("admin", "Admin12345!X");
    await flushPromises();
    store.setActiveView("reports");
    await flushPromises();

    expect(wrapper.text()).toContain("Scheduled reporting");
    expect(store.activeView).toBe("reports");

    await store.logout();
    await flushPromises();

    store.activeView = "reports";
    await store.login("coach", "Coach12345!X");
    await flushPromises();

    expect(store.activeView).toBe("overview");
    expect(wrapper.text()).not.toContain("Scheduled reporting");
    const hasReportsButton = wrapper
      .findAll("button")
      .some((buttonWrapper) => buttonWrapper.text().trim() === "Reports");
    expect(hasReportsButton).toBe(false);
  });

  it("falls back to overview when a coach forces an unauthorized admin view", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (url.includes("/api/auth/bootstrap/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              requiresBootstrap: false
            }
          })
        });
      }

      if (url.includes("/api/auth/login") && method === "POST") {
        if (body?.username === "coach") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                currentUser: {
                  id: 2,
                  username: "coach",
                  fullName: "Default Coach",
                  roles: ["Coach"]
                },
                sessionSecret: btoa("coach-secret-coach-secret-coach-secret!!"),
                hasPin: false,
                warmLockMinutes: 5,
                sessionTimeoutMinutes: 30
              }
            })
          });
        }
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: {}
        })
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()]
      }
    });
    await flushPromises();

    const store = useAuthStore();
    await store.login("coach", "Coach12345!X");
    await flushPromises();

    store.activeView = "admin";
    await flushPromises();

    expect(store.activeView).toBe("overview");
    expect(wrapper.text()).not.toContain("Admin console");
    expect(wrapper.text()).toContain("Operational snapshot");
  });

  it("does not request self profile on overview for admin sessions without a member profile", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/auth/bootstrap/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              requiresBootstrap: false
            }
          })
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            session: null
          }
        })
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    mount(App, {
      global: {
        plugins: [createPinia()]
      }
    });
    await flushPromises();

    const store = useAuthStore();
    store.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator", "Coach", "Member"],
      hasMemberProfile: false
    };
    store.sessionSecret = "secret";
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/self/profile"),
      expect.anything()
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/self/profile"))).toBe(false);
  });
});
