import { describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.js";
import { createDashboardService } from "../src/services/dashboard-service.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();

  return {
    database: {
      pool: {} as Database["pool"],
      query,
      execute,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database,
    query,
    execute
  };
};

describe("dashboard service", () => {
  it("returns the default widget layout when no saved dashboard exists", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createDashboardService(database);
    const layout = await service.getLayout(1);

    expect(layout).toHaveLength(3);
    expect(layout[0]).toMatchObject({ widgetType: "viewsByStation" });
  });

  it("saves layout JSON and creates reusable templates", async () => {
    const { database, query, execute } = createMockDatabase();
    const layout = [{ id: "topPosts", x: 0, y: 0, width: 6, height: 4 }];
    query
      .mockResolvedValueOnce([{ layout_json: JSON.stringify(layout) }])
      .mockResolvedValueOnce([
        {
          id: 8,
          name: "Weekly Snapshot",
          layout_json: JSON.stringify(layout),
          created_at: new Date("2026-03-28T10:00:00.000Z")
        }
      ]);

    const service = createDashboardService(database);
    const savedLayout = await service.saveLayout(1, layout);
    const template = await service.createTemplate("Weekly Snapshot", layout, 1);

    expect(savedLayout).toEqual(layout);
    expect(template.name).toBe("Weekly Snapshot");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("lists saved templates with persisted layout payloads", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([
      {
        id: 9,
        name: "Front Desk Overview",
        layout_json: JSON.stringify([{ id: "viewsByStation-1", widgetType: "viewsByStation", x: 0, y: 0, width: 12, height: 4 }]),
        created_at: new Date("2026-03-28T10:00:00.000Z")
      }
    ]);

    const service = createDashboardService(database);
    const templates = await service.listTemplates();

    expect(templates[0]?.layout[0]).toMatchObject({ widgetType: "viewsByStation" });
  });
});
