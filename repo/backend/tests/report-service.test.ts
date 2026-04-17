import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.js";

const { mkdirMock, writeFileMock, realpathMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(async () => {}),
  writeFileMock: vi.fn(async () => {}),
  realpathMock: vi.fn(async (p: string) => p)
}));
const { cronScheduleMock } = vi.hoisted(() => ({
  cronScheduleMock: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  realpath: realpathMock
}));
vi.mock("node-cron", async () => {
  const actual = await vi.importActual<typeof import("node-cron")>("node-cron");

  return {
    ...actual,
    default: {
      ...actual.default,
      schedule: cronScheduleMock
    }
  };
});

import { AppError } from "../src/errors.js";
import { createReportService } from "../src/services/report-service.js";
import { baseConfig } from "./test-helpers.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();
  const executeInTransaction = vi.fn(async (callback: (connection: any) => Promise<unknown>) => {
    const connection = {
      execute: vi.fn(async (sql: string) => {
        const lower = sql.toLowerCase();
        if (lower.includes("insert into report_schedules")) {
          return [{ insertId: 8 }, undefined];
        }
        if (lower.includes("insert into report_exports")) {
          return [{ insertId: 50 }, undefined];
        }
        return [undefined, undefined];
      }),
      query: vi.fn(async () => [[], undefined])
    };
    return callback(connection);
  });

  return {
    database: {
      pool: {
        getConnection: vi.fn(async () => ({
          query: vi.fn(async () => [[], undefined]),
          release: vi.fn()
        }))
      } as unknown as Database["pool"],
      query,
      execute,
      executeInTransaction,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database,
    query,
    execute,
    executeInTransaction
  };
};

