import { mkdir } from "node:fs/promises";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";
import type { AppConfig } from "./config.js";
import { migrationStatements, schemaStatements, triggerStatements } from "./schema.js";

export interface Database {
  pool: Pool;
  query<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  executeInTransaction<T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
  initialize(): Promise<void>;
}

type DemoSeedUser = {
  username: string;
  fullName: string;
  password: string;
  roles: string[];
  locationCode?: string;
  notes?: string;
  coachUsername?: string;
  consentStatus?: "granted" | "declined";
};

const seededUsers: DemoSeedUser[] = [
  {
    username: "admin",
    fullName: "System Administrator",
    password: "Admin12345!X",
    roles: ["Administrator"]
  },
  {
    username: "coach",
    fullName: "Default Coach",
    password: "Coach12345!X",
    roles: ["Coach"]
  },
  {
    username: "member",
    fullName: "Default Member",
    password: "Member12345!X",
    roles: ["Member"],
    locationCode: "HQ",
    notes: "Seeded member profile",
    coachUsername: "coach",
    consentStatus: "granted"
  }
];

export const createDatabase = (config: AppConfig): Database => {
  const createPoolForCredentials = (user: string, password: string) => mysql.createPool({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user,
    password,
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    multipleStatements: true
  });

  let pool = createPoolForCredentials(config.MYSQL_USER, config.MYSQL_PASSWORD);

  return {
    get pool() {
      return pool;
    },
    async query<T extends RowDataPacket[]>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.query<T>(sql, params);
      return rows;
    },
    async execute(sql: string, params: unknown[] = []) {
      await pool.execute(sql, params as never[]);
    },
    async executeInTransaction<T>(callback: (connection: PoolConnection) => Promise<T>) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async close() {
      await pool.end();
    },
    async ping() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async initialize() {
      const initializeWithCurrentPool = async () => {
      await mkdir(config.DATA_DIR, { recursive: true });
      await mkdir(`${config.DATA_DIR}/uploads`, { recursive: true });
      await mkdir(`${config.DATA_DIR}/backups`, { recursive: true });
      await mkdir(config.REPORTS_SHARED_PATH, { recursive: true });

      await pool.query(schemaStatements);
      for (const statement of migrationStatements) {
        await pool.query(statement);
      }

      const ensureColumn = async (tableName: string, columnName: string, alterStatement: string) => {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = ?
             AND COLUMN_NAME = ?
           LIMIT 1`,
          [tableName, columnName]
        );

        if (rows.length === 0) {
          await pool.query(alterStatement);
        }
      };

      await ensureColumn(
        "sessions",
        "station_token",
        `ALTER TABLE sessions
         ADD COLUMN station_token VARCHAR(100) NOT NULL DEFAULT 'Unknown-Station' AFTER session_secret`
      );
      await ensureColumn(
        "sessions",
        "session_secret_key_id",
        `ALTER TABLE sessions
         ADD COLUMN session_secret_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER session_secret`
      );
      await ensureColumn(
        "sessions",
        "workstation_binding_hash",
        `ALTER TABLE sessions
         ADD COLUMN workstation_binding_hash VARCHAR(255) NULL AFTER station_token`
      );
      await ensureColumn(
        "sessions",
        "warm_locked_at",
        `ALTER TABLE sessions
         ADD COLUMN warm_locked_at DATETIME NULL AFTER workstation_binding_hash`
      );
      await ensureColumn(
        "access_logs",
        "duration_ms",
        `ALTER TABLE access_logs
         ADD COLUMN duration_ms INT NOT NULL DEFAULT 0 AFTER status_code`
      );
      await ensureColumn(
        "report_schedules",
        "export_format",
        `ALTER TABLE report_schedules
         ADD COLUMN export_format VARCHAR(16) NOT NULL DEFAULT 'pdf' AFTER cron_expression`
      );
      await ensureColumn(
        "coach_location_assignments",
        "is_active",
        `ALTER TABLE coach_location_assignments
         ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER location_code`
      );
      await ensureColumn(
        "face_record_versions",
        "center_image_key_id",
        `ALTER TABLE face_record_versions
         ADD COLUMN center_image_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER center_image_path`
      );
      await ensureColumn(
        "face_record_versions",
        "turn_image_key_id",
        `ALTER TABLE face_record_versions
         ADD COLUMN turn_image_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER turn_image_path`
      );
      await ensureColumn(
        "face_record_versions",
        "average_hash_key_id",
        `ALTER TABLE face_record_versions
         ADD COLUMN average_hash_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy' AFTER average_hash`
      );

      const [averageHashRows] = await pool.query<RowDataPacket[]>(
        `SELECT DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'face_record_versions'
           AND COLUMN_NAME = 'average_hash'
         LIMIT 1`
      );
      if (averageHashRows[0] && String(averageHashRows[0].DATA_TYPE).toLowerCase() !== "text") {
        await pool.query(`ALTER TABLE face_record_versions MODIFY COLUMN average_hash TEXT NOT NULL`);
      }

      for (const statement of triggerStatements) {
        await pool.query(statement);
      }

      await pool.execute(
        `INSERT IGNORE INTO maintenance_mode (id, is_enabled, reason)
         VALUES (1, 0, 'normal_operation')`
      );

      if (config.DEMO_SEED_USERS) {
        const seededUserIds = new Map<string, number>();

        for (const user of seededUsers) {
          const passwordHash = await bcrypt.hash(user.password, 10);
          await pool.execute(
            `INSERT INTO users (username, full_name, password_hash)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
            [user.username, user.fullName, passwordHash]
          );

          const [userRows] = await pool.query<RowDataPacket[]>(
            "SELECT id FROM users WHERE username = ? LIMIT 1",
            [user.username]
          );
          const userId = Number(userRows[0].id);
          seededUserIds.set(user.username, userId);

          for (const role of user.roles) {
            await pool.execute(
              `INSERT IGNORE INTO user_roles (user_id, role_name) VALUES (?, ?)`,
              [userId, role]
            );
          }

          if (user.roles.includes("Coach") || user.roles.includes("Administrator")) {
            await pool.execute(
              `INSERT IGNORE INTO coach_location_assignments (coach_user_id, location_code, is_active)
               VALUES (?, 'HQ', 1)`,
              [userId]
            );
          }

          if (user.roles.includes("Member")) {
            await pool.execute(
              `INSERT IGNORE INTO member_profiles (user_id, location_code, notes) VALUES (?, ?, ?)`,
              [userId, user.locationCode ?? "HQ", user.notes ?? "Seeded member profile"]
            );
          }
        }

        for (const user of seededUsers) {
          const memberUserId = seededUserIds.get(user.username);
          const coachUserId = user.coachUsername ? seededUserIds.get(user.coachUsername) : undefined;

          if (memberUserId && coachUserId) {
            await pool.execute(
              `INSERT INTO coach_assignments (member_user_id, coach_user_id, is_active)
               SELECT ?, ?, 1
               FROM DUAL
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM coach_assignments
                 WHERE member_user_id = ? AND coach_user_id = ? AND is_active = 1
               )`,
              [memberUserId, coachUserId, memberUserId, coachUserId]
            );
          }

          const adminUserId = seededUserIds.get("admin");
          if (memberUserId && adminUserId && user.consentStatus) {
            await pool.execute(
              `INSERT INTO consent_records (member_user_id, consent_type, consent_status, recorded_by_user_id)
               SELECT ?, 'face_enrollment', ?, ?
               FROM DUAL
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM consent_records
                 WHERE member_user_id = ?
                   AND consent_type = 'face_enrollment'
                   AND consent_status = ?
               )`,
              [memberUserId, user.consentStatus, adminUserId, memberUserId, user.consentStatus]
            );
          }
        }
      }
      };

      await initializeWithCurrentPool();
    }
  };
};
