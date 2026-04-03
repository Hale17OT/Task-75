import type { Database } from "../database.js";

const sensitiveKeys = new Set([
  "password",
  "password_hash",
  "pin",
  "pin_hash",
  "passcode",
  "sessionsecret",
  "session_secret",
  "sessiontoken",
  "session_token",
  "token",
  "access_token",
  "refresh_token",
  "centerimagebase64",
  "turnimagebase64",
  "ciphertext",
  "averagehash",
  "average_hash",
  "biometric_hash",
  "phone",
  "phoneencrypted",
  "phone_encrypted",
  "phonelast4",
  "phone_last4",
  "governmentid",
  "government_id",
  "government_id_encrypted",
  "governmentidencrypted",
  "govid",
  "gov_id",
  "nationalid",
  "national_id"
]);

const isSensitiveKey = (key: string) => {
  const normalized = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  if (sensitiveKeys.has(normalized)) {
    return true;
  }
  return /(password|passcode|pin|session.*secret|session.*token|biometric|average.*hash|face.*hash|phone|government.*id|gov.*id|national.*id|token$|hash$)/.test(
    normalized
  );
};

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
      isSensitiveKey(key) ? "[REDACTED]" : sanitizeDetails(entry)
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