describe("report service", () => {
  beforeEach(() => {
    mkdirMock.mockClear();
    writeFileMock.mockClear();
    cronScheduleMock.mockClear();
    realpathMock.mockReset();
    realpathMock.mockImplementation(async (p: string) => p);
    writeFileMock.mockImplementation(async (...args: unknown[]) => {
      const path = String(args[0]);
      if (path.includes("shared")) {
        throw new Error("share offline");
      }
    });
  });

  it("rejects invalid cron expressions during schedule creation", async () => {
    const { database } = createMockDatabase();
    const service = createReportService(
      database,
      baseConfig,
      {
        createPost: vi.fn(),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn(),
        analytics: vi.fn()
      },
      { getLayout: vi.fn(), saveLayout: vi.fn(), createTemplate: vi.fn(), listTemplates: vi.fn() },
      { log: vi.fn(), alert: vi.fn(), access: vi.fn() }
    );

    await expect(
      service.createSchedule({
        templateId: 1,
        name: "Broken",
        cronExpression: "not-a-cron",
        format: "pdf",
        createdByUserId: 1
      })
    ).rejects.toMatchObject({
      code: "cron_invalid"
    } satisfies Partial<AppError>);
  });

  it("generates inbox-delivered reports and raises storage sync alerts when the shared folder fails", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    const loggingService = {
      log: vi.fn(async () => {}),
      alert: vi.fn(async () => {}),
      access: vi.fn(async () => {})
    };
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([{ id: 5, name: "Weekly Snapshot", layout_json: "[]" }])
      .mockResolvedValueOnce([{ total_members: 12 }])
      .mockResolvedValueOnce([{ user_id: 1 }]);

    const service = createReportService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/data",
        REPORTS_SHARED_PATH: "C:/shared"
      },
      {
        createPost: vi.fn(),
        analytics: vi.fn(async () => ({
          viewsByStation: [],
          topPosts: [{ id: 3, title: "Top Post", views: 8 }],
          searchTrends: [],
          posts: []
        })),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(async () => []),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      loggingService
    );

    const result = await service.generateNow(5, "csv", 1, "HQ");

    expect(result.sharedFilePath).toBeNull();
    expect(executeInTransaction).toHaveBeenCalled();
    expect(loggingService.alert).toHaveBeenCalledWith(
      "storage_sync_error",
      "high",
      expect.stringContaining("could not be written")
    );
  });

  it("generates excel and pdf exports when storage is available", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    writeFileMock.mockResolvedValue(undefined);
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([{ id: 5, name: "Weekly Snapshot", layout_json: "[]" }])
      .mockResolvedValueOnce([{ total_members: 12 }])
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([{ id: 5, name: "Weekly Snapshot", layout_json: "[]" }])
      .mockResolvedValueOnce([{ total_members: 12 }])
      .mockResolvedValueOnce([{ user_id: 1 }]);

    const service = createReportService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/data",
        REPORTS_SHARED_PATH: "C:/shared"
      },
      {
        createPost: vi.fn(),
        analytics: vi.fn(async () => ({
          viewsByStation: [],
          topPosts: [{ id: 3, title: "Top Post", views: 8 }],
          searchTrends: [],
          posts: []
        })),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(async () => []),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(async () => {}), alert: vi.fn(async () => {}), access: vi.fn(async () => {}) }
    );

    const excel = await service.generateNow(5, "excel", 1, "HQ");
    const pdf = await service.generateNow(5, "pdf", 1, "HQ");

    expect(excel.sharedWriteError).toBeNull();
    expect(pdf.sharedWriteError).toBeNull();
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("lists inbox items and schedules with mapped offline delivery details", async () => {
    const { database, query } = createMockDatabase();
    query
      .mockResolvedValueOnce([
        {
          id: 7,
          title: "Weekly Snapshot (CSV)",
          is_read: 0,
          created_at: new Date("2026-03-28T10:00:00.000Z"),
          export_format: "csv",
          file_path: "C:/data/reports/report.csv",
          shared_file_path: "C:/shared/report.csv"
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 5,
          template_id: 2,
          name: "Weekly Snapshot",
          cron_expression: "0 6 * * 1",
          export_format: "pdf",
          location_code: "HQ",
          is_active: 1,
          last_run_at: new Date("2026-03-28T10:00:00.000Z"),
          created_at: new Date("2026-03-27T10:00:00.000Z")
        }
      ]);

    const service = createReportService(
      database,
      baseConfig,
      {
        createPost: vi.fn(),
        analytics: vi.fn(),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(), alert: vi.fn(), access: vi.fn() }
    );

    const inbox = await service.listInbox(1);
    const schedules = await service.listSchedules();

    expect(inbox[0]?.fileName).toBe("report.csv");
    expect((inbox[0] as Record<string, unknown>)?.filePath).toBeUndefined();
    expect((inbox[0] as Record<string, unknown>)?.sharedFilePath).toBeUndefined();
    expect(schedules[0]?.cronExpression).toBe("0 6 * * 1");
  });

  it("creates and loads active report schedules through cron registration", async () => {
    const { database, query } = createMockDatabase();
    cronScheduleMock.mockImplementation((_expression: string, callback: () => void) => ({
      stop: vi.fn(),
      run: callback
    }));
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 8,
          template_id: 5,
          cron_expression: "0 6 * * 1",
          export_format: "excel",
          location_code: "HQ",
          created_by_user_id: 1
        }
      ]);

    const service = createReportService(
      database,
      baseConfig,
      {
        createPost: vi.fn(),
        analytics: vi.fn(),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(), alert: vi.fn(), access: vi.fn() }
    );

    const schedule = await service.createSchedule({
      templateId: 5,
      name: "Monday Report",
      cronExpression: "0 6 * * 1",
      format: "excel",
      createdByUserId: 1,
      locationCode: "HQ"
    });
    await service.loadSchedules();

    expect(schedule.name).toBe("Monday Report");
    expect(cronScheduleMock).toHaveBeenCalledTimes(2);
    expect(schedule.exportFormat).toBe("excel");
  });

  it("fails cleanly when the report template does not exist", async () => {
    const { database, query } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([]);

    const service = createReportService(
      database,
      baseConfig,
      {
        createPost: vi.fn(),
        analytics: vi.fn(),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(), alert: vi.fn(), access: vi.fn() }
    );

    await expect(service.generateNow(404, "csv", 1, "HQ")).rejects.toMatchObject({
      code: "report_template_not_found"
    } satisfies Partial<AppError>);
  });

  it("records failed exports when local report generation cannot complete", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    const loggingService = {
      log: vi.fn(async () => {}),
      alert: vi.fn(async () => {}),
      access: vi.fn(async () => {})
    };
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([{ id: 5, name: "Weekly Snapshot", layout_json: "[]" }])
      .mockResolvedValueOnce([{ total_members: 12 }]);
    writeFileMock.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    const service = createReportService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/data",
        REPORTS_SHARED_PATH: "C:/shared"
      },
      {
        createPost: vi.fn(),
        analytics: vi.fn(async () => ({
          viewsByStation: [],
          topPosts: [],
          searchTrends: [],
          posts: []
        })),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(async () => []),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      loggingService
    );

    await expect(service.generateNow(5, "csv", 1, "HQ")).rejects.toThrowError("disk full");
    expect(executeInTransaction).toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      "reporting",
      "error",
      "Report export failed",
      expect.objectContaining({ error: "disk full" })
    );
  });

  it("uses the requesting administrator layout instead of user 1 by default", async () => {
    const { database, query } = createMockDatabase();
    const getLayout = vi.fn(async (userId: number) =>
      userId === 2
        ? [{ id: "topPosts-2", widgetType: "topPosts", title: "Second admin posts", x: 0, y: 0, width: 6, height: 4 }]
        : [{ id: "viewsByStation-1", widgetType: "viewsByStation", title: "First admin views", x: 0, y: 0, width: 6, height: 4 }]
    );
    query
      .mockResolvedValueOnce([{ id: 2, username: "admin-2", full_name: "Admin Two", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: "Weekly Snapshot",
          layout_json: JSON.stringify([{ id: "topPosts-template", widgetType: "topPosts", title: "Template posts", x: 0, y: 0, width: 6, height: 4 }])
        }
      ])
      .mockResolvedValueOnce([{ total_members: 12 }]);
    writeFileMock.mockResolvedValue(undefined);

    const service = createReportService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/data",
        REPORTS_SHARED_PATH: "C:/shared"
      },
      {
        createPost: vi.fn(),
        analytics: vi.fn(async () => ({
          viewsByStation: [],
          topPosts: [{ id: 3, title: "Top Post", views: 8 }],
          searchTrends: [],
          posts: []
        })),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout,
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(async () => {}), alert: vi.fn(async () => {}), access: vi.fn(async () => {}) }
    );

    const result = await service.generateNow(5, "csv", 2, "HQ");

    expect(result.payload.layoutSnapshot).toEqual([
      expect.objectContaining({ id: "topPosts-2", title: "Second admin posts" })
    ]);
    expect(getLayout).toHaveBeenCalledWith(2);
  });

  it("renders export sections from the saved template layout", async () => {
    const { database, query } = createMockDatabase();
    writeFileMock.mockResolvedValue(undefined);
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: "Station Snapshot",
          layout_json: JSON.stringify([
            { id: "views-1", widgetType: "viewsByStation", title: "Station views", x: 0, y: 0, width: 6, height: 4 }
          ])
        }
      ])
      .mockResolvedValueOnce([{ total_members: 12 }])
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 6,
          name: "Search Snapshot",
          layout_json: JSON.stringify([
            { id: "search-1", widgetType: "searchTrends", title: "Search terms", x: 0, y: 0, width: 6, height: 4 }
          ])
        }
      ])
      .mockResolvedValueOnce([{ total_members: 12 }]);

    const service = createReportService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/data",
        REPORTS_SHARED_PATH: "C:/shared"
      },
      {
        createPost: vi.fn(),
        analytics: vi.fn(async () => ({
          viewsByStation: [{ stationToken: "Lobby-Kiosk-01", views: 8 }],
          topPosts: [{ id: 3, title: "Top Post", views: 8 }],
          searchTrends: [{ term: "mobility", uses: 4 }],
          posts: []
        })),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(async () => []),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(async () => {}), alert: vi.fn(async () => {}), access: vi.fn(async () => {}) }
    );

    await service.generateNow(5, "csv", 1, "HQ");
    await service.generateNow(6, "csv", 1, "HQ");

    const writeCalls = writeFileMock.mock.calls as unknown as Array<[unknown, unknown]>;
    const firstLocalBuffer = writeCalls[0]?.[1] as Buffer | undefined;
    const secondLocalBuffer = writeCalls[2]?.[1] as Buffer | undefined;
    expect(firstLocalBuffer).toBeDefined();
    expect(secondLocalBuffer).toBeDefined();
    expect(firstLocalBuffer!.toString("utf8")).toContain("Station views");
    expect(firstLocalBuffer!.toString("utf8")).toContain("Lobby-Kiosk-01");
    expect(secondLocalBuffer!.toString("utf8")).toContain("Search terms");
    expect(secondLocalBuffer!.toString("utf8")).toContain("mobility");
  });

  it("rejects report generation when the owner is inactive", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([
      { id: 1, username: "admin", full_name: "Admin", active: 0 }
    ]);

    const service = createReportService(
      database,
      baseConfig,
      {
        createPost: vi.fn(),
        analytics: vi.fn(),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(async () => {}), alert: vi.fn(async () => {}), access: vi.fn(async () => {}) }
    );

    await expect(service.generateNow(5, "pdf", 1, "HQ")).rejects.toMatchObject({
      code: "report_owner_inactive"
    } satisfies Partial<AppError>);
  });

  it("disables schedules whose owners are no longer administrators during cron execution", async () => {
    const { database, query, execute } = createMockDatabase();
    const stopMock = vi.fn();
    cronScheduleMock.mockImplementation((_expression: string, callback: () => Promise<void>) => ({
      stop: stopMock,
      run: callback
    }));
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 8,
          template_id: 5,
          name: "Monday Report",
          cron_expression: "0 6 * * 1",
          export_format: "excel",
          location_code: "HQ",
          created_by_user_id: 1,
          created_at: new Date("2026-03-28T10:00:00.000Z")
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 8,
          template_id: 5,
          cron_expression: "0 6 * * 1",
          export_format: "excel",
          location_code: "HQ",
          created_by_user_id: 1
        }
      ]);

    (database.pool.getConnection as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 1, username: "admin", full_name: "Admin", active: 1 }], undefined])
        .mockResolvedValueOnce([[{ role_name: "Coach" }], undefined]),
      release: vi.fn()
    });

    const loggingService = {
      log: vi.fn(async () => {}),
      alert: vi.fn(async () => {}),
      access: vi.fn(async () => {})
    };
    const service = createReportService(
      database,
      baseConfig,
      {
        createPost: vi.fn(),
        analytics: vi.fn(),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      loggingService
    );

    const schedule = await service.createSchedule({
      templateId: 5,
      name: "Monday Report",
      cronExpression: "0 6 * * 1",
      format: "excel",
      createdByUserId: 1,
      locationCode: "HQ"
    });
    await service.loadSchedules();

    const callbacks = cronScheduleMock.mock.calls.map((call) => call[1]).filter(Boolean);
    await callbacks[1]();

    expect(schedule.id).toBe(8);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE report_schedules"),
      [8]
    );
    expect(loggingService.alert).toHaveBeenCalledWith(
      "report_schedule_owner_invalid",
      "high",
      expect.stringContaining("Schedule 8")
    );
    expect(stopMock).toHaveBeenCalled();
  });

  it("uses location-scoped member totals when generating filtered reports", async () => {
    const { database, query } = createMockDatabase();
    writeFileMock.mockResolvedValue(undefined);
    query
      .mockResolvedValueOnce([{ id: 1, username: "admin", full_name: "Admin", active: 1 }])
      .mockResolvedValueOnce([{ role_name: "Administrator" }])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: "HQ Snapshot",
          layout_json: JSON.stringify([])
        }
      ])
      .mockResolvedValueOnce([{ total_members: 4 }]);

    const service = createReportService(
      database,
      {
        ...baseConfig,
        DATA_DIR: "C:/data",
        REPORTS_SHARED_PATH: "C:/shared"
      },
      {
        createPost: vi.fn(),
        analytics: vi.fn(async () => ({
          viewsByStation: [],
          topPosts: [],
          searchTrends: [],
          posts: []
        })),
        listPosts: vi.fn(),
        recordView: vi.fn(),
        recordSearch: vi.fn()
      },
      {
        getLayout: vi.fn(async () => []),
        saveLayout: vi.fn(),
        createTemplate: vi.fn(),
        listTemplates: vi.fn()
      },
      { log: vi.fn(async () => {}), alert: vi.fn(async () => {}), access: vi.fn(async () => {}) }
    );

    const report = await service.generateNow(5, "csv", 1, "HQ");
    expect(report.payload.totalMembers).toBe(4);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE location_code = ?"),
      ["HQ"]
    );
  });

  describe("getInboxDownload — approved storage roots", () => {
    const approvedConfig = {
      ...baseConfig,
      DATA_DIR: "/srv/sentinelfit/data",
      REPORTS_SHARED_PATH: "/srv/sentinelfit/shared-reports"
    };

    it("returns the canonical file path when the report sits inside DATA_DIR/reports", async () => {
      const { database, query, execute } = createMockDatabase();
      const allowedPath = "/srv/sentinelfit/data/reports/weekly-snapshot-1700000000000.pdf";
      query.mockResolvedValueOnce([
        { id: 11, file_path: allowedPath, export_format: "pdf" }
      ]);
      const loggingService = {
        log: vi.fn(async () => {}),
        alert: vi.fn(async () => {}),
        access: vi.fn(async () => {})
      };
      const service = createReportService(
        database,
        approvedConfig,
        {
          createPost: vi.fn(),
          analytics: vi.fn(),
          listPosts: vi.fn(),
          recordView: vi.fn(),
          recordSearch: vi.fn()
        },
        {
          getLayout: vi.fn(),
          saveLayout: vi.fn(),
          createTemplate: vi.fn(),
          listTemplates: vi.fn()
        },
        loggingService
      );

      const result = await service.getInboxDownload(1, 11);

      expect(result.filePath).toBe(allowedPath);
      expect(result.fileName).toBe("weekly-snapshot-1700000000000.pdf");
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE report_inbox_items SET is_read = 1"),
        [11]
      );
      expect(loggingService.alert).not.toHaveBeenCalled();
    });

    it("returns the canonical file path when the report sits inside REPORTS_SHARED_PATH", async () => {
      const { database, query } = createMockDatabase();
      const allowedPath = "/srv/sentinelfit/shared-reports/sub/weekly-snapshot.csv";
      query.mockResolvedValueOnce([
        { id: 12, file_path: allowedPath, export_format: "csv" }
      ]);
      const loggingService = {
        log: vi.fn(async () => {}),
        alert: vi.fn(async () => {}),
        access: vi.fn(async () => {})
      };
      const service = createReportService(
        database,
        approvedConfig,
        {
          createPost: vi.fn(),
          analytics: vi.fn(),
          listPosts: vi.fn(),
          recordView: vi.fn(),
          recordSearch: vi.fn()
        },
        {
          getLayout: vi.fn(),
          saveLayout: vi.fn(),
          createTemplate: vi.fn(),
          listTemplates: vi.fn()
        },
        loggingService
      );

      const result = await service.getInboxDownload(1, 12);
      expect(result.filePath).toBe(allowedPath);
      expect(result.fileName).toBe("weekly-snapshot.csv");
      expect(loggingService.alert).not.toHaveBeenCalled();
    });

    it("rejects with 403 report_path_forbidden when the DB-stored path escapes the approved roots", async () => {
      const { database, query, execute } = createMockDatabase();
      const escapingPath = "/etc/passwd";
      query.mockResolvedValueOnce([
        { id: 13, file_path: escapingPath, export_format: "pdf" }
      ]);
      const loggingService = {
        log: vi.fn(async () => {}),
        alert: vi.fn(async () => {}),
        access: vi.fn(async () => {})
      };
      const service = createReportService(
        database,
        approvedConfig,
        {
          createPost: vi.fn(),
          analytics: vi.fn(),
          listPosts: vi.fn(),
          recordView: vi.fn(),
          recordSearch: vi.fn()
        },
        {
          getLayout: vi.fn(),
          saveLayout: vi.fn(),
          createTemplate: vi.fn(),
          listTemplates: vi.fn()
        },
        loggingService
      );

      await expect(service.getInboxDownload(1, 13)).rejects.toMatchObject({
        statusCode: 403,
        code: "report_path_forbidden"
      } satisfies Partial<AppError>);

      expect(loggingService.alert).toHaveBeenCalledWith(
        "report_path_violation",
        "high",
        expect.stringContaining(escapingPath)
      );
      // Read receipt update must NOT fire when the path is rejected.
      expect(execute).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE report_inbox_items SET is_read = 1"),
        expect.anything()
      );
    });

    it("rejects with 403 report_path_forbidden when a symlink resolves outside the approved roots", async () => {
      const { database, query } = createMockDatabase();
      const symlinkPath = "/srv/sentinelfit/data/reports/leak.pdf";
      const resolvedTarget = "/etc/shadow";
      query.mockResolvedValueOnce([
        { id: 14, file_path: symlinkPath, export_format: "pdf" }
      ]);
      realpathMock.mockImplementation(async (p: string) => {
        if (p === symlinkPath) {
          return resolvedTarget;
        }
        return p;
      });
      const loggingService = {
        log: vi.fn(async () => {}),
        alert: vi.fn(async () => {}),
        access: vi.fn(async () => {})
      };
      const service = createReportService(
        database,
        approvedConfig,
        {
          createPost: vi.fn(),
          analytics: vi.fn(),
          listPosts: vi.fn(),
          recordView: vi.fn(),
          recordSearch: vi.fn()
        },
        {
          getLayout: vi.fn(),
          saveLayout: vi.fn(),
          createTemplate: vi.fn(),
          listTemplates: vi.fn()
        },
        loggingService
      );

      await expect(service.getInboxDownload(1, 14)).rejects.toMatchObject({
        statusCode: 403,
        code: "report_path_forbidden"
      } satisfies Partial<AppError>);
      expect(loggingService.alert).toHaveBeenCalledWith(
        "report_path_violation",
        "high",
        expect.stringContaining(symlinkPath)
      );
    });

    it("returns 404 report_file_missing when the file no longer exists on disk", async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce([
        { id: 15, file_path: "/srv/sentinelfit/data/reports/gone.pdf", export_format: "pdf" }
      ]);
      realpathMock.mockImplementation(async (p: string) => {
        if (p === "/srv/sentinelfit/data/reports/gone.pdf") {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return p;
      });
      const service = createReportService(
        database,
        approvedConfig,
        {
          createPost: vi.fn(),
          analytics: vi.fn(),
          listPosts: vi.fn(),
          recordView: vi.fn(),
          recordSearch: vi.fn()
        },
        {
          getLayout: vi.fn(),
          saveLayout: vi.fn(),
          createTemplate: vi.fn(),
          listTemplates: vi.fn()
        },
        { log: vi.fn(async () => {}), alert: vi.fn(async () => {}), access: vi.fn(async () => {}) }
      );

      await expect(service.getInboxDownload(1, 15)).rejects.toMatchObject({
        statusCode: 404,
        code: "report_file_missing"
      } satisfies Partial<AppError>);
    });
  });
});
