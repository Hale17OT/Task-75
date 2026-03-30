import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses a valid environment", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      PORT: "4000",
      ALLOWED_ORIGINS: "http://localhost:5173",
        MYSQL_HOST: "mysql",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "sentinelfit",
        MYSQL_USER: "ops_app",
        MYSQL_PASSWORD: "StrongDbPassword123!",
        KEY_VAULT_MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
      });

    expect(config.PORT).toBe(4000);
    expect(config.MYSQL_HOST).toBe("mysql");
    expect(config.API_RATE_LIMIT_PER_MINUTE).toBe(60);
    expect(config.AUTH_RATE_LIMIT_PER_MINUTE).toBe(60);
    expect(config.IP_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it("throws when required mysql fields are missing", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:5173"
      })
    ).toThrow();
  });

  it("rejects production boot when the IP allowlist is empty", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:5173",
        MYSQL_HOST: "mysql",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "sentinelfit",
        MYSQL_USER: "ops_app",
        MYSQL_PASSWORD: "StrongDbPassword123!",
        KEY_VAULT_MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        IP_ALLOWLIST: ""
      })
    ).toThrow("IP_ALLOWLIST");
  });

  it("rejects placeholder key-vault master key values", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:5173",
        MYSQL_HOST: "mysql",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "sentinelfit",
        MYSQL_USER: "ops_app",
        MYSQL_PASSWORD: "StrongDbPassword123!",
        KEY_VAULT_MASTER_KEY: "REPLACE_WITH_32_BYTE_BASE64_KEY"
      })
    ).toThrow("KEY_VAULT_MASTER_KEY");
  });

  it("rejects placeholder or weak runtime mysql credentials", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:5173",
        MYSQL_HOST: "mysql",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "sentinelfit",
        MYSQL_USER: "REPLACE_WITH_DB_USER",
        MYSQL_PASSWORD: "REPLACE_WITH_DB_PASSWORD",
        KEY_VAULT_MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
      })
    ).toThrow("MYSQL_USER");

    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:5173",
        MYSQL_HOST: "mysql",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "sentinelfit",
        MYSQL_USER: "ops_app",
        MYSQL_PASSWORD: "sentinelfit",
        KEY_VAULT_MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
      })
    ).toThrow("MYSQL_PASSWORD");
  });
});
