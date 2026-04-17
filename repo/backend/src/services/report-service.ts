import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute as isAbsolutePath, join, relative as relativePath, resolve as resolvePath } from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import cron, { type ScheduledTask } from "node-cron";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { ReturnTypeOfCreateContentService } from "./service-type-helpers.js";
import type { ReturnTypeOfCreateDashboardService } from "./service-type-helpers.js";
import type { createLoggingService } from "./logging-service.js";
import type { AuthenticatedUser } from "../types.js";

type ExportFormat = "csv" | "excel" | "pdf";
type ReportWidget = {
  id: string;
  widgetType?: string;
  title?: string;
  locationCode?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type ReportSection = {
  title: string;
  rows: Array<{ label: string; value: string | number }>;
};

const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, "\"\"")}"`;
const parseJsonColumn = <T>(value: T | string): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

const coerceNumberList = (value: unknown) =>
  Array.isArray(value) ? value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0) : [];

const streamToBuffer = async (document: InstanceType<typeof PDFDocument>) =>
  await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

export const createReportService = (
  database: Database,
  config: AppConfig,
  contentService: { analytics: ReturnTypeOfCreateContentService["analytics"] } & Record<string, unknown>,
  dashboardService: ReturnTypeOfCreateDashboardService,
  loggingService: ReturnType<typeof createLoggingService>
) => {
  const scheduledJobs = new Map<number, ScheduledTask>();
  const loadAuthorizedOwner = async (ownerUserId: number, connection?: PoolConnection): Promise<AuthenticatedUser> => {
    const ownerRows = connection
      ? (await connection.query<RowDataPacket[]>(
          `SELECT id, username, full_name, active
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [ownerUserId]
        ))[0]
      : await database.query<RowDataPacket[]>(
          `SELECT id, username, full_name, active
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [ownerUserId]
        );
    const owner = ownerRows[0];
    if (!owner || !Number(owner.active)) {
      throw new AppError(403, "report_owner_inactive", "The report schedule owner is inactive");
    }

    const roleRows = connection
      ? (await connection.query<RowDataPacket[]>(
          `SELECT role_name
           FROM user_roles
           WHERE user_id = ?`,
          [ownerUserId]
        ))[0]
      : await database.query<RowDataPacket[]>(
          `SELECT role_name
           FROM user_roles
           WHERE user_id = ?`,
          [ownerUserId]
        );
    const directRoles = roleRows.map((row: RowDataPacket) => String(row.role_name));
    const roleSet = new Set<string>(directRoles);
    if (roleSet.has("Administrator")) {
      roleSet.add("Coach");
      roleSet.add("Member");
    }
    if (roleSet.has("Coach")) {
      roleSet.add("Member");
    }
    const roles = Array.from(roleSet);
    if (!roles.includes("Administrator")) {
      throw new AppError(403, "report_owner_unauthorized", "The report schedule owner is no longer an administrator");
    }

    return {
      id: Number(owner.id),
      username: String(owner.username),
      fullName: String(owner.full_name),
      roles: roles as AuthenticatedUser["roles"]
    };
  };

  const buildSections = (
    layout: ReportWidget[],
    analytics: {
      viewsByStation: Array<{ stationToken: string; views: number }>;
      topPosts: Array<{ title: string; views: number }>;
      searchTrends: Array<{ term: string; uses: number }>;
    },
    totalMembers: number
  ) => {
    const sections: ReportSection[] = [
      {
        title: "Summary",
        rows: [{ label: "Total members", value: totalMembers }]
      }
    ];

    for (const widget of layout) {
      const widgetType = widget.widgetType ?? widget.id;
      if (widgetType === "viewsByStation") {
        sections.push({
          title: widget.title ?? "Views by station",
          rows: analytics.viewsByStation.map((entry) => ({
            label: entry.stationToken,
            value: entry.views
          }))
        });
      } else if (widgetType === "topPosts") {
        sections.push({
          title: widget.title ?? "Top posts",
          rows: analytics.topPosts.map((entry) => ({
            label: entry.title,
            value: entry.views
          }))
        });
      } else if (widgetType === "searchTrends") {
        sections.push({
          title: widget.title ?? "Search trends",
          rows: analytics.searchTrends.map((entry) => ({
            label: entry.term,
            value: entry.uses
          }))
        });
      }
    }

    return sections;
  };

  const buildReportPayload = async (templateId: number, actor: AuthenticatedUser, locationCode?: string | null) => {
    const templateRows = await database.query<RowDataPacket[]>(
      `SELECT id, name, layout_json FROM report_templates WHERE id = ? LIMIT 1`,
      [templateId]
    );
    const template = templateRows[0];
    if (!template) {
      throw new AppError(404, "report_template_not_found", "Report template was not found");
    }

    const analytics = await contentService.analytics(actor, {
      locationCode: locationCode ?? undefined,
      includeHistorical: false
    });
    const memberRows = locationCode
      ? await database.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total_members
           FROM member_profiles
           WHERE location_code = ?`,
          [locationCode]
        )
      : await database.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total_members FROM member_profiles`
        );
    const layoutSnapshot = await dashboardService.getLayout(actor.id);
    const templateLayout = parseJsonColumn<ReportWidget[]>(template.layout_json);
    const sections = buildSections(templateLayout, analytics, Number(memberRows[0].total_members));

    return {
      template: {
        id: Number(template.id),
        name: String(template.name),
        layout: templateLayout
      },
      generatedAt: new Date().toISOString(),
      analytics,
      totalMembers: Number(memberRows[0].total_members),
      layoutSnapshot,
      sections,
      ownerUserId: actor.id
    };
  };

  const writeReportFile = async (format: ExportFormat, name: string, payload: unknown) => {
    await mkdir(config.REPORTS_SHARED_PATH, { recursive: true });
    await mkdir(join(config.DATA_DIR, "reports"), { recursive: true });

    const timestamp = Date.now();
    const baseName = `${name.replace(/\s+/g, "-").toLowerCase()}-${timestamp}`;
    const localFilePath = join(config.DATA_DIR, "reports", `${baseName}.${format === "excel" ? "xlsx" : format}`);
    const sharedFilePath = join(
      config.REPORTS_SHARED_PATH,
      `${baseName}.${format === "excel" ? "xlsx" : format}`
    );

    let buffer: Buffer;
    const sections = (payload as { sections?: ReportSection[] }).sections ?? [];
    if (format === "csv") {
      const rows: Array<Array<string | number>> = [["Section", "Label", "Value"]];
      rows.push(["Summary", "Generated At", String((payload as Record<string, unknown>).generatedAt)]);
      for (const section of sections) {
        for (const row of section.rows) {
          rows.push([section.title, row.label, row.value]);
        }
      }
      buffer = Buffer.from(rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");
    } else if (format === "excel") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Report");
      sheet.addRow(["Generated At", String((payload as Record<string, unknown>).generatedAt)]);
      for (const section of sections) {
        sheet.addRow([]);
        sheet.addRow([section.title, "Value"]);
        for (const row of section.rows) {
          sheet.addRow([row.label, row.value]);
        }
      }
      buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    } else {
      const document = new PDFDocument();
      document.fontSize(18).text("SentinelFit Scheduled Report");
      document.moveDown();
      document.fontSize(12).text(`Generated at: ${String((payload as Record<string, unknown>).generatedAt)}`);
      for (const section of sections) {
        document.moveDown();
        document.font("Helvetica-Bold").text(section.title);
        document.font("Helvetica");
        for (const row of section.rows) {
          document.text(`- ${String(row.label)}: ${String(row.value)}`);
        }
      }
      document.end();
      buffer = await streamToBuffer(document);
    }

    await writeFile(localFilePath, buffer);

    let sharedWriteError: string | null = null;
    try {
      await writeFile(sharedFilePath, buffer);
    } catch (error) {
      sharedWriteError = error instanceof Error ? error.message : "Storage Sync Error";
    }

    return {
      localFilePath,
      sharedFilePath: sharedWriteError ? null : sharedFilePath,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      sharedWriteError
    };
  };

  const generate = async (
    templateId: number,
    format: ExportFormat,
    createdByUserId: number,
    scheduleId?: number,
    locationCode?: string | null
  ) => {
    const startedAt = Date.now();
    const ownerActor = await loadAuthorizedOwner(createdByUserId);
    const payload = await buildReportPayload(templateId, ownerActor, locationCode);
    const exportName = (payload.template as { name: string }).name;

    try {
      const files = await writeReportFile(format, exportName, payload);
      const exportStatus = files.sharedWriteError ? "partial_failure" : "completed";
      const recipientRows =
        scheduleId
          ? await database.query<RowDataPacket[]>(
              `SELECT user_id FROM report_subscriptions WHERE schedule_id = ?`,
              [scheduleId]
            )
          : [];
      const recipientIds = scheduleId
        ? recipientRows.map((row) => Number(row.user_id))
        : [createdByUserId];
      const resolvedRecipientIds = recipientIds.length > 0 ? recipientIds : [createdByUserId];
      const exportId = await database.executeInTransaction(async (connection) => {
        const [exportInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO report_exports (schedule_id, template_id, export_format, file_path, shared_file_path, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            scheduleId ?? null,
            templateId,
            format,
            files.localFilePath,
            files.sharedFilePath,
            exportStatus
          ]
        );
        const insertedExportId = Number(exportInsert.insertId);

        for (const recipientId of resolvedRecipientIds) {
          await connection.execute(
            `INSERT INTO report_inbox_items (user_id, report_export_id, title)
             VALUES (?, ?, ?)`,
            [recipientId, insertedExportId, `${exportName} (${format.toUpperCase()})`]
          );
        }

        if (scheduleId) {
          await connection.execute(
            `UPDATE report_schedules SET last_run_at = UTC_TIMESTAMP() WHERE id = ?`,
            [scheduleId]
          );
        }

        await connection.execute(
          `INSERT INTO application_logs (category, level, message, details_json)
           VALUES ('reporting', 'info', 'Report export persisted', ?)`,
          [
            JSON.stringify({
              exportId: insertedExportId,
              scheduleId: scheduleId ?? null,
              templateId,
              format,
              recipientCount: resolvedRecipientIds.length
            })
          ]
        );

        return insertedExportId;
      });

      if (files.sharedWriteError) {
        await loggingService.alert(
          "storage_sync_error",
          "high",
          `Report export ${exportId} could not be written to the shared folder`
        );
        await loggingService.log("reporting", "warn", "Shared report delivery failed", {
          exportId,
          scheduleId: scheduleId ?? null,
          templateId,
          sharedPath: config.REPORTS_SHARED_PATH,
          error: files.sharedWriteError,
          durationMs: Date.now() - startedAt
        });
      } else {
        await loggingService.log("reporting", "info", "Report export completed", {
          exportId,
          scheduleId: scheduleId ?? null,
          templateId,
          format,
          durationMs: Date.now() - startedAt
        });
      }

      return {
        exportId,
        ...files,
        payload
      };
    } catch (error) {
      await database.executeInTransaction(async (connection) => {
        await connection.execute(
          `INSERT INTO report_exports (schedule_id, template_id, export_format, status, error_message)
           VALUES (?, ?, ?, 'failed', ?)`,
          [scheduleId ?? null, templateId, format, error instanceof Error ? error.message : "Storage Sync Error"]
        );
        await connection.execute(
          `INSERT INTO application_logs (category, level, message, details_json)
           VALUES ('reporting', 'error', 'Report export failed', ?)`,
          [
            JSON.stringify({
              scheduleId: scheduleId ?? null,
              templateId,
              format,
              error: error instanceof Error ? error.message : "Storage Sync Error"
            })
          ]
        );
      });
      await loggingService.log("reporting", "error", "Report export failed", {
        scheduleId: scheduleId ?? null,
        templateId,
        format,
        error: error instanceof Error ? error.message : "Storage Sync Error",
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  };

  const registerSchedule = (schedule: {
    id: number;
    templateId: number;
    cronExpression: string;
    exportFormat: ExportFormat;
    createdByUserId: number;
    locationCode?: string | null;
  }) => {
    if (scheduledJobs.has(schedule.id)) {
      scheduledJobs.get(schedule.id)?.stop();
    }

    const task = cron.schedule(schedule.cronExpression, async () => {
      const connection = await database.pool.getConnection();
      try {
        await loadAuthorizedOwner(schedule.createdByUserId, connection);
      } catch (error) {
        if (error instanceof AppError && (error.code === "report_owner_inactive" || error.code === "report_owner_unauthorized")) {
          await database.execute(
            `UPDATE report_schedules
             SET is_active = 0
             WHERE id = ?`,
            [schedule.id]
          );
          await loggingService.alert(
            "report_schedule_owner_invalid",
            "high",
            `Schedule ${schedule.id} was disabled because its owner is no longer authorized`
          );
          scheduledJobs.get(schedule.id)?.stop();
          scheduledJobs.delete(schedule.id);
          return;
        }
        throw error;
      } finally {
        connection.release();
      }

      await generate(
        schedule.templateId,
        schedule.exportFormat,
        schedule.createdByUserId,
        schedule.id,
        schedule.locationCode
      );
    });
    scheduledJobs.set(schedule.id, task);
  };

  return {
    async createSchedule(input: {
      templateId: number;
      name: string;
      cronExpression: string;
      format: ExportFormat;
      locationCode?: string | null;
      createdByUserId: number;
      subscriberUserIds?: number[];
    }) {
      if (!cron.validate(input.cronExpression)) {
        throw new AppError(400, "cron_invalid", "Cron expression is invalid");
      }
      await loadAuthorizedOwner(input.createdByUserId);

      const schedule = await database.executeInTransaction(async (connection) => {
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO report_schedules (template_id, name, cron_expression, export_format, location_code, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            input.templateId,
            input.name,
            input.cronExpression,
            input.format,
            input.locationCode ?? null,
            input.createdByUserId
          ]
        );
        const scheduleId = Number(insertResult.insertId);

        const subscriberIds = new Set<number>([
          input.createdByUserId,
          ...coerceNumberList(input.subscriberUserIds)
        ]);
        for (const userId of subscriberIds) {
          await connection.execute(
            `INSERT IGNORE INTO report_subscriptions (schedule_id, user_id) VALUES (?, ?)`,
            [scheduleId, userId]
          );
        }

        await connection.execute(
          `INSERT INTO application_logs (category, level, message, details_json)
           VALUES ('reporting', 'info', 'Report schedule created', ?)`,
          [
            JSON.stringify({
              scheduleId,
              templateId: input.templateId,
              createdByUserId: input.createdByUserId,
              exportFormat: input.format,
              locationCode: input.locationCode ?? null
            })
          ]
        );

        return {
          id: scheduleId,
          templateId: input.templateId,
          name: input.name,
          cronExpression: input.cronExpression,
          exportFormat: input.format,
          locationCode: input.locationCode ?? null,
          createdByUserId: input.createdByUserId,
          createdAt: new Date().toISOString()
        };
      });

      registerSchedule(schedule);
      return schedule;
    },

    async loadSchedules() {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT id, template_id, cron_expression, export_format, location_code, created_by_user_id
         FROM report_schedules
         WHERE is_active = 1`
      );
      for (const row of rows) {
        registerSchedule({
          id: Number(row.id),
          templateId: Number(row.template_id),
          cronExpression: String(row.cron_expression),
          exportFormat: String(row.export_format) as ExportFormat,
          locationCode: row.location_code ? String(row.location_code) : null,
          createdByUserId: Number(row.created_by_user_id)
        });
      }
    },

    async generateNow(templateId: number, format: ExportFormat, userId: number, locationCode?: string | null) {
      return generate(templateId, format, userId, undefined, locationCode);
    },

    async listInbox(userId: number) {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT rii.id, rii.title, rii.is_read, rii.created_at, rii.report_export_id,
                re.export_format, re.file_path, re.shared_file_path, re.status
         FROM report_inbox_items rii
         INNER JOIN report_exports re ON re.id = rii.report_export_id
         WHERE rii.user_id = ?
         ORDER BY rii.created_at DESC`,
        [userId]
      );

      return rows.map((row) => ({
        id: Number(row.id),
        reportExportId: Number(row.report_export_id),
        title: String(row.title),
        isRead: Boolean(row.is_read),
        createdAt: new Date(row.created_at).toISOString(),
        format: String(row.export_format),
        status: String(row.status),
        fileName: String(row.file_path).split(/[\\/]/).pop() ?? `report-${row.id}`
      }));
    },

    async getInboxDownload(userId: number, inboxItemId: number) {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT rii.id, re.file_path, re.export_format
         FROM report_inbox_items rii
         INNER JOIN report_exports re ON re.id = rii.report_export_id
         WHERE rii.id = ? AND rii.user_id = ?
         LIMIT 1`,
        [inboxItemId, userId]
      );

      const item = rows[0];
      if (!item) {
        throw new AppError(404, "report_inbox_item_not_found", "Report inbox item was not found");
      }

      const rawPath = String(item.file_path);
      const approvedRoots = [
        resolvePath(config.DATA_DIR, "reports"),
        resolvePath(config.REPORTS_SHARED_PATH)
      ];

      let canonicalPath: string;
      try {
        canonicalPath = await realpath(rawPath);
      } catch {
        throw new AppError(404, "report_file_missing", "Report file is no longer available on disk");
      }
      const canonicalRoots = await Promise.all(
        approvedRoots.map(async (root) => {
          try {
            return await realpath(root);
          } catch {
            return resolvePath(root);
          }
        })
      );
      const isWithinApprovedRoot = canonicalRoots.some((root) => {
        const rel = relativePath(root, canonicalPath);
        return rel === "" || (!rel.startsWith("..") && !isAbsolutePath(rel));
      });
      if (!isWithinApprovedRoot) {
        await loggingService.alert(
          "report_path_violation",
          "high",
          `Refused to serve report file outside approved storage roots: ${rawPath}`
        );
        throw new AppError(
          403,
          "report_path_forbidden",
          "Report file is outside the approved storage roots"
        );
      }

      await database.execute(`UPDATE report_inbox_items SET is_read = 1 WHERE id = ?`, [inboxItemId]);

      return {
        filePath: canonicalPath,
        fileName: canonicalPath.split(/[\\/]/).pop() ?? `report-${item.id}.${item.export_format}`
      };
    },

    async listSchedules() {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT rs.id, rs.template_id, rs.name, rs.cron_expression, rs.export_format, rs.location_code, rs.is_active, rs.last_run_at, rs.created_at,
                GROUP_CONCAT(rsub.user_id ORDER BY rsub.user_id SEPARATOR ',') AS subscriber_ids
         FROM report_schedules
         rs
         LEFT JOIN report_subscriptions rsub ON rsub.schedule_id = rs.id
         GROUP BY rs.id, rs.template_id, rs.name, rs.cron_expression, rs.export_format, rs.location_code, rs.is_active, rs.last_run_at, rs.created_at
         ORDER BY created_at DESC`
      );

      return rows.map((row) => ({
        id: Number(row.id),
        templateId: Number(row.template_id),
        name: String(row.name),
        cronExpression: String(row.cron_expression),
        exportFormat: String(row.export_format),
        locationCode: row.location_code ? String(row.location_code) : null,
        isActive: Boolean(row.is_active),
        lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        subscriberUserIds: String(row.subscriber_ids ?? "")
          .split(",")
          .filter(Boolean)
          .map((value) => Number(value))
      }));
    },

    async listRecipients() {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT u.id, u.full_name, u.username,
                GROUP_CONCAT(ur.role_name ORDER BY ur.role_name SEPARATOR ',') AS roles
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         WHERE u.active = 1
         GROUP BY u.id, u.full_name, u.username
         ORDER BY u.full_name ASC`
      );

      return rows.map((row) => ({
        id: Number(row.id),
        fullName: String(row.full_name),
        username: String(row.username),
        roles: String(row.roles).split(",")
      }));
    }
  };
};
