import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Database } from "../src/database.js";
import { AppError } from "../src/errors.js";
import { createSignaturePayload, signPayload } from "../src/security.js";
import { baseConfig, createStubDatabase } from "./test-helpers.js";

const createNonceAwareDatabase = (): Database => {
  const base = createStubDatabase(true);
  const nonceExpirations = new Map<string, number>();
  return {
    ...base,
    async execute(sql: string, params: unknown[] = []) {
      if (sql.includes("DELETE FROM request_nonces")) {
        const now = Date.now();
        for (const [key, expiresAt] of nonceExpirations.entries()) {
          if (expiresAt <= now) {
            nonceExpirations.delete(key);
          }
        }
        return;
      }

      if (sql.includes("INSERT INTO request_nonces")) {
        const sessionTokenHash = String(params[0] ?? "");
        const nonce = String(params[1] ?? "");
        const ttlSeconds = Number(params[2] ?? 0);
        const key = `${sessionTokenHash}:${nonce}`;
        const now = Date.now();
        const existing = nonceExpirations.get(key);
        if (existing && existing > now) {
          const duplicateError = new Error("Duplicate nonce");
          (duplicateError as { code?: string }).code = "ER_DUP_ENTRY";
          throw duplicateError;
        }
        nonceExpirations.set(key, now + ttlSeconds * 1000);
        return;
      }

      await base.execute(sql, params);
    }
  };
};

