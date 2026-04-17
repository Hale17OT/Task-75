import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMiddlewareSuite } from "../src/middleware.js";
import { AppError } from "../src/errors.js";
import { createSignaturePayload, signPayload } from "../src/security.js";
import { baseConfig, createStubDatabase } from "./test-helpers.js";
import type { Database } from "../src/database.js";
import "../src/request-context.js";

const sessionSecret = Buffer.alloc(32, 9).toString("base64");

const buildAuthService = (overrides: Record<string, unknown> = {}) => ({
  getBootstrapStatus: vi.fn(async () => ({ requiresBootstrap: false })),
  bootstrapAdministrator: vi.fn(async () => {
    throw new Error("not used");
  }),
  login: vi.fn(),
  setupPin: vi.fn(),
  reenterWithPin: vi.fn(),
  logout: vi.fn(),
  warmLockSession: vi.fn(),
  hardenStoredSessions: vi.fn(),
  restoreSession: vi.fn(),
  getSession: vi.fn(async (sessionToken?: string) => {
    if (sessionToken !== "good-session") {
      return null;
    }

    return {
      currentUser: {
        id: 42,
        username: "admin",
        fullName: "Admin",
        roles: ["Administrator", "Coach", "Member"]
      },
      session: {
        id: 1,
        userId: 42,
        sessionToken: "good-session",
        sessionSecret,
        sessionSecretKeyId: "key-1",
        stationToken: "Front-Desk-01",
        workstationBindingHash: "hash:binding",
        warmLockedAt: null as Date | null,
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
  assertSessionActive: vi.fn(),
  touchSession: vi.fn(async () => {}),
  ...overrides
});

const buildLoggingService = () => ({
  log: vi.fn(async () => {}),
  alert: vi.fn(async () => {}),
  access: vi.fn(async () => {})
});

type AuthServiceShape = ReturnType<typeof buildAuthService>;
type LoggingServiceShape = ReturnType<typeof buildLoggingService>;

const buildNonceAwareDatabase = (): Database => {
  const base = createStubDatabase(true);
  const seen = new Map<string, number>();
  return {
    ...base,
    async execute(sql: string, params: unknown[] = []) {
      if (sql.includes("DELETE FROM request_nonces")) {
        const now = Date.now();
        for (const [key, expiresAt] of seen) {
          if (expiresAt <= now) {
            seen.delete(key);
          }
        }
        return;
      }

      if (sql.includes("INSERT INTO request_nonces")) {
        const key = `${String(params[0] ?? "")}:${String(params[1] ?? "")}`;
        if (seen.has(key) && (seen.get(key) ?? 0) > Date.now()) {
          const duplicateError = new Error("dup") as Error & { code?: string };
          duplicateError.code = "ER_DUP_ENTRY";
          throw duplicateError;
        }
        seen.set(key, Date.now() + Number(params[2] ?? 0) * 1000);
        return;
      }

      await base.execute(sql, params);
    }
  };
};

const mountSuite = (
  options: {
    authService?: AuthServiceShape;
    loggingService?: LoggingServiceShape;
    config?: typeof baseConfig;
    database?: Database;
  } = {}
) => {
  const authService = options.authService ?? buildAuthService();
  const loggingService = options.loggingService ?? buildLoggingService();
  const config = options.config ?? baseConfig;
  const database = options.database ?? buildNonceAwareDatabase();
  const middleware = createMiddlewareSuite(config, database, authService as never, loggingService as never);
  const app = express();
  app.use(middleware.cookieParser);
  app.use(express.json({ limit: "1mb" }));
  app.use(middleware.attachStationToken);
  return { app, middleware, authService, loggingService };
};

const signedRequestHeaders = (method: string, path: string, body?: unknown) => {
  const timestamp = new Date().toISOString();
  const nonce = `nonce-${Math.random().toString(16).slice(2)}`;
  const signature = signPayload(sessionSecret, createSignaturePayload(method, path, timestamp, nonce, body));

  return {
    Cookie: "sf_session=good-session; sf_workstation=good-binding",
    "x-station-token": "Front-Desk-01",
    "x-sf-timestamp": timestamp,
    "x-sf-nonce": nonce,
    "x-sf-signature": signature
  };
};

describe("middleware: allowlistedIpOnly", () => {
  it("rejects requests from non-allowlisted IPs", async () => {
    const { app, middleware } = mountSuite({
      config: { ...baseConfig, IP_ALLOWLIST: ["10.10.10.10/32"] }
    });
    app.use(middleware.allowlistedIpOnly);
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/ping");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ip_forbidden");
  });

  it("passes requests from allowlisted IPs through", async () => {
    const { app, middleware } = mountSuite();
    app.use(middleware.allowlistedIpOnly);
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/ping");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});

describe("middleware: rate limiters", () => {
  it("throttles sign-in attempts at the configured ceiling", async () => {
    const { app, middleware } = mountSuite({
      config: { ...baseConfig, LOGIN_RATE_LIMIT_PER_MINUTE: 2 }
    });
    app.post("/signin", middleware.rateLimitedSignIn, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    await request(app).post("/signin").expect(200);
    await request(app).post("/signin").expect(200);
    const response = await request(app).post("/signin");
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("rate_limited");
  });

  it("throttles generic API calls at the configured ceiling", async () => {
    const { app, middleware } = mountSuite({
      config: { ...baseConfig, API_RATE_LIMIT_PER_MINUTE: 1 }
    });
    app.get("/api", middleware.rateLimitedApi, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    await request(app).get("/api").expect(200);
    const limited = await request(app).get("/api");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
  });
});

describe("middleware: attachStationToken", () => {
  it("sets req.stationToken from the x-station-token header", async () => {
    const { app, middleware } = mountSuite();
    app.get("/ping", (req, res) => res.json({ station: req.stationToken }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/ping").set("x-station-token", "Desk-B");
    expect(response.body.station).toBe("Desk-B");
  });

  it("leaves req.stationToken null when the header is missing", async () => {
    const { app, middleware } = mountSuite();
    app.get("/ping", (req, res) => res.json({ station: req.stationToken }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/ping");
    expect(response.body.station).toBeNull();
  });
});

describe("middleware: optionalSession", () => {
  it("clears stale cookies when the underlying session has expired", async () => {
    const authService = buildAuthService({
      getSession: vi.fn(async () => {
        throw new AppError(401, "session_expired", "Session expired");
      })
    });
    const { app, middleware } = mountSuite({ authService });
    app.get("/whoami", middleware.optionalSession, (req, res) =>
      res.json({ currentUser: req.currentUser ?? null })
    );
    app.use(middleware.handleErrors);

    const response = await request(app).get("/whoami").set("Cookie", "sf_session=stale-token");
    expect(response.status).toBe(200);
    expect(response.body.currentUser).toBeNull();
    const setCookie = response.headers["set-cookie"];
    const cookieValue = Array.isArray(setCookie) ? setCookie.join(";") : setCookie ?? "";
    expect(cookieValue).toContain("sf_session=;");
    expect(cookieValue).toContain("sf_workstation=;");
  });

  it("propagates unexpected errors instead of silently clearing cookies", async () => {
    const authService = buildAuthService({
      getSession: vi.fn(async () => {
        throw new AppError(500, "unexpected", "boom");
      })
    });
    const { app, middleware } = mountSuite({ authService });
    app.get("/whoami", middleware.optionalSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/whoami").set("Cookie", "sf_session=any");
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("unexpected");
  });
});

describe("middleware: requireSignedSession", () => {
  it("rejects requests without a session cookie", async () => {
    const { app, middleware } = mountSuite();
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/secured");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("missing_session");
  });

  it("rejects requests whose session is unknown", async () => {
    const { app, middleware } = mountSuite();
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app)
      .get("/secured")
      .set("Cookie", "sf_session=unknown-session");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_session");
  });

  it("rejects warm-locked sessions with a 423", async () => {
    const authService = buildAuthService();
    authService.getSession = vi.fn(async () => ({
      currentUser: { id: 1, username: "admin", fullName: "Admin", roles: ["Administrator"] },
      session: {
        id: 1,
        userId: 1,
        sessionToken: "good-session",
        sessionSecret,
        sessionSecretKeyId: "key-1",
        stationToken: "Front-Desk-01",
        workstationBindingHash: "hash:binding",
        warmLockedAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        revokedAt: null
      },
      hasPin: true,
      warmLockMinutes: 5,
      sessionTimeoutMinutes: 30
    })) as never;
    const { app, middleware } = mountSuite({ authService });
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app)
      .get("/secured")
      .set(signedRequestHeaders("GET", "/secured"));
    expect(response.status).toBe(423);
    expect(response.body.error.code).toBe("warm_locked");
  });

  it("rejects signed requests with a stale timestamp", async () => {
    const { app, middleware } = mountSuite();
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const nonce = "nonce-stale";
    const signature = signPayload(
      sessionSecret,
      createSignaturePayload("GET", "/secured", staleTimestamp, nonce, undefined)
    );
    const response = await request(app)
      .get("/secured")
      .set({
        Cookie: "sf_session=good-session; sf_workstation=good-binding",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": staleTimestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": signature
      });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("timestamp_stale");
  });

  it("rejects signed requests with an invalid timestamp format", async () => {
    const { app, middleware } = mountSuite();
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app)
      .get("/secured")
      .set({
        Cookie: "sf_session=good-session; sf_workstation=good-binding",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": "not-a-date",
        "x-sf-nonce": "nonce-bad",
        "x-sf-signature": "00"
      });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("timestamp_invalid");
  });

  it("rejects replayed nonces", async () => {
    const database = buildNonceAwareDatabase();
    const { app, middleware } = mountSuite({ database });
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const timestamp = new Date().toISOString();
    const nonce = "nonce-replayed";
    const signature = signPayload(
      sessionSecret,
      createSignaturePayload("GET", "/secured", timestamp, nonce, undefined)
    );
    const headers = {
      Cookie: "sf_session=good-session; sf_workstation=good-binding",
      "x-station-token": "Front-Desk-01",
      "x-sf-timestamp": timestamp,
      "x-sf-nonce": nonce,
      "x-sf-signature": signature
    };

    await request(app).get("/secured").set(headers).expect(200);
    const replay = await request(app).get("/secured").set(headers);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("nonce_replayed");
  });

  it("rejects requests whose signature does not match the payload", async () => {
    const { app, middleware } = mountSuite();
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const timestamp = new Date().toISOString();
    const nonce = "nonce-wrong-sig";
    const response = await request(app)
      .get("/secured")
      .set({
        Cookie: "sf_session=good-session; sf_workstation=good-binding",
        "x-station-token": "Front-Desk-01",
        "x-sf-timestamp": timestamp,
        "x-sf-nonce": nonce,
        "x-sf-signature": "deadbeef"
      });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("signature_invalid");
  });

  it("touches the session on successful signed requests", async () => {
    const authService = buildAuthService();
    const { app, middleware } = mountSuite({ authService });
    app.get("/secured", middleware.requireSignedSession, (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    await request(app).get("/secured").set(signedRequestHeaders("GET", "/secured")).expect(200);
    expect(authService.touchSession).toHaveBeenCalledWith("good-session");
    expect(authService.assertWorkstationBinding).toHaveBeenCalledWith("good-session", "good-binding");
  });
});

describe("middleware: requireRole", () => {
  it("returns 401 when no current user is attached", async () => {
    const { app, middleware } = mountSuite();
    app.get("/admin", middleware.requireRole("Administrator"), (_req, res) => res.json({ ok: true }));
    app.use(middleware.handleErrors);

    const response = await request(app).get("/admin");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("missing_session");
  });

  it("returns 403 when the current user lacks all required roles", async () => {
    const { app, middleware } = mountSuite();
    app.get(
      "/admin",
      (req, _res, next) => {
        req.currentUser = { id: 1, username: "coach", fullName: "Coach", roles: ["Coach"] };
        next();
      },
      middleware.requireRole("Administrator"),
      (_req, res) => res.json({ ok: true })
    );
    app.use(middleware.handleErrors);

    const response = await request(app).get("/admin");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
  });

  it("allows the request when any required role is present", async () => {
    const { app, middleware } = mountSuite();
    app.get(
      "/admin-or-coach",
      (req, _res, next) => {
        req.currentUser = { id: 2, username: "coach", fullName: "Coach", roles: ["Coach"] };
        next();
      },
      middleware.requireRole("Administrator", "Coach"),
      (_req, res) => res.json({ ok: true })
    );
    app.use(middleware.handleErrors);

    const response = await request(app).get("/admin-or-coach");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});

describe("middleware: handleErrors", () => {
  it("renders zod validation failures as 400 with validation_failed code", async () => {
    const { app, middleware, loggingService } = mountSuite();
    app.get("/boom", () => {
      const schema = z.object({ count: z.number() });
      schema.parse({ count: "not-a-number" });
    });
    app.use(middleware.handleErrors);

    const response = await request(app).get("/boom");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_failed");
    expect(loggingService.log).toHaveBeenCalledWith(
      "http",
      "warn",
      "Request validation failed",
      expect.objectContaining({ code: "validation_failed", statusCode: 400 })
    );
  });

  it("raises an audit_integrity alert when biometric immutability errors surface", async () => {
    const { app, middleware, loggingService } = mountSuite();
    app.get("/audit-boom", () => {
      throw new Error("biometric_audit_log is immutable");
    });
    app.use(middleware.handleErrors);

    const response = await request(app).get("/audit-boom");
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("internal_error");
    expect(loggingService.alert).toHaveBeenCalledWith(
      "audit_integrity",
      "high",
      expect.stringMatching(/biometric audit/i)
    );
  });

  it("maps AppError instances to their declared status code and error code", async () => {
    const { app, middleware } = mountSuite();
    app.get("/forbidden", () => {
      throw new AppError(418, "teapot", "I refuse", { foo: "bar" });
    });
    app.use(middleware.handleErrors);

    const response = await request(app).get("/forbidden");
    expect(response.status).toBe(418);
    expect(response.body.error.code).toBe("teapot");
    expect(response.body.error.details).toEqual({ foo: "bar" });
  });
});

describe("middleware: requestLogger", () => {
  let fixedNow: number;

  beforeEach(() => {
    fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => fixedNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records method/path/status plus a duration on response finish", async () => {
    const loggingService = buildLoggingService();
    const { app, middleware } = mountSuite({ loggingService });
    app.use(middleware.requestLogger);
    app.get("/recorded", (_req, res) => {
      fixedNow = 1_700_000_000_500;
      res.status(201).json({ ok: true });
    });
    app.use(middleware.handleErrors);

    await request(app).get("/recorded").set("x-station-token", "Desk-C").expect(201);

    expect(loggingService.access).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/recorded",
        statusCode: 201,
        stationToken: "Desk-C",
        durationMs: 500
      })
    );
  });
});
