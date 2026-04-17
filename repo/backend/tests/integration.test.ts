import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/services/auth-service.js";
import { createContentService } from "../src/services/content-service.js";
import { createDashboardService } from "../src/services/dashboard-service.js";
import { createLoggingService } from "../src/services/logging-service.js";
import { createSignaturePayload, signPayload } from "../src/security.js";
import type { Database } from "../src/database.js";
import { baseConfig } from "./test-helpers.js";
import type { RowDataPacket } from "mysql2/promise";

const stubCryptoService = {
  encrypt: vi.fn(async (value: string) => ({
    keyId: "key-1",
    cipherText: Buffer.from(value, "utf8").toString("base64")
  })),
  decrypt: vi.fn(async ({ cipherText }: { cipherText: string }) =>
    Buffer.from(cipherText, "base64").toString("utf8")
  ),
  encryptBytes: vi.fn(async (value: Buffer) => ({
    keyId: "key-1",
    cipherText: value.toString("base64")
  })),
  decryptBytes: vi.fn(async ({ cipherText }: { cipherText: string }) =>
    Buffer.from(cipherText, "base64")
  ),
  hashForComparison: vi.fn((value: string) => `hash:${value}`),
  maskPhone: vi.fn((phone: string | null) => {
    if (!phone) {
      return null;
    }
    const last4 = phone.replace(/\D/g, "").slice(-4);
    return last4 ? `***-***-${last4}` : "***";
  })
};

interface RecordedCall {
  sql: string;
  params: unknown[];
}

const buildCapturingDatabase = (overrides: Record<string, unknown> = {}) => {
  const calls: RecordedCall[] = [];
  const queryHandlers: Array<(sql: string, params: unknown[]) => unknown[] | null> = [];
  const executeHandlers: Array<(sql: string, params: unknown[]) => boolean> = [];

  const query = async <T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> => {
    calls.push({ sql, params });
    for (const handler of queryHandlers) {
      const result = handler(sql, params);
      if (result !== null) {
        return result as unknown as T;
      }
    }
    return [] as unknown as T;
  };

  const execute = async (sql: string, params: unknown[] = []): Promise<void> => {
    calls.push({ sql, params });
    for (const handler of executeHandlers) {
      if (handler(sql, params)) {
        return;
      }
    }
  };

  const database = {
    pool: {} as Database["pool"],
    query,
    execute,
    async executeInTransaction<T>(callback: (connection: unknown) => Promise<T>) {
      const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql: string, params?: unknown[]) => [await query(sql, params ?? [])],
        execute: async (sql: string, params?: unknown[]) => {
          await execute(sql, params ?? []);
        }
      };
      return callback(connection);
    },
    close: vi.fn(),
    ping: vi.fn(async () => true),
    initialize: vi.fn(),
    ...overrides
  } as unknown as Database;

  return {
    database,
    calls,
    onQuery: (handler: (sql: string, params: unknown[]) => unknown[] | null) => {
      queryHandlers.push(handler);
    },
    onExecute: (handler: (sql: string, params: unknown[]) => boolean) => {
      executeHandlers.push(handler);
    }
  };
};

const buildStubServices = () => ({
  memberService: {
    listMembers: vi.fn(async () => []),
    listCoaches: vi.fn(async () => []),
    createMember: vi.fn(async () => ({ id: 0 })),
    assignCoach: vi.fn(async () => ({ id: 0 })),
    recordFaceConsent: vi.fn(async () => ({ id: 0 })),
    getMember: vi.fn(async () => ({ id: 0 })),
    assertActorCanAccessMember: vi.fn(async () => {}),
    listRecipients: vi.fn(async () => []),
    assignCoachLocation: vi.fn(async () => ({ coachUserId: 0, locationCode: "", isActive: true })),
    listCoachLocations: vi.fn(async () => [])
  },
  faceService: {
    startLivenessChallenge: vi.fn(async () => ({})),
    previewDedup: vi.fn(async () => ({ duplicateWarning: null, warningDetected: false })),
    enrollFace: vi.fn(async () => ({ faceRecordId: 0 })),
    deactivateFace: vi.fn(async () => {}),
    getFaceHistory: vi.fn(async () => []),
    getAuditTrail: vi.fn(async () => []),
    hardenStoredArtifacts: vi.fn(async () => {})
  },
  contentService: {
    listPosts: vi.fn(async () => []),
    createPost: vi.fn(async () => ({ id: 0 })),
    recordView: vi.fn(async () => {}),
    recordSearch: vi.fn(async () => {}),
    analytics: vi.fn(async () => ({ viewsByStation: [], topPosts: [], searchTrends: [], posts: [] }))
  },
  dashboardService: {
    getLayout: vi.fn(async () => []),
    saveLayout: vi.fn(async () => []),
    createTemplate: vi.fn(async () => ({ id: 0, name: "" })),
    listTemplates: vi.fn(async () => [])
  },
  reportService: {
    createSchedule: vi.fn(async () => ({ id: 0 })),
    loadSchedules: vi.fn(async () => {}),
    generateNow: vi.fn(async () => ({ exportId: 0 })),
    listInbox: vi.fn(async () => []),
    listSchedules: vi.fn(async () => []),
    getInboxDownload: vi.fn(async () => ({ filePath: process.execPath, fileName: "node" })),
    listRecipients: vi.fn(async () => [])
  },
  opsService: {
    registerBackgroundJobs: vi.fn(async () => {}),
    getConsoleOverview: vi.fn(async () => ({
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
    })),
    createBackupNow: vi.fn(async () => ({ id: 0 })),
    dryRunRestore: vi.fn(async () => ({ status: "passed" }))
  }
});

