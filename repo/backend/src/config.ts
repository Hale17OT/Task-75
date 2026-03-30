import { z } from "zod";

const csvList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

const DEFAULT_MASTER_KEY_PLACEHOLDER = "REPLACE_WITH_32_BYTE_BASE64_KEY";
const AUTO_GENERATE_MASTER_KEY = "AUTO_GENERATE";
const DEFAULT_DB_USER_PLACEHOLDER = "REPLACE_WITH_DB_USER";
const DEFAULT_DB_PASSWORD_PLACEHOLDER = "REPLACE_WITH_DB_PASSWORD";
const WEAK_DB_PASSWORDS = new Set(["sentinelfit", "rootpassword", "password", "changeme", "admin123"]);

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ALLOWED_ORIGINS: csvList.default("http://localhost:5173,http://127.0.0.1:5173"),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().min(1),
  MYSQL_STANDBY_HOST: z.string().min(1).default("mysql-standby"),
  MYSQL_STANDBY_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DATA_DIR: z.string().min(1).default("/app/backend/data"),
  REPORTS_SHARED_PATH: z.string().min(1).default("/app/backend/data/shared-reports"),
  IP_ALLOWLIST: csvList.default("127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
  WARM_LOCK_MINUTES: z.coerce.number().int().min(1).default(5),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  ACCOUNT_LOCK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  HMAC_WINDOW_MINUTES: z.coerce.number().int().min(1).default(5),
  DEDUP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  BACKUP_CRON: z.string().min(1).default("0 2 * * *"),
  ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),
  BIOMETRIC_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(365 * 7),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  KEY_ROTATION_DAYS: z.coerce.number().int().min(1).default(180),
  KEY_VAULT_MASTER_KEY: z.string().min(1),
  DEMO_SEED_USERS: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

export type AppConfig = z.infer<typeof configSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const config = configSchema.parse({
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    MYSQL_HOST: env.MYSQL_HOST,
    MYSQL_PORT: env.MYSQL_PORT,
    MYSQL_DATABASE: env.MYSQL_DATABASE,
    MYSQL_USER: env.MYSQL_USER,
    MYSQL_PASSWORD: env.MYSQL_PASSWORD,
    MYSQL_STANDBY_HOST: env.MYSQL_STANDBY_HOST,
    MYSQL_STANDBY_PORT: env.MYSQL_STANDBY_PORT,
    DATA_DIR: env.DATA_DIR,
    REPORTS_SHARED_PATH: env.REPORTS_SHARED_PATH,
    IP_ALLOWLIST: env.IP_ALLOWLIST,
    SESSION_TIMEOUT_MINUTES: env.SESSION_TIMEOUT_MINUTES,
    WARM_LOCK_MINUTES: env.WARM_LOCK_MINUTES,
    LOGIN_RATE_LIMIT_PER_MINUTE: env.LOGIN_RATE_LIMIT_PER_MINUTE,
    API_RATE_LIMIT_PER_MINUTE: env.API_RATE_LIMIT_PER_MINUTE,
    AUTH_RATE_LIMIT_PER_MINUTE: env.AUTH_RATE_LIMIT_PER_MINUTE,
    ACCOUNT_LOCK_MINUTES: env.ACCOUNT_LOCK_MINUTES,
    ACCOUNT_LOCK_MAX_ATTEMPTS: env.ACCOUNT_LOCK_MAX_ATTEMPTS,
    HMAC_WINDOW_MINUTES: env.HMAC_WINDOW_MINUTES,
    DEDUP_THRESHOLD: env.DEDUP_THRESHOLD,
    BACKUP_CRON: env.BACKUP_CRON,
    ACCESS_LOG_RETENTION_DAYS: env.ACCESS_LOG_RETENTION_DAYS,
    BIOMETRIC_AUDIT_RETENTION_DAYS: env.BIOMETRIC_AUDIT_RETENTION_DAYS,
    BACKUP_RETENTION_DAYS: env.BACKUP_RETENTION_DAYS,
    KEY_ROTATION_DAYS: env.KEY_ROTATION_DAYS,
    KEY_VAULT_MASTER_KEY: env.KEY_VAULT_MASTER_KEY,
    DEMO_SEED_USERS: env.DEMO_SEED_USERS
  });

  if (config.NODE_ENV === "production" && config.IP_ALLOWLIST.length === 0) {
    throw new Error("IP_ALLOWLIST must be configured in production");
  }
  if (config.KEY_VAULT_MASTER_KEY === DEFAULT_MASTER_KEY_PLACEHOLDER) {
    throw new Error("KEY_VAULT_MASTER_KEY must be set to a non-placeholder 32-byte base64 value");
  }

  if (config.NODE_ENV !== "test") {
    if (config.MYSQL_USER === DEFAULT_DB_USER_PLACEHOLDER) {
      throw new Error("MYSQL_USER must be set to a non-placeholder value");
    }
    if (config.MYSQL_PASSWORD === DEFAULT_DB_PASSWORD_PLACEHOLDER) {
      throw new Error("MYSQL_PASSWORD must be set to a non-placeholder value");
    }
    if (WEAK_DB_PASSWORDS.has(config.MYSQL_PASSWORD.toLowerCase())) {
      throw new Error("MYSQL_PASSWORD is too weak for runtime use; provide a strong per-environment password");
    }
  }

  if (config.KEY_VAULT_MASTER_KEY !== AUTO_GENERATE_MASTER_KEY) {
    const decodedMasterKey = Buffer.from(config.KEY_VAULT_MASTER_KEY, "base64");
    if (decodedMasterKey.length !== 32 || decodedMasterKey.toString("base64") !== config.KEY_VAULT_MASTER_KEY) {
      throw new Error("KEY_VAULT_MASTER_KEY must be valid base64 and decode to exactly 32 bytes");
    }
  }

  return config;
};
