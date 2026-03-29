import { defineStore } from "pinia";
import { createApiClient } from "../api/client";
import type { SessionUser } from "../types";

type ActiveView =
  | "overview"
  | "members"
  | "faces"
  | "content"
  | "analytics"
  | "dashboards"
  | "reports"
  | "inbox"
  | "admin";

interface AuthState {
  currentUser: SessionUser | null;
  sessionSecret: string | null;
  hasPin: boolean;
  warmLockMinutes: number;
  sessionTimeoutMinutes: number;
  loading: boolean;
  error: string | null;
  bootstrapRequired: boolean;
  stationToken: string;
  activeView: ActiveView;
  warmLocked: boolean;
}

const initialStationToken = window.localStorage.getItem("sentinelfit.stationToken") ?? "";

const canAccessView = (user: SessionUser | null, view: ActiveView) => {
  if (!user) {
    return false;
  }

  const roles = new Set(user.roles);
  const isAdmin = roles.has("Administrator");
  const isCoachOrAdmin = isAdmin || roles.has("Coach");
  const isMember = roles.has("Member");

  if (view === "overview" || view === "inbox") {
    return true;
  }
  if (view === "members" || view === "content" || view === "analytics") {
    return isCoachOrAdmin;
  }
  if (view === "faces") {
    return isCoachOrAdmin || isMember;
  }
  if (view === "dashboards" || view === "reports" || view === "admin") {
    return isAdmin;
  }

  return false;
};

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    currentUser: null,
    sessionSecret: null,
    hasPin: false,
    warmLockMinutes: 5,
    sessionTimeoutMinutes: 30,
    loading: false,
    error: null,
    bootstrapRequired: false,
    stationToken: initialStationToken,
    activeView: "overview",
    warmLocked: false
  }),
  actions: {
    api() {
      return createApiClient(() => this.sessionSecret, () => this.stationToken);
    },

    canAccessView(view: ActiveView) {
      return canAccessView(this.currentUser, view);
    },

    ensureAuthorizedActiveView() {
      if (!canAccessView(this.currentUser, this.activeView)) {
        this.activeView = "overview";
      }
    },

    async bootstrap() {
      this.loading = true;
      this.error = null;
      try {
        const restored = await this.api().restoreSession();
        const { session } = restored;
        if (session) {
          this.currentUser = null;
          this.sessionSecret = null;
          this.hasPin = false;
          this.warmLockMinutes = session.warmLockMinutes;
          this.sessionTimeoutMinutes = session.sessionTimeoutMinutes;
        }

        if (restored.warmLocked && restored.currentUser && restored.hasPin) {
          this.currentUser = restored.currentUser;
          this.sessionSecret = null;
          this.hasPin = restored.hasPin;
          this.warmLockMinutes = restored.warmLockMinutes;
          this.sessionTimeoutMinutes = restored.sessionTimeoutMinutes;
          this.bootstrapRequired = false;
          this.warmLocked = true;
          this.ensureAuthorizedActiveView();
          return;
        }

        const bootstrap = await this.api().getBootstrapStatus();
        this.bootstrapRequired = bootstrap.requiresBootstrap;
        this.currentUser = null;
        this.sessionSecret = null;
        this.warmLocked = false;
        this.activeView = "overview";
      } catch (error) {
        this.currentUser = null;
        this.sessionSecret = null;
        this.warmLocked = false;
        this.activeView = "overview";
        try {
          const bootstrap = await this.api().getBootstrapStatus();
          this.bootstrapRequired = bootstrap.requiresBootstrap;
        } catch {
          this.error = error instanceof Error ? error.message : "Failed to restore session";
        }
      } finally {
        this.loading = false;
      }
    },

    async bootstrapAdministrator(username: string, fullName: string, password: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await this.api().bootstrapAdministrator({ username, fullName, password });
        this.currentUser = result.currentUser;
        this.sessionSecret = result.sessionSecret;
        this.hasPin = result.hasPin;
        this.warmLockMinutes = result.warmLockMinutes;
        this.sessionTimeoutMinutes = result.sessionTimeoutMinutes;
        this.bootstrapRequired = false;
        this.warmLocked = false;
        this.ensureAuthorizedActiveView();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Bootstrap failed";
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async login(username: string, password: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await this.api().login({ username, password });
        this.currentUser = result.currentUser;
        this.sessionSecret = result.sessionSecret;
        this.hasPin = result.hasPin;
        this.warmLockMinutes = result.warmLockMinutes;
        this.sessionTimeoutMinutes = result.sessionTimeoutMinutes;
        this.bootstrapRequired = false;
        this.warmLocked = false;
        this.ensureAuthorizedActiveView();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Login failed";
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async setupPin(pin: string) {
      await this.api().setupPin(pin);
      this.hasPin = true;
    },

    async reenterWithPin(pin: string) {
      if (!this.currentUser) {
        throw new Error("User context is missing");
      }

      const result = await this.api().pinReenter({
        username: this.currentUser.username,
        pin
      });
      this.currentUser = result.currentUser;
      this.sessionSecret = result.sessionSecret;
      this.hasPin = result.hasPin;
      this.warmLockMinutes = result.warmLockMinutes;
      this.sessionTimeoutMinutes = result.sessionTimeoutMinutes;
      this.warmLocked = false;
      this.ensureAuthorizedActiveView();
    },

    async logout() {
      await this.api().logout();
      this.currentUser = null;
      this.sessionSecret = null;
      this.hasPin = false;
      this.warmLocked = false;
      this.activeView = "overview";
    },

    setStationToken(value: string) {
      this.stationToken = value;
      window.localStorage.setItem("sentinelfit.stationToken", value);
    },

    setActiveView(view: ActiveView) {
      if (!canAccessView(this.currentUser, view)) {
        this.activeView = "overview";
        return;
      }
      this.activeView = view;
    },

    async triggerWarmLock() {
      if (this.currentUser && this.hasPin) {
        try {
          await this.api().warmLock();
          this.sessionSecret = null;
          this.warmLocked = true;
        } catch (error) {
          await this.logout();
          throw error;
        }
      }
    }
  }
});
