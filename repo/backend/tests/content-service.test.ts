import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import type { Database } from "../src/database.js";
import { createContentService } from "../src/services/content-service.js";
import type { AuthenticatedUser } from "../src/types.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();
  const executeInTransaction = vi.fn(async (callback: (connection: any) => Promise<unknown>) => {
    const connection = {
      execute: vi.fn(async (sql: string) => {
        if (sql.toLowerCase().includes("insert into content_posts")) {
          return [{ insertId: 11 }, undefined];
        }
        return [undefined, undefined];
      })
    };
    return callback(connection);
  });

  return {
    database: {
      pool: {} as Database["pool"],
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

describe("content service", () => {
  const adminActor: AuthenticatedUser = {
    id: 1,
    username: "admin",
    fullName: "System Administrator",
    roles: ["Administrator", "Coach", "Member"]
  };
  const memberActor: AuthenticatedUser = {
    id: 7,
    username: "member",
    fullName: "Member",
    roles: ["Member"]
  };
  const coachActor: AuthenticatedUser = {
    id: 2,
    username: "coach",
    fullName: "Coach",
    roles: ["Coach", "Member"]
  };

  it("creates and maps published posts", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query.mockResolvedValueOnce([
      {
        id: 11,
        kind: "tip",
        title: "Breathe through the set",
        body: "Keep your brace steady.",
        location_code: "HQ",
        created_at: new Date("2026-03-28T10:00:00.000Z")
      }
    ]);

    const service = createContentService(database);
    const post = await service.createPost({
      actor: adminActor,
      authorUserId: 2,
      kind: "tip",
      title: "Breathe through the set",
      body: "Keep your brace steady.",
      locationCode: "HQ"
    });

    expect(post.title).toBe("Breathe through the set");
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("rejects views for missing content", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createContentService(database);

    await expect(
      service.recordView({
        postId: 999,
        actor: adminActor,
        stationToken: "Lobby-Kiosk-01"
      })
    ).rejects.toMatchObject({
      code: "content_not_found"
    } satisfies Partial<AppError>);
  });

  it("builds analytics with station, post, and search trend slices", async () => {
    const { database, query } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ station_token: "Lobby-Kiosk-01", views: 7 }])
      .mockResolvedValueOnce([{ id: 3, title: "Tip", views: 7 }])
      .mockResolvedValueOnce([{ search_term: "mobility", uses: 4 }])
      .mockResolvedValueOnce([
        {
          id: 3,
          kind: "tip",
          title: "Tip",
          body: "Move well",
          location_code: "HQ",
          created_at: new Date("2026-03-28T10:00:00.000Z"),
          author_name: "Coach"
        }
      ]);

    const service = createContentService(database);
    const analytics = await service.analytics(adminActor, {
      locationCode: "HQ",
      includeHistorical: false
    });

    expect(analytics.viewsByStation[0]).toEqual({
      stationToken: "Lobby-Kiosk-01",
      views: 7
    });
    expect(analytics.topPosts[0]).toEqual({
      id: 3,
      title: "Tip",
      views: 7
    });
    expect(analytics.searchTrends[0]).toEqual({
      term: "mobility",
      uses: 4
    });
    expect(analytics.posts).toHaveLength(1);
  });

  it("records onsite search terms with station attribution", async () => {
    const { database, executeInTransaction } = createMockDatabase();
    const service = createContentService(database);

    await service.recordSearch({
      actor: adminActor,
      actorUserId: 3,
      searchTerm: "recovery",
      stationToken: "Front-Desk-01",
      locationCode: "HQ"
    });

    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("treats analytics end dates as inclusive through the end of the selected day", async () => {
    const { database, query } = createMockDatabase();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const service = createContentService(database);
    await service.analytics(adminActor, {
      startDate: "2026-03-27",
      endDate: "2026-03-28",
      locationCode: "HQ",
      includeHistorical: false
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("cve.created_at < DATE_ADD(?, INTERVAL 1 DAY)"),
      ["2026-03-27", "2026-03-28", "HQ"]
    );
  });

  it("rejects non-admin location overrides outside authorized scope", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([{ location_code: "HQ" }]);
    const service = createContentService(database);

    await expect(service.listPosts(memberActor, "Branch")).rejects.toMatchObject({
      code: "forbidden_location_scope"
    } satisfies Partial<AppError>);
  });

  it("binds view events to the post location instead of caller-supplied location", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ id: 99, location_code: "HQ" }])
      .mockResolvedValueOnce([{ location_code: "HQ" }]);
    const service = createContentService(database);

    await service.recordView({
      postId: 99,
      actor: memberActor,
      stationToken: "Lobby-Kiosk-01",
      viewerUserId: 7
    });

    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("writes typed content system logs inside a transaction helper", async () => {
    const { database } = createMockDatabase();
    const service = createContentService(database);
    const connection = {
      execute: vi.fn(async () => [undefined, undefined])
    } as unknown as import("mysql2/promise").PoolConnection;

    await service.writeSystemLogInTransaction(connection, "Content post created", {
      actorUserId: 1,
      postId: 11
    });

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO application_logs"),
      ["Content post created", expect.any(String)]
    );
  });

  it("allows a coach with explicit location assignment to publish the first post", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ location_code: "HQ" }])
      .mockResolvedValueOnce([
        {
          id: 11,
          kind: "tip",
          title: "Coach Tip",
          body: "Posture first",
          location_code: "HQ",
          created_at: new Date("2026-03-28T10:00:00.000Z")
        }
      ]);

    const service = createContentService(database);
    const post = await service.createPost({
      actor: coachActor,
      authorUserId: 2,
      kind: "tip",
      title: "Coach Tip",
      body: "Posture first",
      locationCode: "HQ"
    });

    expect(post.title).toBe("Coach Tip");
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("rejects a coach publishing outside assigned locations", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([{ location_code: "Branch" }]);
    const service = createContentService(database);

    await expect(
      service.createPost({
        actor: coachActor,
        authorUserId: 2,
        kind: "tip",
        title: "Coach Tip",
        body: "Posture first",
        locationCode: "HQ"
      })
    ).rejects.toMatchObject({
      code: "forbidden_location_scope"
    } satisfies Partial<AppError>);
  });
});
