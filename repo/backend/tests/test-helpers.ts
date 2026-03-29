import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import type { Database } from "../src/database.js";

export const baseConfig = loadConfig({
  NODE_ENV: "test",
  PORT: "3000",
  ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
  MYSQL_HOST: "mysql",
  MYSQL_PORT: "3306",
  MYSQL_DATABASE: "sentinelfit",
  MYSQL_USER: "sentinelfit",
  MYSQL_PASSWORD: "sentinelfit",
  KEY_VAULT_MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
});

export const createStubDatabase = (healthy = true): Database =>
  ({
    pool: {} as Database["pool"],
    async query() {
      return [] as never;
    },
    async execute() {},
    async executeInTransaction<T>(callback: (connection: never) => Promise<T>) {
      return callback({} as never);
    },
    async close() {},
    async ping() {
      return healthy;
    },
    async initialize() {}
  }) as Database;

export const createStubApp = (config: AppConfig = baseConfig, database = createStubDatabase()) =>
  createApp(config, database, {
    authService: {
      async getBootstrapStatus() {
        return { requiresBootstrap: false };
      },
      async bootstrapAdministrator() {
        throw new Error("unused");
      },
      async login() {
        throw new Error("unused");
      },
      async setupPin() {},
      async reenterWithPin() {
        throw new Error("unused");
      },
      async restoreSession() {
        return null;
      },
      async warmLockSession() {},
      async logout() {},
      async getSession() {
        return null;
      },
      async assertWorkstationBinding() {},
      async hardenStoredSessions() {},
      async assertSessionActive() {
        throw new Error("unused");
      },
      async touchSession() {}
    },
    loggingService: {
      async log() {},
      async alert() {},
      async access() {}
    },
    memberService: {
      async listMembers() {
        return [];
      },
      async listCoaches() {
        return [];
      },
      async createMember() {
        throw new Error("unused");
      },
      async assignCoach() {
        throw new Error("unused");
      },
      async recordFaceConsent() {
        throw new Error("unused");
      },
      async getMember() {
        throw new Error("unused");
      },
      async assertActorCanAccessMember() {},
      async listRecipients() {
        return [];
      },
      async assignCoachLocation() {
        throw new Error("unused");
      },
      async listCoachLocations() {
        return [];
      }
    },
    faceService: {
      async startLivenessChallenge() {
        return {
          challengeId: "challenge-1",
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          minDelayMs: 1000,
          maxDelayMs: 30_000
        };
      },
      async previewDedup() {
        return {
          duplicateWarning: {
            memberUserId: 0,
            status: "active",
            similarity: 0
          },
          warningDetected: false
        };
      },
      async enrollFace() {
        throw new Error("unused");
      },
      async deactivateFace() {},
      async getFaceHistory() {
        return [];
      },
      async getAuditTrail() {
        return [];
      },
      async hardenStoredArtifacts() {
        return;
      }
    },
    contentService: {
      async writeSystemLogInTransaction() {},
      async getAuthorizedLocations() {
        return null;
      },
      async assertLocationAllowed() {},
      async createPost() {
        throw new Error("unused");
      },
      async listPosts() {
        return [];
      },
      async recordView() {},
      async recordSearch() {},
      async analytics() {
        return {
          viewsByStation: [],
          topPosts: [],
          searchTrends: [],
          posts: []
        };
      }
    },
    dashboardService: {
      async getLayout() {
        return [];
      },
      async saveLayout() {
        return [];
      },
      async createTemplate() {
        throw new Error("unused");
      },
      async listTemplates() {
        return [];
      }
    },
    reportService: {
      async createSchedule() {
        throw new Error("unused");
      },
      async loadSchedules() {},
      async generateNow() {
        throw new Error("unused");
      },
      async listInbox() {
        return [];
      },
      async listSchedules() {
        return [];
      },
      async getInboxDownload() {
        throw new Error("unused");
      },
      async listRecipients() {
        return [];
      }
    },
    opsService: {
      async registerBackgroundJobs() {},
      async getConsoleOverview() {
        return {
          metrics: {
            totalLogs: 0,
            openAlerts: 0,
            uptimeSeconds: 0,
            averageRequestDurationMs: 0,
            serverErrorRate: 0,
            lastReportDurationMs: 0,
            lastBackupDurationMs: 0
          },
          recentLogs: [],
          recentAlerts: []
        };
      },
      async createBackupNow() {
        throw new Error("unused");
      },
      async dryRunRestore() {
        throw new Error("unused");
      }
    }
  });
