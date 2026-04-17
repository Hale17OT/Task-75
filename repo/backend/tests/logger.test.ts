import { describe, expect, it } from "vitest";
import { logger } from "../src/logger.js";

describe("logger", () => {
  it("exposes the standard pino API surface", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("accepts structured payloads without throwing for any standard level", () => {
    expect(() => logger.info({ event: "logger_test_info" }, "info message")).not.toThrow();
    expect(() => logger.warn({ event: "logger_test_warn" }, "warn message")).not.toThrow();
    expect(() => logger.error({ event: "logger_test_error" }, "error message")).not.toThrow();
    expect(() => logger.debug({ event: "logger_test_debug" }, "debug message")).not.toThrow();
  });

  it("accepts a child binding without throwing", () => {
    const child = logger.child({ scope: "logger.test" });
    expect(() => child.info({ event: "child_info" }, "child message")).not.toThrow();
  });
});