const createServices = (options?: {
  roles?: Array<"Member" | "Coach" | "Administrator">;
  config?: typeof baseConfig;
  database?: Database;
}) => {
  const sessionSecret = Buffer.alloc(32, 9).toString("base64");
  const roles = options?.roles ?? ["Administrator", "Coach", "Member"];
  const authService = {
    getBootstrapStatus: vi.fn(async () => ({ requiresBootstrap: false })),
    bootstrapAdministrator: vi.fn(async (username: string, fullName: string) => ({
      currentUser: {
        id: 99,
        username,
        fullName,
        roles: ["Administrator", "Coach", "Member"]
      },
      session: {
        sessionToken: "bootstrap-session-token",
        sessionSecret
      },
      workstationBindingToken: "bootstrap-binding-token",
      sessionTimeoutMinutes: 30,
      warmLockMinutes: 5,
      hasPin: false
    })),
    login: vi.fn(async () => ({
      currentUser: {
        id: 1,
        username: "admin",
        fullName: "System Administrator",
        roles
      },
        session: {
          sessionToken: "session-token",
          sessionSecret
        },
      workstationBindingToken: "binding-token",
      sessionTimeoutMinutes: 30,
      warmLockMinutes: 5,
      hasPin: true
    })),
    setupPin: vi.fn(async () => {}),
    reenterWithPin: vi.fn(async (_username: string, _pin: string, sessionToken?: string) => {
      if (!sessionToken) {
        throw new AppError(401, "missing_session", "A warm workstation session is required for PIN re-entry");
      }

      return {
        currentUser: {
          id: 1,
          username: "admin",
          fullName: "System Administrator",
          roles
        },
        session: {
          sessionToken: "new-session-token",
          sessionSecret
        },
        workstationBindingToken: "binding-token",
        sessionTimeoutMinutes: 30,
        warmLockMinutes: 5,
        hasPin: true
      };
    }),
    logout: vi.fn(async () => {}),
    warmLockSession: vi.fn(async () => {}),
    hardenStoredSessions: vi.fn(async () => {}),
    restoreSession: vi.fn(async (sessionToken?: string, workstationBindingToken?: string): Promise<unknown> => {
      if (sessionToken !== "session-token" || workstationBindingToken !== "binding-token") {
        return null;
      }

      return {
        status: "warm_locked",
        currentUser: {
          id: 1,
          username: "admin",
          fullName: "System Administrator",
          roles
        },
        hasPin: true,
        warmLockMinutes: 5,
        sessionTimeoutMinutes: 30,
        lastActivityAt: new Date().toISOString()
      };
    }),
    getSession: vi.fn(async (sessionToken?: string) => {
      if (sessionToken !== "session-token") {
        return null;
      }

      return {
        currentUser: {
          id: 1,
          username: "admin",
          fullName: "System Administrator",
          roles
        },
        session: {
          id: 1,
          userId: 1,
          sessionToken: "session-token",
          sessionSecret,
          sessionSecretKeyId: "key-1",
          stationToken: "Front-Desk-01",
          workstationBindingHash: "hash:binding-token",
          warmLockedAt: null,
          lastActivityAt: new Date(),
          createdAt: new Date(),
          revokedAt: null
        },
        hasPin: true,
        warmLockMinutes: 5,
        sessionTimeoutMinutes: 30
      };
    }),
    assertWorkstationBinding: vi.fn(async () => {}),
    assertSessionActive: vi.fn(async () => ({
      id: 1,
      userId: 1,
      sessionToken: "session-token",
      sessionSecret,
      sessionSecretKeyId: "key-1",
      stationToken: "Front-Desk-01",
      workstationBindingHash: "hash:binding-token",
      warmLockedAt: null,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      revokedAt: null
    })),
    touchSession: vi.fn(async () => {})
  };

  const loggingService = {
    log: vi.fn(async () => {}),
    alert: vi.fn(async () => {}),
    access: vi.fn(async () => {})
  };

  const contentService = {
    createPost: vi.fn(async () => ({ id: 9 })),
    listPosts: vi.fn(async () => [{ id: 9, title: "Mobility", body: "Body", kind: "tip", locationCode: "HQ", authorName: "Coach", createdAt: new Date().toISOString() }]),
    recordView: vi.fn(async () => {}),
    recordSearch: vi.fn(async () => {}),
    analytics: vi.fn(async () => ({ viewsByStation: [], topPosts: [], searchTrends: [], posts: [] }))
  };

  const faceService = {
    startLivenessChallenge: vi.fn(async () => ({
      challengeId: "challenge-1",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      minDelayMs: 1000,
      maxDelayMs: 30000
    })),
    previewDedup: vi.fn(async () => ({ duplicateWarning: null, warningDetected: false })),
    enrollFace: vi.fn(async () => ({ faceRecordId: 5 })),
    deactivateFace: vi.fn(async () => {}),
    getFaceHistory: vi.fn(async () => [{ faceRecordId: 5 }]),
    getAuditTrail: vi.fn(async () => []),
    hardenStoredArtifacts: vi.fn(async () => {})
  };

  const app = createApp(options?.config ?? baseConfig, options?.database ?? createStubDatabase(true), {
    authService: authService as never,
    loggingService: loggingService as never,
    memberService: {
      listMembers: vi.fn(async () => []),
      listCoaches: vi.fn(async () => []),
      createMember: vi.fn(async () => ({ id: 7 })),
      assignCoach: vi.fn(async () => ({ id: 7 })),
      recordFaceConsent: vi.fn(async () => ({ id: 7 })),
      getMember: vi.fn(async () => ({ id: 1 })),
      assertActorCanAccessMember: vi.fn(async () => {}),
      listRecipients: vi.fn(async () => []),
      assignCoachLocation: vi.fn(async () => ({ coachUserId: 2, locationCode: "HQ", isActive: true })),
      listCoachLocations: vi.fn(async () => [{ coachUserId: 2, locationCode: "HQ", isActive: true }])
    } as never,
    faceService: faceService as never,
    contentService: contentService as never,
    dashboardService: {
      getLayout: vi.fn(async () => []),
      saveLayout: vi.fn(async () => []),
      createTemplate: vi.fn(async () => ({ id: 1, name: "Template" })),
      listTemplates: vi.fn(async () => [])
    } as never,
    reportService: {
      createSchedule: vi.fn(async () => ({ id: 1 })),
      loadSchedules: vi.fn(async () => {}),
      generateNow: vi.fn(async () => ({ exportId: 1 })),
      listInbox: vi.fn(async () => [
        {
          id: 11,
          reportExportId: 1,
          title: "Weekly Snapshot (PDF)",
          isRead: false,
          createdAt: new Date().toISOString(),
          format: "pdf",
          status: "completed",
          fileName: "weekly-snapshot.pdf"
        }
      ]),
      listSchedules: vi.fn(async () => []),
      getInboxDownload: vi.fn(async () => ({ filePath: process.execPath, fileName: "node.exe" })),
      listRecipients: vi.fn(async () => [])
    } as never,
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
      createBackupNow: vi.fn(async () => ({ id: 3 })),
      dryRunRestore: vi.fn(async () => ({ status: "passed" }))
    } as never
  });

  return { app, authService, sessionSecret, contentService, faceService };
};

