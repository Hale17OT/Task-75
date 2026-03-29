import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import type { Database } from "../src/database.js";
import { createAuthService, expandRoles } from "../src/services/auth-service.js";
import { baseConfig } from "./test-helpers.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();
  const connection = {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
    query: vi.fn((sql: string, params?: unknown[]) => query(sql, params).then((rows: unknown) => [rows])),
    execute: vi.fn((sql: string, params?: unknown[]) => execute(sql, params))
  };
  const getConnection = vi.fn(async () => connection);

  return {
    database: {
      pool: {
        getConnection
      } as unknown as Database["pool"],
      query,
      execute,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database,
    query,
    execute,
    connection,
    getConnection
  };
};

const cryptoService = {
  encrypt: vi.fn(async (value: string) => ({
    keyId: "key-1",
    cipherText: `encrypted:${value}`
  })),
  decrypt: vi.fn(async ({ cipherText }: { cipherText: string }) =>
    cipherText.startsWith("encrypted:") ? cipherText.slice("encrypted:".length) : cipherText
  ),
  encryptBytes: vi.fn(),
  decryptBytes: vi.fn(),
  hashForComparison: vi.fn((value: string) => `hash:${value}`),
  maskPhone: vi.fn()
};

const adminActorSession = {
  id: 4,
  user_id: 1,
  session_token: "hash:session-token",
  session_secret: "encrypted:secret",
  session_secret_key_id: "key-1",
  station_token: "Front-Desk-01",
  workstation_binding_hash: "hash:binding-token",
  warm_locked_at: null,
  last_activity_at: new Date(),
  created_at: new Date(),
  revoked_at: null
};

