import { describe, expect, it } from "vitest";
import { migrationStatements, schemaStatements, triggerStatements } from "../src/schema.js";

describe("schema.ts — schemaStatements", () => {
  it("exports a non-empty DDL string", () => {
    expect(typeof schemaStatements).toBe("string");
    expect(schemaStatements.length).toBeGreaterThan(500);
  });

  const requiredTables = [
    "users",
    "user_roles",
    "pin_credentials",
    "sessions",
    "failed_login_attempts",
    "request_nonces",
    "member_profiles",
    "coach_assignments",
    "coach_location_assignments",
    "consent_records",
    "face_records",
    "face_record_versions",
    "biometric_audit_log",
    "liveness_challenges",
    "content_posts",
    "content_view_events",
    "search_events",
    "dashboard_layouts",
    "report_templates",
    "report_schedules",
    "report_subscriptions",
    "report_exports",
    "report_inbox_items",
    "encryption_keys",
    "application_logs",
    "access_logs",
    "anomaly_alerts",
    "backup_runs",
    "recovery_dry_runs",
    "bootstrap_guard",
    "maintenance_mode"
  ];

  it.each(requiredTables)("includes a CREATE TABLE for %s", (tableName) => {
    const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${tableName}\\b`);
    expect(pattern.test(schemaStatements)).toBe(true);
  });

  it("uses ON DELETE CASCADE for user-scoped tables", () => {
    expect(schemaStatements).toContain(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
    );
  });

  it("encrypts sensitive member fields at rest via *_encrypted + *_key_id pairs", () => {
    expect(schemaStatements).toContain("phone_encrypted");
    expect(schemaStatements).toContain("phone_key_id");
    expect(schemaStatements).toContain("session_secret");
    expect(schemaStatements).toContain("session_secret_key_id");
  });
});

describe("schema.ts — triggerStatements", () => {
  it("exports exactly the biometric immutability trigger pair (drop + create for update and delete)", () => {
    expect(Array.isArray(triggerStatements)).toBe(true);
    expect(triggerStatements).toHaveLength(4);
  });

  it("blocks UPDATE on biometric_audit_log with the canonical SQLSTATE", () => {
    const updateTrigger = triggerStatements.find((stmt) =>
      stmt.includes("biometric_audit_block_update") && stmt.includes("BEFORE UPDATE")
    );
    expect(updateTrigger).toBeTruthy();
    expect(updateTrigger).toContain("SQLSTATE '45000'");
    expect(updateTrigger).toContain("biometric_audit_log is immutable");
  });

  it("blocks DELETE on biometric_audit_log with the canonical SQLSTATE", () => {
    const deleteTrigger = triggerStatements.find((stmt) =>
      stmt.includes("biometric_audit_block_delete") && stmt.includes("BEFORE DELETE")
    );
    expect(deleteTrigger).toBeTruthy();
    expect(deleteTrigger).toContain("SQLSTATE '45000'");
  });

  it("pairs every CREATE TRIGGER with a preceding DROP TRIGGER IF EXISTS", () => {
    const drops = triggerStatements.filter((stmt) => /^\s*DROP TRIGGER/.test(stmt));
    const creates = triggerStatements.filter((stmt) => /CREATE TRIGGER/.test(stmt));
    expect(drops).toHaveLength(creates.length);
  });
});

describe("schema.ts — migrationStatements", () => {
  it("migrates biometric_audit_log foreign keys to ON DELETE RESTRICT", () => {
    expect(Array.isArray(migrationStatements)).toBe(true);
    expect(migrationStatements.length).toBeGreaterThanOrEqual(2);

    const memberFkMigration = migrationStatements.find(
      (stmt) => stmt.includes("fk_bio_member") && stmt.includes("RESTRICT")
    );
    const actorFkMigration = migrationStatements.find(
      (stmt) => stmt.includes("fk_bio_actor") && stmt.includes("RESTRICT")
    );
    expect(memberFkMigration).toBeTruthy();
    expect(actorFkMigration).toBeTruthy();
  });

  it("guards each migration with a detection query against INFORMATION_SCHEMA", () => {
    for (const stmt of migrationStatements) {
      expect(stmt).toContain("INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS");
    }
  });
});
