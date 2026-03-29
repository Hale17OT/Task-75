import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";
import cron from "node-cron";
import type { RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";
import type { AppConfig } from "../config.js";
import { schemaStatements, triggerStatements } from "../schema.js";
import type { ReturnTypeOfCreateCryptoService } from "./service-utility-types.js";
import type { createLoggingService } from "./logging-service.js";

const backupTables = [
  "users",
  "user_roles",
  "pin_credentials",
  "sessions",
  "failed_login_attempts",
  "maintenance_mode",
  "member_profiles",
  "coach_assignments",
  "coach_location_assignments",
  "consent_records",
  "face_records",
  "face_record_versions",
  "biometric_audit_log",
  "content_posts",
  "content_view_events",
  "search_events",
  "dashboard_layouts",
  "report_templates",
  "report_schedules",
  "report_subscriptions",
  "report_exports",
  "report_inbox_items",
  "application_logs",
  "access_logs",
  "anomaly_alerts",
  "backup_runs",
  "recovery_dry_runs",
  "encryption_keys"
];

const normalizeRestoreValue = (value: unknown) => {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  ) {
    return value.slice(0, 19).replace("T", " ");
  }

  return value;
};

const disableImmutableAuditTriggers = async (
  standby: Awaited<ReturnType<typeof mysql.createConnection>>
) => {
  await standby.query(`DROP TRIGGER IF EXISTS biometric_audit_block_update`);
  await standby.query(`DROP TRIGGER IF EXISTS biometric_audit_block_delete`);
};

const enableImmutableAuditTriggers = async (
  standby: Awaited<ReturnType<typeof mysql.createConnection>>
) => {
  for (const statement of triggerStatements) {
    await standby.query(statement);
  }
};