describe("auth service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("expands inclusive role inheritance", () => {
    expect(expandRoles(["Administrator"])).toEqual(["Administrator", "Coach", "Member"]);
    expect(expandRoles(["Coach"])).toEqual(["Coach", "Member"]);
  });

  it("allows one-time bootstrap when no administrator exists", async () => {
    const { database, query, execute, connection } = createMockDatabase();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([
        {
          id: 11,
          username: "owner",
          full_name: "Facility Owner",
          password_hash: "hashed",
          active: 1
        }
      ])
      .mockResolvedValueOnce([{ role_name: "Administrator" }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);
    const result = await service.bootstrapAdministrator("owner", "Facility Owner", "Owner12345!X", "Desk-A");

    expect(result.currentUser.roles).toEqual(["Administrator", "Coach", "Member"]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bootstrap_guard"),
      []
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO users"),
      ["owner", "Facility Owner", expect.any(String)]
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_roles"),
      [11]
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sessions"),
      [11, expect.stringMatching(/^hash:/), expect.stringMatching(/^encrypted:/), "key-1", "Desk-A", expect.stringMatching(/^hash:/)]
    );
    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
    expect(result.workstationBindingToken).toHaveLength(64);
  });

  it("rejects bootstrap when singleton guard has already been claimed", async () => {
    const { database, execute, connection } = createMockDatabase();
    execute.mockRejectedValueOnce(new Error("Duplicate entry '1' for key 'PRIMARY'"));

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(
      service.bootstrapAdministrator("owner", "Facility Owner", "Owner12345!X", "Desk-A")
    ).rejects.toMatchObject({
      code: "bootstrap_unavailable"
    } satisfies Partial<AppError>);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("logs users in with encrypted session state and inherited roles", async () => {
    const { database, query, execute } = createMockDatabase();
    const passwordHash = await bcrypt.hash("Admin12345!X", 10);
    query
      .mockResolvedValueOnce([{ failures: 0 }])
      .mockResolvedValueOnce([
        {
          id: 1,
          username: "admin",
          full_name: "System Administrator",
          password_hash: passwordHash,
          active: 1
        }
      ])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([{ user_id: 1 }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);
    const result = await service.login("admin", "Admin12345!X", "127.0.0.1", "Front-Desk-01");

    expect(result.currentUser.roles).toEqual(["Administrator", "Coach", "Member"]);
    expect(result.session.sessionToken).toHaveLength(64);
    expect(result.session.sessionSecret).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sessions"),
      [1, expect.stringMatching(/^hash:/), expect.stringMatching(/^encrypted:/), "key-1", "Front-Desk-01", expect.stringMatching(/^hash:/)]
    );
    expect(result.workstationBindingToken).toHaveLength(64);
  });

  it("records failed password attempts and rejects invalid credentials", async () => {
    const { database, query, execute } = createMockDatabase();
    const passwordHash = await bcrypt.hash("Admin12345!X", 10);
    query
      .mockResolvedValueOnce([{ failures: 0 }])
      .mockResolvedValueOnce([
        {
          id: 1,
          username: "admin",
          full_name: "System Administrator",
          password_hash: passwordHash,
          active: 1
        }
      ]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(service.login("admin", "WrongPassword1!", "127.0.0.1", "Front-Desk-01")).rejects.toMatchObject({
      code: "invalid_credentials"
    } satisfies Partial<AppError>);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO failed_login_attempts"),
      ["admin", "127.0.0.1", 0]
    );
  });

  it("locks accounts after too many recent failures regardless of IP", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([{ failures: baseConfig.ACCOUNT_LOCK_MAX_ATTEMPTS }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(service.login("admin", "Admin12345!X", "127.0.0.1", "Front-Desk-01")).rejects.toMatchObject({
      code: "account_locked"
    } satisfies Partial<AppError>);
  });

  it("expires stale sessions and revokes them immediately", async () => {
    const { database, query, execute } = createMockDatabase();
    query.mockResolvedValueOnce([
      {
        ...adminActorSession,
        last_activity_at: new Date(Date.now() - 31 * 60 * 1000)
      }
    ]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(service.assertSessionActive("session-token")).rejects.toMatchObject({
      code: "session_expired"
    } satisfies Partial<AppError>);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE sessions SET revoked_at"),
      ["hash:session-token"]
    );
  });

  it("re-enters with PIN only when a still-valid full session exists on the same station", async () => {
    const { database, query, execute } = createMockDatabase();
    const pinHash = await bcrypt.hash("1234", 10);
    query
      .mockResolvedValueOnce([{ failures: 0 }])
      .mockResolvedValueOnce([
        {
          id: 1,
          username: "admin",
          full_name: "System Administrator",
          password_hash: "unused",
          active: 1
        }
      ])
      .mockResolvedValueOnce([{ pin_hash: pinHash }])
      .mockResolvedValueOnce([
        {
          ...adminActorSession,
          session_token: "hash:old-session",
          station_token: "Front-Desk-01"
        }
      ])
      .mockResolvedValueOnce([{ role_name: "Administrator" }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);
    const result = await service.reenterWithPin(
      "admin",
      "1234",
      "old-session",
      "Front-Desk-01",
      "binding-token",
      "127.0.0.1"
    );

    expect(result.currentUser.username).toBe("admin");
    expect(result.hasPin).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE sessions SET revoked_at"),
      ["hash:old-session"]
    );
  });

  it("rejects PIN re-entry on the wrong workstation", async () => {
    const { database, query } = createMockDatabase();
    const pinHash = await bcrypt.hash("1234", 10);
    query
      .mockResolvedValueOnce([{ failures: 0 }])
      .mockResolvedValueOnce([
        {
          id: 1,
          username: "admin",
          full_name: "System Administrator",
          password_hash: "unused",
          active: 1
        }
      ])
      .mockResolvedValueOnce([{ pin_hash: pinHash }])
      .mockResolvedValueOnce([
        {
          ...adminActorSession,
          session_token: "hash:old-session",
          station_token: "Desk-A"
        }
      ]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(
      service.reenterWithPin("admin", "1234", "old-session", "Desk-B", "binding-token", "127.0.0.1")
    ).rejects.toMatchObject({
      code: "pin_context_invalid"
    } satisfies Partial<AppError>);
  });

  it("applies account lockout rules to PIN re-entry attempts", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([{ failures: baseConfig.ACCOUNT_LOCK_MAX_ATTEMPTS }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(
      service.reenterWithPin("admin", "1234", "old-session", "Front-Desk-01", "binding-token", "127.0.0.1")
    ).rejects.toMatchObject({
      code: "account_locked"
    } satisfies Partial<AppError>);
  });

  it("supports PIN setup, active session lookup, touch, logout, and session hardening", async () => {
    const { database, query, execute } = createMockDatabase();
    query
      .mockResolvedValueOnce([adminActorSession])
      .mockResolvedValueOnce([
        {
          id: 1,
          username: "admin",
          full_name: "System Administrator",
          password_hash: "unused",
          active: 1
        }
      ])
      .mockResolvedValueOnce([{ user_id: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 9,
          session_token: "legacy-token",
          session_secret: "legacy-secret",
          session_secret_key_id: "legacy"
        }
      ]);

    const service = createAuthService(database, baseConfig, cryptoService as never);
    await service.setupPin(1, "1234");
    const session = await service.getSession("session-token");
    await service.touchSession("session-token");
    await service.logout("session-token");
    await service.hardenStoredSessions();

    expect(session?.currentUser.username).toBe("admin");
    expect(session?.session.sessionSecret).toBe("secret");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO pin_credentials"),
      [1, expect.any(String)]
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE sessions SET last_activity_at"),
      ["hash:session-token"]
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET session_token = ?, session_secret = ?, session_secret_key_id = ?"),
      ["hash:legacy-token", "encrypted:legacy-secret", "key-1", 9]
    );
  });

  it("marks sessions as warm locked and blocks restore until PIN re-entry occurs", async () => {
    const { database, query, execute } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ ...adminActorSession }])
      .mockResolvedValueOnce([{ ...adminActorSession, warm_locked_at: new Date() }])
      .mockResolvedValueOnce([
        {
          id: 1,
          username: "admin",
          full_name: "System Administrator",
          password_hash: "unused",
          active: 1
        }
      ])
      .mockResolvedValueOnce([{ user_id: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await service.warmLockSession("session-token");
    const restored = await service.restoreSession("session-token", "binding-token");

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE sessions SET warm_locked_at = UTC_TIMESTAMP()"),
      ["hash:session-token"]
    );
    expect(restored).toMatchObject({
      status: "warm_locked",
      hasPin: true
    });
  });

  it("requires a valid workstation binding token when asserting signed-session context", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([{ ...adminActorSession }]);

    const service = createAuthService(database, baseConfig, cryptoService as never);

    await expect(service.assertWorkstationBinding("session-token", undefined)).rejects.toMatchObject({
      code: "workstation_binding_required"
    } satisfies Partial<AppError>);
  });
});
