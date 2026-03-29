import type { RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";

const defaultLayout = [
  { id: "viewsByStation-1", widgetType: "viewsByStation", title: "Views by station", locationCode: "HQ", x: 0, y: 0, width: 6, height: 4 },
  { id: "topPosts-1", widgetType: "topPosts", title: "Top posts", locationCode: "HQ", x: 6, y: 0, width: 6, height: 4 },
  { id: "searchTrends-1", widgetType: "searchTrends", title: "Search trends", locationCode: "HQ", x: 0, y: 4, width: 12, height: 4 }
];

const parseJsonColumn = <T>(value: T | string): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

export const createDashboardService = (database: Database) => ({
  async getLayout(userId: number) {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT layout_json FROM dashboard_layouts WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      return defaultLayout;
    }

    return parseJsonColumn(rows[0].layout_json);
  },

  async saveLayout(userId: number, layout: unknown) {
    await database.execute(
      `INSERT INTO dashboard_layouts (user_id, layout_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE layout_json = VALUES(layout_json), updated_at = CURRENT_TIMESTAMP()`,
      [userId, JSON.stringify(layout)]
    );

    return this.getLayout(userId);
  },

  async createTemplate(name: string, layout: unknown, createdByUserId: number) {
    await database.execute(
      `INSERT INTO report_templates (name, layout_json, created_by_user_id) VALUES (?, ?, ?)`,
      [name, JSON.stringify(layout), createdByUserId]
    );

    const rows = await database.query<RowDataPacket[]>(
      `SELECT id, name, layout_json, created_at
       FROM report_templates
       WHERE created_by_user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [createdByUserId]
    );

    const row = rows[0];
    return {
      id: Number(row.id),
      name: String(row.name),
      layout: parseJsonColumn(row.layout_json),
      createdAt: new Date(row.created_at).toISOString()
    };
  },

  async listTemplates() {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT id, name, layout_json, created_at FROM report_templates ORDER BY created_at DESC`
    );

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      layout: parseJsonColumn(row.layout_json),
      createdAt: new Date(row.created_at).toISOString()
    }));
  }
});
