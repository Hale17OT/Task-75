import type { Database } from "../database.js";

const sensitiveKeys = new Set([
  "password",
  "pin",
  "sessionSecret",
  "session_secret",
  "sessionToken",
  "session_token",
  "centerImageBase64",
  "turnImageBase64",
  "cipherText",
  "averageHash",
  "average_hash"
]);

const sanitizeDetails = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDetails(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveKeys.has(key) ? "[REDACTED]" : sanitizeDetails(entry)
    ])
  );
};

export const createLoggingService = (database: Database) => ({
  async log(category: string, level: string, message: string, details?: Record<string, unknown>) {
    await database.execute(
      `INSERT INTO application_logs (category, level, message, details_json)
       VALUES (?, ?, ?, ?)`,
      [category, level, message, details ? JSON.stringify(sanitizeDetails(details)) : null]
    );
  },
  async alert(alertType: string, severity: string, message: string) {
    await database.execute(
      `INSERT INTO anomaly_alerts (alert_type, severity, message) VALUES (?, ?, ?)`,
      [alertType, severity, message]
    );
  },
  async access(params: {
    userId?: number | null;
    ipAddress: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    stationToken?: string | null;
  }) {
    await database.execute(
      `INSERT INTO access_logs (user_id, ip_address, method, path, status_code, duration_ms, station_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.userId ?? null,
        params.ipAddress,
        params.method,
        params.path,
        params.statusCode,
        params.durationMs,
        params.stationToken ?? null
      ]
    );
  }
});