const signedHeaders = (method: string, path: string, secret: string, body?: unknown) => {
  const timestamp = new Date().toISOString();
  const nonce = `nonce-${Math.random().toString(16).slice(2)}`;
  const signature = signPayload(secret, createSignaturePayload(method, path, timestamp, nonce, body));

  return {
    Cookie: "sf_session=session-token; sf_workstation=binding-token",
    "x-station-token": "Front-Desk-01",
    "x-sf-timestamp": timestamp,
    "x-sf-nonce": nonce,
    "x-sf-signature": signature
  };
};

const joinedCookies = (headerValue: string | string[] | undefined) =>
  Array.isArray(headerValue) ? headerValue.join(";") : headerValue ?? "";

describe("route and middleware behavior", () => {
  it("exposes bootstrap status and allows one-time administrator creation", async () => {
    const { app, authService } = createServices();
    authService.getBootstrapStatus.mockResolvedValueOnce({ requiresBootstrap: true });

    const statusResponse = await request(app)
      .get("/api/auth/bootstrap/status")
      .set("x-station-token", "Desk-A");

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data.requiresBootstrap).toBe(true);

    const bootstrapBody = {
      username: "owner",
      fullName: "Facility Owner",
      password: "Owner12345!X"
    };
    const bootstrapResponse = await request(app)
      .post("/api/auth/bootstrap/admin")
      .set("x-station-token", "Desk-A")
      .send(bootstrapBody);

    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.headers["set-cookie"]?.[0]).toContain("sf_session=");
    expect(joinedCookies(bootstrapResponse.headers["set-cookie"])).toContain("sf_workstation=");
    expect(authService.bootstrapAdministrator).toHaveBeenCalledWith(
      "owner",
      "Facility Owner",
      "Owner12345!X",
      "Desk-A"
    );
  });

  it("passes station identity into password login and sets the session cookie", async () => {
    const { app, authService } = createServices();

    const response = await request(app)
      .post("/api/auth/login")
      .set("x-station-token", "Desk-A")
      .send({ username: "admin", password: "Admin12345!X" });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]?.[0]).toContain("sf_session=");
    expect(joinedCookies(response.headers["set-cookie"])).toContain("sf_workstation=");
    expect(authService.login).toHaveBeenCalledWith("admin", "Admin12345!X", expect.any(String), "Desk-A");
  });

  it("rate-limits sign-in per station while allowing another station on the same IP to continue", async () => {
    const { app } = createServices({
      config: {
        ...baseConfig,
        LOGIN_RATE_LIMIT_PER_MINUTE: 2
      }
    });

    await request(app)
      .post("/api/auth/login")
      .set("x-station-token", "Desk-A")
      .send({ username: "admin", password: "Admin12345!X" })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .set("x-station-token", "Desk-A")
      .send({ username: "admin", password: "Admin12345!X" })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .set("x-station-token", "Desk-B")
      .send({ username: "admin", password: "Admin12345!X" })
      .expect(200);

    const limited = await request(app)
      .post("/api/auth/login")
      .set("x-station-token", "Desk-A")
      .send({ username: "admin", password: "Admin12345!X" });

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
  });

  it("rejects PIN re-entry when the warm workstation session cookie is missing", async () => {
    const { app } = createServices();

    const response = await request(app)
      .post("/api/auth/pin/reenter")
      .set("x-station-token", "Desk-A")
      .send({ username: "admin", pin: "1234" });

    expect(response.status).toBe(401);
  });

  it("blocks protected admin routes when request signatures are missing", async () => {
    const { app } = createServices();

    const response = await request(app)
      .get("/api/admin/console")
      .set("Cookie", "sf_session=session-token")
      .set("x-station-token", "Front-Desk-01");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("signature_missing");
  });

  it("rate-limits invalid signature attempts on protected routes", async () => {
    const { app } = createServices({
      config: {
        ...baseConfig,
        AUTH_RATE_LIMIT_PER_MINUTE: 2
      }
    });

    await request(app)
      .get("/api/admin/console")
      .set("Cookie", "sf_session=session-token; sf_workstation=binding-token")
      .set("x-station-token", "Front-Desk-01")
      .expect(401);

    await request(app)
      .get("/api/admin/console")
      .set("Cookie", "sf_session=session-token; sf_workstation=binding-token")
      .set("x-station-token", "Front-Desk-01")
      .expect(401);

    const limited = await request(app)
      .get("/api/admin/console")
      .set("Cookie", "sf_session=session-token; sf_workstation=binding-token")
      .set("x-station-token", "Front-Desk-01");

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
  });

  it("allows protected admin routes when the signed-session headers are valid", async () => {
    const { app, sessionSecret } = createServices();

    const response = await request(app)
      .get("/api/admin/console")
      .set(signedHeaders("GET", "/api/admin/console", sessionSecret));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("rejects protected routes when workstation binding cookie is missing", async () => {
    const { app, sessionSecret, authService } = createServices();
    authService.assertWorkstationBinding.mockRejectedValueOnce(
      new AppError(401, "workstation_binding_required", "A trusted workstation binding is required")
    );
    const timestamp = new Date().toISOString();
    const nonce = "nonce-missing-workstation";

    const response = await request(app)
      .get("/api/admin/console")
      .set({
        Cookie: "sf_session=session-token",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": timestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": signPayload(
          sessionSecret,
          createSignaturePayload("GET", "/api/admin/console", timestamp, nonce, undefined)
        )
      });

    expect(response.status).toBe(401);
  });

  it("rejects protected routes when workstation binding mismatches", async () => {
    const { app, sessionSecret, authService } = createServices();
    authService.assertWorkstationBinding.mockRejectedValueOnce(
      new AppError(403, "pin_context_invalid", "PIN re-entry is only allowed on the bound workstation")
    );

    const response = await request(app)
      .get("/api/admin/console")
      .set(signedHeaders("GET", "/api/admin/console", sessionSecret));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("pin_context_invalid");
  });

  it("restores session state from cookies without requiring signed headers", async () => {
    const { app } = createServices();

    const response = await request(app)
      .get("/api/auth/session")
      .set("Cookie", "sf_session=session-token; sf_workstation=binding-token")
      .set("x-station-token", "Front-Desk-01")
      .expect(200);

    expect(response.body.data.session).toEqual(
      expect.objectContaining({
        warmLocked: false,
        sessionSecret: expect.any(String)
      })
    );
  });

  it("rejects unsigned session-restore attempts when workstation binding is missing", async () => {
    const { app, authService } = createServices();
    authService.assertWorkstationBinding.mockRejectedValueOnce(
      new AppError(401, "workstation_binding_required", "A trusted workstation binding is required")
    );

    const response = await request(app)
      .get("/api/auth/session")
      .set("Cookie", "sf_session=session-token")
      .set("x-station-token", "Front-Desk-01");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("workstation_binding_required");
  });

  it("supports signed session and PIN setup/logout flows", async () => {
    const { app, sessionSecret, authService } = createServices();

    await request(app)
      .get("/api/auth/session")
      .set("Cookie", "sf_session=session-token; sf_workstation=binding-token")
      .set("x-station-token", "Front-Desk-01")
      .expect(200);

    const pinBody = { pin: "1234" };
    await request(app)
      .post("/api/auth/pin/setup")
      .set(signedHeaders("POST", "/api/auth/pin/setup", sessionSecret, pinBody))
      .send(pinBody)
      .expect(200);

    await request(app)
      .post("/api/auth/logout")
      .set(signedHeaders("POST", "/api/auth/logout", sessionSecret))
      .expect(200);

    expect(authService.setupPin).toHaveBeenCalledWith(1, "1234");
    expect(authService.logout).toHaveBeenCalled();
  });

  it("treats stale auth cookies as anonymous state for login and bootstrap status", async () => {
    const { app, authService } = createServices();
    authService.getSession.mockRejectedValue(new AppError(401, "session_expired", "Session expired after inactivity"));

    const statusResponse = await request(app)
      .get("/api/auth/bootstrap/status")
      .set("Cookie", "sf_session=expired-token; sf_workstation=expired-binding")
      .set("x-station-token", "Desk-A");

    expect(statusResponse.status).toBe(200);
    expect(joinedCookies(statusResponse.headers["set-cookie"])).toContain("sf_session=;");

    authService.getSession.mockRejectedValueOnce(new AppError(401, "invalid_session", "Session is not active"));
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .set("Cookie", "sf_session=expired-token; sf_workstation=expired-binding")
      .set("x-station-token", "Desk-A")
      .send({ username: "admin", password: "Admin12345!X" });

    expect(loginResponse.status).toBe(200);
    expect(authService.login).toHaveBeenCalledWith("admin", "Admin12345!X", expect.any(String), "Desk-A");
  });

  it("applies uniform per-IP API rate limits to auth status and session endpoints", async () => {
    const limitedConfig = {
      ...baseConfig,
      API_RATE_LIMIT_PER_MINUTE: 2
    };
    const { app } = createServices({ config: limitedConfig });

    await request(app)
      .get("/api/auth/bootstrap/status")
      .set("x-station-token", "Desk-A")
      .expect(200);

    await request(app)
      .get("/api/auth/session")
      .set("x-station-token", "Desk-A")
      .expect(200);

    const limitedResponse = await request(app)
      .get("/api/auth/bootstrap/status")
      .set("x-station-token", "Desk-A");

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error.code).toBe("rate_limited");
  });

  it("rejects protected API access while the session is warm locked", async () => {
    const { app, sessionSecret, authService } = createServices();
    authService.getSession.mockResolvedValueOnce({
      currentUser: {
        id: 1,
        username: "admin",
        fullName: "System Administrator",
        roles: ["Administrator", "Coach", "Member"]
      },
      session: {
        id: 1,
        userId: 1,
        sessionToken: "session-token",
        sessionSecret,
        sessionSecretKeyId: "key-1",
        stationToken: "Front-Desk-01",
        workstationBindingHash: "hash:binding-token",
        warmLockedAt: new Date() as Date | null,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        revokedAt: null
      },
      hasPin: true,
      warmLockMinutes: 5,
      sessionTimeoutMinutes: 30
    } as never);

    const response = await request(app)
      .get("/api/admin/console")
      .set(signedHeaders("GET", "/api/admin/console", sessionSecret));

    expect(response.status).toBe(423);
    expect(response.body.error.code).toBe("warm_locked");
  });

  it("rejects stale signed timestamps and non-allowlisted IPs", async () => {
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const secret = Buffer.alloc(32, 9).toString("base64");
    const signature = signPayload(secret, createSignaturePayload("GET", "/api/admin/console", staleTimestamp, "nonce-stale", undefined));

    const staleResponse = await request(createServices().app)
      .get("/api/admin/console")
      .set("Cookie", "sf_session=session-token")
      .set("x-station-token", "Front-Desk-01")
      .set("x-sf-timestamp", staleTimestamp)
      .set("x-sf-nonce", "nonce-stale")
      .set("x-sf-signature", signature);

    expect(staleResponse.status).toBe(401);
    expect(staleResponse.body.error.code).toBe("timestamp_stale");

    const restrictedApp = createServices({
      config: {
        ...baseConfig,
        IP_ALLOWLIST: ["10.10.10.10/32"]
      }
    }).app;
    const forbiddenResponse = await request(restrictedApp).get("/");

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.error.code).toBe("ip_forbidden");
  });

  it("enforces role boundaries on administrator-only routes", async () => {
    const { app, sessionSecret } = createServices({
      roles: ["Coach", "Member"]
    });

    const response = await request(app)
      .get("/api/admin/console")
      .set(signedHeaders("GET", "/api/admin/console", sessionSecret));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
  });

  it("allows subscribed non-admin users to access inbox routes while keeping report authoring admin-only", async () => {
    const { app, sessionSecret } = createServices({
      roles: ["Coach", "Member"]
    });

    const inboxResponse = await request(app)
      .get("/api/reports/inbox")
      .set(signedHeaders("GET", "/api/reports/inbox", sessionSecret))
      .expect(200);
    expect(inboxResponse.body.data.inbox[0]).toEqual(
      expect.objectContaining({
        fileName: "weekly-snapshot.pdf"
      })
    );
    expect(inboxResponse.body.data.inbox[0]).not.toHaveProperty("filePath");
    expect(inboxResponse.body.data.inbox[0]).not.toHaveProperty("sharedFilePath");

    await request(app)
      .get("/api/reports/inbox/1/download")
      .set(signedHeaders("GET", "/api/reports/inbox/1/download", sessionSecret))
      .expect(200);

    await request(app)
      .get("/api/reports/schedules")
      .set(signedHeaders("GET", "/api/reports/schedules", sessionSecret))
      .expect(403);

    await request(app)
      .get("/api/reports/recipients")
      .set(signedHeaders("GET", "/api/reports/recipients", sessionSecret))
      .expect(403);
  });

  it("allows members to access self face enrollment endpoints while preserving service-level scope checks", async () => {
    const { app, sessionSecret, faceService } = createServices({
      roles: ["Member"]
    });

    await request(app)
      .post("/api/faces/challenge")
      .set(signedHeaders("POST", "/api/faces/challenge", sessionSecret, { memberUserId: 1 }))
      .send({ memberUserId: 1 })
      .expect(200);

    faceService.startLivenessChallenge.mockRejectedValueOnce(
      new AppError(403, "forbidden", "You do not have access to this member's face records")
    );
    await request(app)
      .post("/api/faces/challenge")
      .set(signedHeaders("POST", "/api/faces/challenge", sessionSecret, { memberUserId: 77 }))
      .send({ memberUserId: 77 })
      .expect(403);
  });

  it("rejects malformed analytics filters before they reach the service layer", async () => {
    const { app, sessionSecret } = createServices();
    const path = "/api/content/analytics?startDate=03/28/2026&locationCode=HQ";

    const response = await request(app)
      .get(path)
      .set(signedHeaders("GET", path, sessionSecret));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_failed");
  });

  it("rejects semantically invalid analytics dates", async () => {
    const { app, sessionSecret } = createServices();
    const path = "/api/content/analytics?startDate=2026-02-31&locationCode=HQ";

    const response = await request(app)
      .get(path)
      .set(signedHeaders("GET", path, sessionSecret));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_failed");
  });

  it("returns forbidden when content routes attempt out-of-scope location access", async () => {
    const { app, sessionSecret, contentService } = createServices();
    contentService.listPosts.mockRejectedValueOnce(
      new AppError(403, "forbidden_location_scope", "You do not have access to this location")
    );
    contentService.recordSearch.mockRejectedValueOnce(
      new AppError(403, "forbidden_location_scope", "You do not have access to this location")
    );

    await request(app)
      .get("/api/content/posts?locationCode=Branch")
      .set(signedHeaders("GET", "/api/content/posts?locationCode=Branch", sessionSecret))
      .expect(403);

    await request(app)
      .post("/api/content/search-events")
      .set(
        signedHeaders("POST", "/api/content/search-events", sessionSecret, {
          searchTerm: "mobility",
          locationCode: "Branch"
        })
      )
      .send({ searchTerm: "mobility", locationCode: "Branch" })
      .expect(403);
  });

  it("rejects signature validation when signed query parameters are tampered", async () => {
    const { app, sessionSecret } = createServices();
    const signedPath = "/api/content/analytics?locationCode=HQ";

    const response = await request(app)
      .get("/api/content/analytics?locationCode=Branch")
      .set(signedHeaders("GET", signedPath, sessionSecret));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("signature_invalid");
  });

  it("rejects nonce replay across app restarts using durable nonce storage", async () => {
    const sharedDatabase = createNonceAwareDatabase();
    const { app: firstApp, sessionSecret } = createServices({
      database: sharedDatabase
    });
    const timestamp = new Date().toISOString();
    const nonce = "nonce-restart-replay";
    const signature = signPayload(
      sessionSecret,
      createSignaturePayload("GET", "/api/admin/console", timestamp, nonce, undefined)
    );

    await request(firstApp)
      .get("/api/admin/console")
      .set({
        Cookie: "sf_session=session-token; sf_workstation=binding-token",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": timestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": signature
      })
      .expect(200);

    const { app: restartedApp } = createServices({
      database: sharedDatabase
    });

    const replayResponse = await request(restartedApp)
      .get("/api/admin/console")
      .set({
        Cookie: "sf_session=session-token; sf_workstation=binding-token",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": timestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": signature
      });

    expect(replayResponse.status).toBe(401);
    expect(replayResponse.body.error.code).toBe("nonce_replayed");
  });

  it("covers the protected route families with valid signed requests", async () => {
    const { app, sessionSecret } = createServices();

    await request(app).get("/api/self/profile").set(signedHeaders("GET", "/api/self/profile", sessionSecret)).expect(200);
    await request(app).get("/api/members").set(signedHeaders("GET", "/api/members", sessionSecret)).expect(200);

    const createMemberBody = {
      username: "member-two",
      fullName: "Member Two",
      password: "Member12345!X",
      phone: null,
      locationCode: "HQ"
    };
    await request(app)
      .post("/api/members")
      .set(signedHeaders("POST", "/api/members", sessionSecret, createMemberBody))
      .send(createMemberBody)
      .expect(200);

    const coachAssignmentBody = { coachUserId: 2 };
    await request(app)
      .post("/api/members/7/coach-assignment")
      .set(signedHeaders("POST", "/api/members/7/coach-assignment", sessionSecret, coachAssignmentBody))
      .send(coachAssignmentBody)
      .expect(200);

    const coachLocationBody = { locationCode: "HQ" };
    await request(app)
      .post("/api/members/coaches/2/locations")
      .set(signedHeaders("POST", "/api/members/coaches/2/locations", sessionSecret, coachLocationBody))
      .send(coachLocationBody)
      .expect(200);
    await request(app)
      .get("/api/members/coaches/2/locations")
      .set(signedHeaders("GET", "/api/members/coaches/2/locations", sessionSecret))
      .expect(200);

    const consentBody = { consentStatus: "granted" };
    await request(app)
      .post("/api/members/7/consent/face")
      .set(signedHeaders("POST", "/api/members/7/consent/face", sessionSecret, consentBody))
      .send(consentBody)
      .expect(200);

    await request(app)
      .post("/api/self/consent/face")
      .set(signedHeaders("POST", "/api/self/consent/face", sessionSecret, consentBody))
      .send(consentBody)
      .expect(200);

    const enrollBody = {
      memberUserId: 7,
      sourceType: "import",
      challengeId: "challenge-1",
      centerImageBase64: "data:image/png;base64,abc",
      turnImageBase64: "data:image/png;base64,abc"
    };
    await request(app)
      .post("/api/faces/challenge")
      .set(signedHeaders("POST", "/api/faces/challenge", sessionSecret, { memberUserId: 7 }))
      .send({ memberUserId: 7 })
      .expect(200);
    await request(app)
      .post("/api/faces/dedup-check")
      .set(signedHeaders("POST", "/api/faces/dedup-check", sessionSecret, {
        memberUserId: 7,
        sourceType: "import",
        centerImageBase64: "data:image/png;base64,abc",
        turnImageBase64: "data:image/png;base64,abc"
      }))
      .send({
        memberUserId: 7,
        sourceType: "import",
        centerImageBase64: "data:image/png;base64,abc",
        turnImageBase64: "data:image/png;base64,abc"
      })
      .expect(200);

    await request(app)
      .post("/api/faces/enroll")
      .set(signedHeaders("POST", "/api/faces/enroll", sessionSecret, enrollBody))
      .send(enrollBody)
      .expect(200);

    await request(app)
      .patch("/api/faces/5/deactivate")
      .set(signedHeaders("PATCH", "/api/faces/5/deactivate", sessionSecret))
      .expect(200);

    await request(app)
      .get("/api/faces/history/7")
      .set(signedHeaders("GET", "/api/faces/history/7", sessionSecret))
      .expect(200);

    await request(app)
      .get("/api/content/posts")
      .set(signedHeaders("GET", "/api/content/posts", sessionSecret))
      .expect(200);

    const createPostBody = { kind: "tip", title: "Mobility", body: "Body", locationCode: "HQ" };
    await request(app)
      .post("/api/content/posts")
      .set(signedHeaders("POST", "/api/content/posts", sessionSecret, createPostBody))
      .send(createPostBody)
      .expect(200);

    const viewBody = { postId: 9, locationCode: "HQ" };
    await request(app)
      .post("/api/content/views")
      .set(signedHeaders("POST", "/api/content/views", sessionSecret, viewBody))
      .send(viewBody)
      .expect(200);

    const searchBody = { searchTerm: "mobility", locationCode: "HQ" };
    await request(app)
      .post("/api/content/search-events")
      .set(signedHeaders("POST", "/api/content/search-events", sessionSecret, searchBody))
      .send(searchBody)
      .expect(200);

    await request(app)
      .get("/api/content/analytics?locationCode=HQ")
      .set(signedHeaders("GET", "/api/content/analytics?locationCode=HQ", sessionSecret))
      .expect(200);

    await request(app)
      .get("/api/dashboards/me")
      .set(signedHeaders("GET", "/api/dashboards/me", sessionSecret))
      .expect(200);

    const dashboardBody = { layout: [] };
    await request(app)
      .put("/api/dashboards/me")
      .set(signedHeaders("PUT", "/api/dashboards/me", sessionSecret, dashboardBody))
      .send(dashboardBody)
      .expect(200);

    const templateBody = { name: "Template", layout: [] };
    await request(app)
      .post("/api/dashboards/templates")
      .set(signedHeaders("POST", "/api/dashboards/templates", sessionSecret, templateBody))
      .send(templateBody)
      .expect(200);

    await request(app)
      .get("/api/reports/schedules")
      .set(signedHeaders("GET", "/api/reports/schedules", sessionSecret))
      .expect(200);

    await request(app)
      .get("/api/reports/recipients")
      .set(signedHeaders("GET", "/api/reports/recipients", sessionSecret))
      .expect(200);

    const scheduleBody = {
      templateId: 1,
      name: "Weekly",
      cronExpression: "0 6 * * 1",
      format: "pdf",
      subscriberUserIds: [1]
    };
    await request(app)
      .post("/api/reports/schedules")
      .set(signedHeaders("POST", "/api/reports/schedules", sessionSecret, scheduleBody))
      .send(scheduleBody)
      .expect(200);

    const generateBody = { templateId: 1, format: "pdf", locationCode: "HQ" };
    await request(app)
      .post("/api/reports/generate")
      .set(signedHeaders("POST", "/api/reports/generate", sessionSecret, generateBody))
      .send(generateBody)
      .expect(200);

    await request(app)
      .get("/api/reports/inbox")
      .set(signedHeaders("GET", "/api/reports/inbox", sessionSecret))
      .expect(200);

    await request(app)
      .get("/api/reports/inbox/1/download")
      .set(signedHeaders("GET", "/api/reports/inbox/1/download", sessionSecret))
      .expect(200);

    await request(app)
      .post("/api/admin/backups")
      .set(signedHeaders("POST", "/api/admin/backups", sessionSecret))
      .expect(200);

    const recoveryBody = { backupRunId: 3 };
    await request(app)
      .post("/api/admin/recovery/dry-run")
      .set(signedHeaders("POST", "/api/admin/recovery/dry-run", sessionSecret, recoveryBody))
      .send(recoveryBody)
      .expect(200);
  });
});