export const createOpsService = (
  database: Database,
  config: AppConfig,
  cryptoService: ReturnTypeOfCreateCryptoService,
  loggingService: ReturnType<typeof createLoggingService>
) => {
  const backupDir = join(config.DATA_DIR, "backups");
  const uploadsDir = join(config.DATA_DIR, "uploads");
  const recoveryArtifactDir = join(config.DATA_DIR, "recovery-artifacts");
  const setStandbyMaintenanceMode = async (
    standby: Awaited<ReturnType<typeof mysql.createConnection>>,
    enabled: boolean,
    reason: string
  ) => {
    await standby.query(
      `CREATE TABLE IF NOT EXISTS maintenance_mode (
         id TINYINT PRIMARY KEY,
         is_enabled TINYINT(1) NOT NULL DEFAULT 0,
         reason VARCHAR(255) NULL,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       )`
    );
    await standby.execute(
      `INSERT INTO maintenance_mode (id, is_enabled, reason)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), reason = VALUES(reason), updated_at = CURRENT_TIMESTAMP`,
      [enabled ? 1 : 0, reason]
    );
  };

  const collectBackupPayload = async () => {
    const payload: Record<string, unknown> = {};

    for (const table of backupTables) {
      payload[table] = await database.query<RowDataPacket[]>(`SELECT * FROM ${table}`);
    }

    let uploads: Record<string, string> = {};
    try {
      const artifactFiles = (await readdir(uploadsDir)).filter((file) => file.endsWith(".enc"));
      uploads = Object.fromEntries(
        await Promise.all(
          artifactFiles.map(async (fileName) => {
            const content = await readFile(join(uploadsDir, fileName));
            return [fileName, content.toString("base64")] as const;
          })
        )
      );
    } catch {
      uploads = {};
    }

    payload.__artifactFiles = {
      uploads
    };

    return payload;
  };

  const writeBackup = async () => {
    const startedAt = Date.now();
    await mkdir(backupDir, { recursive: true });
    const payload = await collectBackupPayload();
    const serialized = JSON.stringify(payload);
    const encrypted = await cryptoService.encrypt(serialized);
    const checksum = createHash("sha256").update(serialized).digest("hex");
    const filePath = join(backupDir, `backup-${Date.now()}.json`);

    await writeFile(filePath, JSON.stringify(encrypted, null, 2), "utf8");
    await database.execute(
      `INSERT INTO backup_runs (key_id, file_path, checksum, status, completed_at)
       VALUES (?, ?, ?, 'completed', UTC_TIMESTAMP())`,
      [encrypted.keyId, filePath, checksum]
    );
    const [backupRow] = await database.query<RowDataPacket[]>(
      `SELECT id FROM backup_runs ORDER BY created_at DESC LIMIT 1`
    );

    const files = (await readdir(backupDir))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length > config.BACKUP_RETENTION_DAYS) {
      for (const oldFile of files.slice(config.BACKUP_RETENTION_DAYS)) {
        await rm(join(backupDir, oldFile), { force: true });
      }
    }

    await loggingService.log("backup", "info", "Encrypted backup completed", {
      checksum,
      keyId: encrypted.keyId,
      durationMs: Date.now() - startedAt
    });

    return {
      id: Number(backupRow.id),
      keyId: encrypted.keyId,
      filePath,
      checksum
    };
  };

  const createStandbyConnection = async () =>
    mysql.createConnection({
      host: config.MYSQL_STANDBY_HOST,
      port: config.MYSQL_STANDBY_PORT,
      user: config.MYSQL_USER,
      password: config.MYSQL_PASSWORD,
      database: config.MYSQL_DATABASE,
      multipleStatements: true
    });

  const ensureStandbyColumn = async (
    standby: Awaited<ReturnType<typeof createStandbyConnection>>,
    tableName: string,
    columnName: string,
    alterStatement: string
  ) => {
    const result = await standby.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [tableName, columnName]
    );
    const rows = Array.isArray(result[0]) ? (result[0] as RowDataPacket[]) : (result as RowDataPacket[]);

    if (rows.length === 0) {
      await standby.query(alterStatement);
    }
  };

  return {
    async registerBackgroundJobs() {
      cron.schedule(config.BACKUP_CRON, () => {
        void writeBackup();
      });

      cron.schedule("0 3 * * *", async () => {
        await database.execute(
          `DELETE FROM access_logs
           WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
          [config.ACCESS_LOG_RETENTION_DAYS]
        );
      });

      cron.schedule("0 4 1 * *", async () => {
        const [oldestBiometricAudit] = await database.query<RowDataPacket[]>(
          `SELECT MIN(created_at) AS oldest_created_at FROM biometric_audit_log`
        );
        await loggingService.log("retention", "info", "Biometric audit retention review completed", {
          retentionDays: config.BIOMETRIC_AUDIT_RETENTION_DAYS,
          oldestCreatedAt: oldestBiometricAudit?.oldest_created_at
            ? new Date(oldestBiometricAudit.oldest_created_at).toISOString()
            : null
        });
      });
    },

    async getConsoleOverview() {
      const [logCount] = await database.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM application_logs`
      );
      const [alertCount] = await database.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM anomaly_alerts WHERE status = 'open'`
      );
      const recentLogs = await database.query<RowDataPacket[]>(
        `SELECT category, level, message, created_at FROM application_logs ORDER BY created_at DESC LIMIT 20`
      );
      const recentAlerts = await database.query<RowDataPacket[]>(
        `SELECT alert_type, severity, message, created_at FROM anomaly_alerts ORDER BY created_at DESC LIMIT 20`
      );
      const [requestMetrics] = await database.query<RowDataPacket[]>(
        `SELECT COALESCE(AVG(duration_ms), 0) AS average_duration_ms,
                COALESCE(SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END), 0) AS server_errors,
                COUNT(*) AS total_requests
         FROM access_logs
         WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)`
      );
      const [lastReportLog] = await database.query<RowDataPacket[]>(
        `SELECT JSON_EXTRACT(details_json, '$.durationMs') AS duration_ms
         FROM application_logs
         WHERE category = 'reporting' AND message = 'Report export completed'
         ORDER BY created_at DESC
         LIMIT 1`
      );
      const [lastBackupLog] = await database.query<RowDataPacket[]>(
        `SELECT JSON_EXTRACT(details_json, '$.durationMs') AS duration_ms
         FROM application_logs
         WHERE category = 'backup' AND message = 'Encrypted backup completed'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      return {
        metrics: {
          totalLogs: Number(logCount.count),
          openAlerts: Number(alertCount.count),
          uptimeSeconds: Math.floor(process.uptime()),
          averageRequestDurationMs: Number(requestMetrics.average_duration_ms ?? 0),
          serverErrorRate:
            Number(requestMetrics.total_requests) === 0
              ? 0
              : Number(requestMetrics.server_errors) / Number(requestMetrics.total_requests),
          lastReportDurationMs: Number(lastReportLog?.duration_ms ?? 0),
          lastBackupDurationMs: Number(lastBackupLog?.duration_ms ?? 0)
        },
        recentLogs: recentLogs.map((row) => ({
          category: String(row.category),
          level: String(row.level),
          message: String(row.message),
          createdAt: new Date(row.created_at).toISOString()
        })),
        recentAlerts: recentAlerts.map((row) => ({
          alertType: String(row.alert_type),
          severity: String(row.severity),
          message: String(row.message),
          createdAt: new Date(row.created_at).toISOString()
        }))
      };
    },

    async createBackupNow() {
      return writeBackup();
    },

    async dryRunRestore(backupRunId: number) {
      const startedAt = Date.now();
      const rows = await database.query<RowDataPacket[]>(
        `SELECT id, key_id, file_path, checksum FROM backup_runs WHERE id = ? LIMIT 1`,
        [backupRunId]
      );
      const backup = rows[0];
      const encrypted = JSON.parse(await readFile(String(backup.file_path), "utf8")) as {
        keyId: string;
        cipherText: string;
      };
      const decrypted = await cryptoService.decrypt(encrypted);
      const checksum = createHash("sha256").update(decrypted).digest("hex");

      if (checksum !== String(backup.checksum)) {
        await database.execute(
          `INSERT INTO recovery_dry_runs (backup_run_id, target_instance, status, error_message, completed_at)
           VALUES (?, ?, 'failed', ?, UTC_TIMESTAMP())`,
          [backupRunId, config.MYSQL_STANDBY_HOST, "Backup checksum mismatch"]
        );
        await loggingService.log("recovery", "error", "Dry-run restore failed", {
          backupRunId,
          reason: "Backup checksum mismatch",
          durationMs: Date.now() - startedAt
        });
        return {
          status: "failed",
          message: "Backup checksum mismatch"
        };
      }

      const payload = JSON.parse(decrypted) as Record<string, Array<Record<string, unknown>>>;
      const artifactPayload = payload.__artifactFiles as { uploads?: Record<string, string> } | undefined;
      const standby = await createStandbyConnection();

      try {
        await standby.query(schemaStatements);
        await ensureStandbyColumn(
          standby,
          "sessions",
          "station_token",
          `ALTER TABLE sessions
           ADD COLUMN station_token VARCHAR(100) NOT NULL DEFAULT 'Unknown-Station' AFTER session_secret`
        );
        await ensureStandbyColumn(
          standby,
          "sessions",
          "session_secret_key_id",
          `ALTER TABLE sessions
           ADD COLUMN session_secret_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER session_secret`
        );
        await ensureStandbyColumn(
          standby,
          "access_logs",
          "duration_ms",
          `ALTER TABLE access_logs
           ADD COLUMN duration_ms INT NOT NULL DEFAULT 0 AFTER status_code`
        );
        await ensureStandbyColumn(
          standby,
          "face_record_versions",
          "center_image_key_id",
          `ALTER TABLE face_record_versions
           ADD COLUMN center_image_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER center_image_path`
        );
        await ensureStandbyColumn(
          standby,
          "face_record_versions",
          "turn_image_key_id",
          `ALTER TABLE face_record_versions
           ADD COLUMN turn_image_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER turn_image_path`
        );
        await ensureStandbyColumn(
          standby,
          "face_record_versions",
          "average_hash_key_id",
          `ALTER TABLE face_record_versions
           ADD COLUMN average_hash_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER average_hash`
        );
        await setStandbyMaintenanceMode(standby, true, "dry_run_restore");
        await disableImmutableAuditTriggers(standby);
        for (const table of [...backupTables].reverse()) {
          await standby.query(`DELETE FROM ${table}`);
        }

        for (const table of backupTables) {
          const rowsForTable = payload[table] ?? [];
          for (const row of rowsForTable) {
            const columns = Object.keys(row);
            if (columns.length === 0) {
              continue;
            }
            const placeholders = columns.map(() => "?").join(", ");
            await standby.execute(
              `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
              columns.map((column) => normalizeRestoreValue(row[column])) as never[]
            );
          }
        }

        const restoredArtifacts = Object.entries(artifactPayload?.uploads ?? {});
        if (restoredArtifacts.length > 0) {
          const restoreTarget = join(recoveryArtifactDir, String(backupRunId), "uploads");
          await mkdir(restoreTarget, { recursive: true });
          for (const [fileName, encodedContent] of restoredArtifacts) {
            await writeFile(join(restoreTarget, fileName), Buffer.from(encodedContent, "base64"));
          }
        }
        await enableImmutableAuditTriggers(standby);
        await setStandbyMaintenanceMode(standby, false, "dry_run_restore_complete");

        await database.execute(
          `INSERT INTO recovery_dry_runs (backup_run_id, target_instance, status, summary_json, completed_at)
           VALUES (?, ?, 'passed', ?, UTC_TIMESTAMP())`,
          [
            backupRunId,
            config.MYSQL_STANDBY_HOST,
            JSON.stringify({
              restoredTables: backupTables.length,
              checksum,
              restoredArtifactFiles: Object.keys(artifactPayload?.uploads ?? {}).length
            })
          ]
        );

        await loggingService.log("recovery", "info", "Dry-run restore passed", {
          backupRunId,
          checksum,
          durationMs: Date.now() - startedAt
        });

        return {
          status: "passed",
          restoredTables: backupTables.length,
          checksum,
          restoredArtifactFiles: Object.keys(artifactPayload?.uploads ?? {}).length
        };
      } finally {
        try {
          await enableImmutableAuditTriggers(standby);
        } catch {
          // Ignore best-effort trigger re-enable errors during cleanup.
        }
        try {
          await setStandbyMaintenanceMode(standby, false, "dry_run_restore_cleanup");
        } catch {
          // Ignore best-effort maintenance-mode cleanup errors during shutdown.
        }
        await standby.end();
      }
    }
  };
};
