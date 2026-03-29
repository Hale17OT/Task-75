import { describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.js";
import { createLoggingService } from "../src/services/logging-service.js";

describe("logging service", () => {
  it("writes structured application, alert, and access logs", async () => {
    const execute = vi.fn();
    const service = createLoggingService({
      pool: {} as Database["pool"],
      query: vi.fn(),
      execute,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database);

    await service.log("auth", "info", "User signed in", { userId: 1 });
    await service.alert("storage_sync_error", "high", "Share offline");
    await service.access({
      userId: 1,
      ipAddress: "127.0.0.1",
      method: "GET",
      path: "/api/admin/console",
      statusCode: 200,
      durationMs: 18,
      stationToken: "Front-Desk-01"
    });

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("handles optional log details and nullable access context without leaking defaults", async () => {
    const execute = vi.fn();
    const service = createLoggingService({
      pool: {} as Database["pool"],
      query: vi.fn(),
      execute,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database);

    await service.log("reporting", "warn", "Shared write skipped");
    await service.access({
      ipAddress: "127.0.0.1",
      method: "POST",
      path: "/api/content/views",
      statusCode: 202,
      durationMs: 24
    });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO application_logs"),
      ["reporting", "warn", "Shared write skipped", null]
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO access_logs"),
      [null, "127.0.0.1", "POST", "/api/content/views", 202, 24, null]
    );
  });

  it("redacts secrets and biometric payloads from persisted application logs", async () => {
    const execute = vi.fn();
    const service = createLoggingService({
      pool: {} as Database["pool"],
      query: vi.fn(),
      execute,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database);

    await service.log("auth", "warn", "Rejected request", {
      password: "Admin12345!X",
      pin: "1234",
      sessionSecret: "super-secret",
      centerImageBase64: "data:image/png;base64,abc",
      nested: {
        session_token: "raw-cookie",
        average_hash: "template-value"
      }
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO application_logs"),
      [
        "auth",
        "warn",
        "Rejected request",
        JSON.stringify({
          password: "[REDACTED]",
          pin: "[REDACTED]",
          sessionSecret: "[REDACTED]",
          centerImageBase64: "[REDACTED]",
          nested: {
            session_token: "[REDACTED]",
            average_hash: "[REDACTED]"
          }
        })
      ]
    );
  });
});