describe("integration: real auth-service bootstrap path", () => {
  beforeEach(() => {
    for (const fn of Object.values(stubCryptoService)) {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as { mockClear: () => void }).mockClear();
      }
    }
  });

  it("reports requiresBootstrap=true when no administrator role exists", async () => {
    const harness = buildCapturingDatabase();
    harness.onQuery((sql) => {
      if (sql.includes("user_roles") && sql.includes("Administrator")) {
        return [{ total: 0 }];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs
    } as never);

    const response = await request(app)
      .get("/api/auth/bootstrap/status")
      .set("x-station-token", "Front-Desk-01");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.requiresBootstrap).toBe(true);
    const sqlTouched = harness.calls.some(
      (call) => call.sql.includes("user_roles") && call.sql.includes("Administrator")
    );
    expect(sqlTouched).toBe(true);
  });

  it("reports requiresBootstrap=false when an administrator already exists", async () => {
    const harness = buildCapturingDatabase();
    harness.onQuery((sql) => {
      if (sql.includes("user_roles") && sql.includes("Administrator")) {
        return [{ total: 1 }];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs
    } as never);

    const response = await request(app)
      .get("/api/auth/bootstrap/status")
      .set("x-station-token", "Front-Desk-01");

    expect(response.status).toBe(200);
    expect(response.body.data.requiresBootstrap).toBe(false);
  });

  it("rejects password logins with a missing user and records the failed attempt", async () => {
    const harness = buildCapturingDatabase();
    harness.onQuery((sql) => {
      if (sql.includes("FROM failed_login_attempts")) {
        return [{ failures: 0 }];
      }
      if (sql.includes("FROM users")) {
        return [];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs
    } as never);

    const response = await request(app)
      .post("/api/auth/login")
      .set("x-station-token", "Front-Desk-01")
      .send({ username: "ghost", password: "NotRealPass!123" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_credentials");
    const recordedFailure = harness.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO failed_login_attempts") && Array.isArray(call.params) && call.params[0] === "ghost"
    );
    expect(recordedFailure).toBe(true);
  });
});

describe("integration: real requireSignedSession wiring with a live auth-service session", () => {
  it("lets signed requests through when the DB returns a matching active session", async () => {
    const sessionToken = "integration-session-token";
    const sessionSecret = Buffer.alloc(32, 7).toString("base64");
    const workstationBindingToken = "integration-binding";
    const harness = buildCapturingDatabase();
    harness.onQuery((sql, params) => {
      if (sql.includes("FROM sessions") && sql.includes("WHERE session_token = ?")) {
        if (params[0] === stubCryptoService.hashForComparison(sessionToken)) {
          return [
            {
              id: 1,
              user_id: 1,
              session_token: stubCryptoService.hashForComparison(sessionToken),
              session_secret: Buffer.from(sessionSecret, "utf8").toString("base64"),
              session_secret_key_id: "key-1",
              station_token: "Front-Desk-01",
              workstation_binding_hash: stubCryptoService.hashForComparison(workstationBindingToken),
              warm_locked_at: null,
              last_activity_at: new Date(),
              created_at: new Date(),
              revoked_at: null
            }
          ];
        }
        return [];
      }
      if (sql.includes("FROM users") && sql.includes("WHERE id = ?")) {
        return [
          {
            id: 1,
            username: "admin",
            full_name: "System Administrator",
            password_hash: "unused",
            active: 1
          }
        ];
      }
      if (sql.includes("FROM pin_credentials")) {
        return [];
      }
      if (sql.includes("FROM user_roles")) {
        return [{ role_name: "Administrator" }];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs
    } as never);

    const timestamp = new Date().toISOString();
    const nonce = `nonce-${Math.random().toString(16).slice(2)}`;
    const signature = signPayload(
      sessionSecret,
      createSignaturePayload("GET", "/api/admin/console", timestamp, nonce, undefined)
    );

    const response = await request(app)
      .get("/api/admin/console")
      .set({
        Cookie: `sf_session=${sessionToken}; sf_workstation=${workstationBindingToken}`,
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": timestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": signature
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(stubs.opsService.getConsoleOverview).toHaveBeenCalled();
    const sessionQueryRan = harness.calls.some(
      (call) => call.sql.includes("FROM sessions") && call.sql.includes("WHERE session_token = ?")
    );
    expect(sessionQueryRan).toBe(true);
  });

  it("rejects signed requests when the DB returns no matching session", async () => {
    const harness = buildCapturingDatabase();
    harness.onQuery((sql) => {
      if (sql.includes("FROM sessions")) {
        return [];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs
    } as never);

    const sessionSecret = Buffer.alloc(32, 1).toString("base64");
    const timestamp = new Date().toISOString();
    const nonce = "nonce-integration-rejected";
    const signature = signPayload(
      sessionSecret,
      createSignaturePayload("GET", "/api/admin/console", timestamp, nonce, undefined)
    );

    const response = await request(app)
      .get("/api/admin/console")
      .set({
        Cookie: "sf_session=unknown; sf_workstation=unknown",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": timestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": signature
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_session");
  });
});

const buildAdminSignedApp = () => {
  const sessionToken = "dashboard-integration-session";
  const sessionSecret = Buffer.alloc(32, 5).toString("base64");
  const workstationBindingToken = "dashboard-integration-binding";
  const harness = buildCapturingDatabase();

  harness.onQuery((sql, params) => {
    if (sql.includes("FROM sessions") && sql.includes("WHERE session_token = ?")) {
      if (params[0] === stubCryptoService.hashForComparison(sessionToken)) {
        return [
          {
            id: 77,
            user_id: 42,
            session_token: stubCryptoService.hashForComparison(sessionToken),
            session_secret: Buffer.from(sessionSecret, "utf8").toString("base64"),
            session_secret_key_id: "key-1",
            station_token: "Integration-Desk",
            workstation_binding_hash: stubCryptoService.hashForComparison(workstationBindingToken),
            warm_locked_at: null,
            last_activity_at: new Date(),
            created_at: new Date(),
            revoked_at: null
          }
        ];
      }
      return [];
    }
    if (sql.includes("FROM users") && sql.includes("WHERE id = ?")) {
      return [
        {
          id: 42,
          username: "admin",
          full_name: "System Administrator",
          password_hash: "unused",
          active: 1
        }
      ];
    }
    if (sql.includes("FROM pin_credentials")) {
      return [];
    }
    if (sql.includes("FROM user_roles")) {
      return [{ role_name: "Administrator" }];
    }
    return null;
  });

  return { harness, sessionToken, sessionSecret, workstationBindingToken };
};

const attachSignedHeaders = (
  req: request.Test,
  sessionSecret: string,
  sessionToken: string,
  workstationBindingToken: string,
  method: string,
  path: string,
  body?: unknown
) => {
  const timestamp = new Date().toISOString();
  const nonce = `nonce-${Math.random().toString(16).slice(2)}`;
  const signature = signPayload(
    sessionSecret,
    createSignaturePayload(method, path, timestamp, nonce, body)
  );

  return req
    .set({
      Cookie: `sf_session=${sessionToken}; sf_workstation=${workstationBindingToken}`,
      "x-station-token": "Integration-Desk",
      "x-sf-timestamp": timestamp,
      "x-sf-nonce": nonce,
      "x-sf-signature": signature
    });
};

describe("integration: real createDashboardService on the signed admin path", () => {
  it("GET /api/dashboards/me returns the defaultLayout when no row exists in dashboard_layouts", async () => {
    const { harness, sessionSecret, sessionToken, workstationBindingToken } = buildAdminSignedApp();

    harness.onQuery((sql) => {
      if (sql.includes("FROM dashboard_layouts")) {
        return [];
      }
      if (sql.includes("FROM report_templates")) {
        return [];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const dashboardService = createDashboardService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs,
      dashboardService
    } as never);

    const response = await attachSignedHeaders(
      request(app).get("/api/dashboards/me"),
      sessionSecret,
      sessionToken,
      workstationBindingToken,
      "GET",
      "/api/dashboards/me"
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const layout = response.body.data.layout as Array<{ widgetType: string; title: string }>;
    expect(Array.isArray(layout)).toBe(true);
    expect(layout.map((w) => w.widgetType)).toEqual(
      expect.arrayContaining(["viewsByStation", "topPosts", "searchTrends"])
    );
    const executedLayoutRead = harness.calls.some((call) =>
      call.sql.includes("FROM dashboard_layouts")
    );
    expect(executedLayoutRead).toBe(true);
  });

  it("PUT /api/dashboards/me persists a new layout via INSERT ... ON DUPLICATE KEY UPDATE", async () => {
    const { harness, sessionSecret, sessionToken, workstationBindingToken } = buildAdminSignedApp();

    const savedPayloads: string[] = [];
    harness.onExecute((sql, params) => {
      if (sql.includes("INSERT INTO dashboard_layouts")) {
        savedPayloads.push(String(params[1] ?? ""));
        return true;
      }
      return false;
    });

    harness.onQuery((sql) => {
      if (sql.includes("FROM dashboard_layouts")) {
        return [
          {
            layout_json: JSON.stringify(savedPayloads.length > 0 ? JSON.parse(savedPayloads[savedPayloads.length - 1]) : [])
          }
        ];
      }
      if (sql.includes("FROM report_templates")) {
        return [];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const dashboardService = createDashboardService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs,
      dashboardService
    } as never);

    const body = {
      layout: [
        { id: "members", widgetType: "members", title: "Members", x: 0, y: 0, width: 2, height: 2 }
      ]
    };
    const response = await attachSignedHeaders(
      request(app).put("/api/dashboards/me").send(body),
      sessionSecret,
      sessionToken,
      workstationBindingToken,
      "PUT",
      "/api/dashboards/me",
      body
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(savedPayloads).toHaveLength(1);
    const saved = JSON.parse(savedPayloads[0]);
    expect(saved).toEqual([
      expect.objectContaining({ id: "members", widgetType: "members", title: "Members" })
    ]);
  });

  it("POST /api/dashboards/templates persists the template row and returns a decoded layout", async () => {
    const { harness, sessionSecret, sessionToken, workstationBindingToken } = buildAdminSignedApp();

    const savedTemplates: Array<{ name: string; layoutJson: string; createdByUserId: number }> = [];
    harness.onExecute((sql, params) => {
      if (sql.includes("INSERT INTO report_templates")) {
        savedTemplates.push({
          name: String(params[0] ?? ""),
          layoutJson: String(params[1] ?? ""),
          createdByUserId: Number(params[2] ?? 0)
        });
        return true;
      }
      return false;
    });

    harness.onQuery((sql) => {
      if (sql.includes("FROM report_templates") && sql.includes("created_by_user_id = ?")) {
        const latest = savedTemplates[savedTemplates.length - 1];
        if (!latest) {
          return [];
        }
        return [
          {
            id: 501,
            name: latest.name,
            layout_json: latest.layoutJson,
            created_at: new Date()
          }
        ];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const dashboardService = createDashboardService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs,
      dashboardService
    } as never);

    const body = {
      name: "Integration Template",
      layout: [{ id: "one", widgetType: "members", title: "Members", x: 0, y: 0, width: 2, height: 2 }]
    };
    const response = await attachSignedHeaders(
      request(app).post("/api/dashboards/templates").send(body),
      sessionSecret,
      sessionToken,
      workstationBindingToken,
      "POST",
      "/api/dashboards/templates",
      body
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.template.id).toBe(501);
    expect(response.body.data.template.name).toBe("Integration Template");
    expect(response.body.data.template.layout).toEqual([
      expect.objectContaining({ id: "one", widgetType: "members" })
    ]);
    expect(savedTemplates).toHaveLength(1);
    expect(savedTemplates[0].createdByUserId).toBe(42);
  });
});

describe("integration: real createContentService on the signed admin path", () => {
  it("GET /api/content/posts returns decoded rows produced by the real service", async () => {
    const { harness, sessionSecret, sessionToken, workstationBindingToken } = buildAdminSignedApp();

    harness.onQuery((sql) => {
      if (sql.includes("FROM content_posts")) {
        return [
          {
            id: 9,
            kind: "tip",
            title: "Mobility",
            body: "Stretch your hips before squats",
            location_code: "HQ",
            author_name: "Default Coach",
            created_at: new Date("2026-04-10T12:00:00Z")
          }
        ];
      }
      return null;
    });

    const authService = createAuthService(harness.database, baseConfig, stubCryptoService as never);
    const loggingService = createLoggingService(harness.database);
    const contentService = createContentService(harness.database);
    const stubs = buildStubServices();

    const app = createApp(baseConfig, harness.database, {
      authService,
      loggingService,
      ...stubs,
      contentService
    } as never);

    const response = await attachSignedHeaders(
      request(app).get("/api/content/posts"),
      sessionSecret,
      sessionToken,
      workstationBindingToken,
      "GET",
      "/api/content/posts"
    );

    expect(response.status).toBe(200);
    const posts = response.body.data.posts as Array<{
      id: number;
      title: string;
      kind: string;
      locationCode: string;
      authorName: string;
    }>;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual(
      expect.objectContaining({
        id: 9,
        title: "Mobility",
        kind: "tip",
        locationCode: "HQ",
        authorName: "Default Coach"
      })
    );
  });
});
