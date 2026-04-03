import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.js";
import { AppError } from "../src/errors.js";

const { mkdirMock, readFileMock, readdirMock, rmMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(async () => {}),
  readFileMock: vi.fn(async () => ""),
  readdirMock: vi.fn(async () => []),
  rmMock: vi.fn(async () => {}),
  writeFileMock: vi.fn(async () => {})
}));
const { cronScheduleMock, createConnectionMock } = vi.hoisted(() => ({
  cronScheduleMock: vi.fn(),
  createConnectionMock: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  readdir: readdirMock,
  rm: rmMock,
  writeFile: writeFileMock
}));
vi.mock("node-cron", () => ({
  default: {
    schedule: cronScheduleMock
  }
}));
vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: createConnectionMock
  }
}));

import { createOpsService } from "../src/services/ops-service.js";
import { baseConfig } from "./test-helpers.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();
  const executeInTransaction = vi.fn(async (callback: (connection: never) => Promise<unknown>) => callback({} as never));

  return {
    database: {
      pool: {} as Database["pool"],
      query,
      execute,
      executeInTransaction,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database,
    query,
    execute
  };
};

describe("ops service", () => {
  const loggingService = {
    log: vi.fn(async () => {}),
    alert: vi.fn(async () => {})
  };

  beforeEach(() => {
    mkdirMock.mockClear();
    readFileMock.mockClear();
    readdirMock.mockClear();
    rmMock.mockClear();
    writeFileMock.mockClear();
    cronScheduleMock.mockClear();
    createConnectionMock.mockClear();
    loggingService.log.mockClear();
    loggingService.alert.mockClear();
  });

  it("creates encrypted backup metadata and honors retention trimming", async () => {
    const { database, query, execute } = createMockDatabase();
    query.mockImplementation(async (sql: string) =>
      sql.includes("SELECT id FROM backup_runs") ? [{ id: 41 }] : []
    );
    const now = Date.UTC(2026, 3, 3, 12, 0, 0);
    readdirMock.mockImplementation(async () => {
      const dailyFiles = Array.from({ length: 31 }, (_, index) => `backup-${now - index * 86_400_000}.json`);
      return [...dailyFiles, `backup-${now - 31 * 86_400_000}.json`] as never[];
    });

    const service = createOpsService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/sentinelfit"
      },
      {
        encrypt: vi.fn(async () => ({ keyId: "key-1", cipherText: "cipher" })),
        decrypt: vi.fn(),
        encryptBytes: vi.fn(),
        decryptBytes: vi.fn(),
        hashForComparison: vi.fn(),
        maskPhone: vi.fn()
      },
      loggingService as never
    );

    const backup = await service.createBackupNow();

    expect(backup.id).toBe(41);
    expect(backup.keyId).toBe("key-1");
    expect(writeFileMock).toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO backup_runs"),
      ["key-1", expect.stringContaining("backup-"), expect.any(String)]
    );
  });

  it("fails dry-run restore when backup checksums do not match", async () => {
    const { database, query, execute } = createMockDatabase();
    query.mockResolvedValueOnce([
      {
        id: 8,
        key_id: "key-1",
        file_path: "C:/sentinelfit/backups/backup-1.json",
        checksum: "expected-checksum"
      }
    ]);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        keyId: "key-1",
        cipherText: "cipher"
      })
    );

    const service = createOpsService(
      database,
      baseConfig,
      {
        encrypt: vi.fn(),
        decrypt: vi.fn(async () => JSON.stringify({ users: [] })),
        encryptBytes: vi.fn(),
        decryptBytes: vi.fn(),
        hashForComparison: vi.fn(),
        maskPhone: vi.fn()
      },
      loggingService as never
    );

    const result = await service.dryRunRestore(8);

    expect(result.status).toBe("failed");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO recovery_dry_runs"),
      [8, baseConfig.MYSQL_STANDBY_HOST, "Backup checksum mismatch"]
    );
  });

  it("returns explicit not-found error for unknown backup run ids", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createOpsService(
      database,
      baseConfig,
      {
        encrypt: vi.fn(),
        decrypt: vi.fn(),
        encryptBytes: vi.fn(),
        decryptBytes: vi.fn(),
        hashForComparison: vi.fn(),
        maskPhone: vi.fn()
      },
      loggingService as never
    );

    await expect(service.dryRunRestore(999999)).rejects.toMatchObject({
      statusCode: 404,
      code: "backup_not_found"
    } satisfies Partial<AppError>);
  });

  it("maps admin console metrics and recent events", async () => {
    const { database, query } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ count: 14 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([
        {
          category: "auth",
          level: "info",
          message: "Signed in",
          created_at: new Date("2026-03-28T10:00:00.000Z")
        }
      ])
      .mockResolvedValueOnce([
        {
          alert_type: "storage_sync_error",
          severity: "high",
          message: "Share offline",
          created_at: new Date("2026-03-28T10:01:00.000Z")
        }
      ])
      .mockResolvedValueOnce([{ average_duration_ms: 12, server_errors: 1, total_requests: 10 }])
      .mockResolvedValueOnce([{ duration_ms: 180 }])
      .mockResolvedValueOnce([{ duration_ms: 240 }]);

    const service = createOpsService(
      database,
      baseConfig,
      {
        encrypt: vi.fn(),
        decrypt: vi.fn(),
        encryptBytes: vi.fn(),
        decryptBytes: vi.fn(),
        hashForComparison: vi.fn(),
        maskPhone: vi.fn()
      },
      loggingService as never
    );
    const overview = await service.getConsoleOverview();

    expect(overview.metrics.totalLogs).toBe(14);
    expect(overview.metrics.openAlerts).toBe(2);
    expect(overview.metrics.averageRequestDurationMs).toBe(12);
    expect(overview.recentAlerts[0]?.alertType).toBe("storage_sync_error");
  });

  it("registers backup and retention cron jobs", async () => {
    const { database, execute } = createMockDatabase();
    cronScheduleMock.mockImplementation((_expression: string, callback: () => void | Promise<void>) => ({
      stop: vi.fn(),
      run: callback
    }));

    const service = createOpsService(
      database,
      baseConfig,
      {
        encrypt: vi.fn(async () => ({ keyId: "key-1", cipherText: "cipher" })),
        decrypt: vi.fn(),
        encryptBytes: vi.fn(),
        decryptBytes: vi.fn(),
        hashForComparison: vi.fn(),
        maskPhone: vi.fn()
      },
      loggingService as never
    );

    await service.registerBackgroundJobs();
    const retentionCallback = cronScheduleMock.mock.calls[1]?.[1] as () => Promise<void>;
    await retentionCallback();

    expect(cronScheduleMock).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM access_logs"),
      [baseConfig.ACCESS_LOG_RETENTION_DAYS]
    );
  });

  it("passes dry-run restore after validating checksum and replaying backup rows to standby", async () => {
    const { database, query, execute } = createMockDatabase();
    const payload = JSON.stringify({
      users: [{ id: 1, username: "admin" }],
      user_roles: [],
      pin_credentials: [],
      sessions: [],
      failed_login_attempts: [],
      member_profiles: [],
      coach_location_assignments: [],
      coach_assignments: [],
      consent_records: [],
      face_records: [],
      face_record_versions: [],
      biometric_audit_log: [
        {
          id: 99,
          member_user_id: 1,
          face_record_id: null,
          event_type: "face_enrolled",
          details_json: JSON.stringify({ quality: "pass" }),
          actor_user_id: 1,
          created_at: "2026-03-29T10:00:00.000Z"
        }
      ],
      content_posts: [],
      content_view_events: [],
      search_events: [],
      dashboard_layouts: [],
      report_templates: [],
      report_schedules: [],
      report_exports: [],
      report_inbox_items: [],
      application_logs: [],
      access_logs: [],
      anomaly_alerts: [],
      backup_runs: [],
      recovery_dry_runs: [],
      encryption_keys: [],
      report_subscriptions: [],
      __artifactFiles: {
        uploads: {
          "member-7-1000-center.png.enc": Buffer.from("encrypted-artifact").toString("base64")
        }
      }
    });
    const checksum = createHash("sha256").update(payload).digest("hex");
    query.mockResolvedValueOnce([
      {
        id: 8,
        key_id: "key-1",
        file_path: "C:/sentinelfit/backups/backup-1.json",
        checksum
      }
    ]);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        keyId: "key-1",
        cipherText: "cipher"
      })
    );
    const standby = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => []),
      end: vi.fn(async () => {})
    };
    createConnectionMock.mockResolvedValue(standby);

    const service = createOpsService(
      database,
      baseConfig,
      {
        encrypt: vi.fn(),
        decrypt: vi.fn(async () => payload),
        encryptBytes: vi.fn(),
        decryptBytes: vi.fn(),
        hashForComparison: vi.fn(),
        maskPhone: vi.fn()
      },
      loggingService as never
    );

    const result = await service.dryRunRestore(8);

    expect(result.status).toBe("passed");
    expect(result.restoredArtifactFiles).toBe(1);
    expect(standby.execute).toHaveBeenCalled();
    const standbyQueries = standby.query.mock.calls.map((call: unknown[]) => String(call[0]).toLowerCase());
    expect(standbyQueries.some((entry: string) => entry.includes("drop trigger if exists biometric_audit_block_delete"))).toBe(true);
    expect(standbyQueries.some((entry: string) => entry.includes("create trigger biometric_audit_block_delete"))).toBe(true);
    expect(standbyQueries.some((entry: string) => entry.includes("create table if not exists maintenance_mode"))).toBe(true);
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining("recovery-artifacts"),
      expect.any(Buffer)
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO recovery_dry_runs"),
      [8, baseConfig.MYSQL_STANDBY_HOST, expect.stringContaining("\"restoredTables\":")]
    );
  });
});
