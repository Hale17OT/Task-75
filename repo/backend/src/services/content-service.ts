import type { RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";
import { AppError } from "../errors.js";
import type { AuthenticatedUser } from "../types.js";

interface AnalyticsFilters {
  startDate?: string;
  endDate?: string;
  locationCode?: string;
  includeHistorical?: boolean;
}

export const createContentService = (database: Database) => ({
  async writeSystemLogInTransaction(
    connection: import("mysql2/promise").PoolConnection,
    message: string,
    details: Record<string, unknown>
  ) {
    await connection.execute(
      `INSERT INTO application_logs (category, level, message, details_json)
       VALUES ('content', 'info', ?, ?)`,
      [message, JSON.stringify(details)]
    );
  },

  async getAuthorizedLocations(actor: AuthenticatedUser) {
    if (actor.roles.includes("Administrator")) {
      return null;
    }

    if (actor.roles.includes("Coach")) {
      const assignedRows = await database.query<RowDataPacket[]>(
        `SELECT location_code
         FROM coach_location_assignments
         WHERE coach_user_id = ? AND is_active = 1`,
        [actor.id]
      );
      return assignedRows.map((row) => String(row.location_code));
    }

    const ownProfileRows = await database.query<RowDataPacket[]>(
      `SELECT location_code
       FROM member_profiles
       WHERE user_id = ?`,
      [actor.id]
    );
    return ownProfileRows.map((row) => String(row.location_code));
  },

  async assertLocationAllowed(actor: AuthenticatedUser, locationCode: string) {
    const authorized = await this.getAuthorizedLocations(actor);
    if (authorized === null) {
      return;
    }
    if (authorized.length === 0 || !authorized.includes(locationCode)) {
      throw new AppError(403, "forbidden_location_scope", "You do not have access to this location");
    }
  },

  async createPost(input: {
    actor: AuthenticatedUser;
    authorUserId: number;
    kind: "tip" | "announcement";
    title: string;
    body: string;
    locationCode: string;
  }) {
    await this.assertLocationAllowed(input.actor, input.locationCode);
    const postId = await database.executeInTransaction(async (connection) => {
      const [insertResult] = await connection.execute<import("mysql2/promise").ResultSetHeader>(
        `INSERT INTO content_posts (author_user_id, kind, title, body, location_code)
         VALUES (?, ?, ?, ?, ?)`,
        [input.authorUserId, input.kind, input.title, input.body, input.locationCode]
      );
      const createdPostId = Number(insertResult.insertId);
      await this.writeSystemLogInTransaction(connection, "Content post created", {
        actorUserId: input.actor.id,
        postId: createdPostId,
        kind: input.kind,
        locationCode: input.locationCode
      });
      return createdPostId;
    });

    const rows = await database.query<RowDataPacket[]>(
      `SELECT id, kind, title, body, location_code, created_at
       FROM content_posts
       WHERE id = ?
       LIMIT 1`,
      [postId]
    );
    const row = rows[0];
    return {
      id: Number(row.id),
      kind: String(row.kind),
      title: String(row.title),
      body: String(row.body),
      locationCode: String(row.location_code),
      createdAt: new Date(row.created_at).toISOString()
    };
  },

  async listPosts(actor: AuthenticatedUser, locationCode?: string) {
    const authorized = await this.getAuthorizedLocations(actor);
    if (authorized !== null && authorized.length === 0) {
      return [];
    }
    const params: unknown[] = [];
    let whereClause = "WHERE is_active = 1";

    if (locationCode) {
      if (authorized !== null && !authorized.includes(locationCode)) {
        throw new AppError(403, "forbidden_location_scope", "You do not have access to this location");
      }
      whereClause += " AND location_code = ?";
      params.push(locationCode);
    } else if (authorized !== null) {
      whereClause += ` AND location_code IN (${authorized.map(() => "?").join(",")})`;
      params.push(...authorized);
    }

    const rows = await database.query<RowDataPacket[]>(
      `SELECT cp.id, cp.kind, cp.title, cp.body, cp.location_code, cp.created_at,
              u.full_name AS author_name
       FROM content_posts cp
       INNER JOIN users u ON u.id = cp.author_user_id
       ${whereClause}
       ORDER BY cp.created_at DESC`,
      params
    );

    return rows.map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      title: String(row.title),
      body: String(row.body),
      locationCode: String(row.location_code),
      authorName: String(row.author_name),
      createdAt: new Date(row.created_at).toISOString()
    }));
  },

  async recordView(input: {
    postId: number;
    actor: AuthenticatedUser;
    viewerUserId?: number | null;
    stationToken: string;
  }) {
    const rows = await database.query<RowDataPacket[]>(
      "SELECT id, location_code FROM content_posts WHERE id = ? AND is_active = 1 LIMIT 1",
      [input.postId]
    );

    const post = rows[0];
    if (!post) {
      throw new AppError(404, "content_not_found", "Content post was not found");
    }
    const postLocation = String(post.location_code);
    await this.assertLocationAllowed(input.actor, postLocation);

    await database.executeInTransaction(async (connection) => {
      await connection.execute(
        `INSERT INTO content_view_events (post_id, viewer_user_id, station_token, location_code)
         VALUES (?, ?, ?, ?)`,
        [input.postId, input.viewerUserId ?? null, input.stationToken, postLocation]
      );
      await this.writeSystemLogInTransaction(connection, "Content view recorded", {
        actorUserId: input.actor.id,
        postId: input.postId,
        stationToken: input.stationToken,
        locationCode: postLocation
      });
    });
  },

  async recordSearch(input: {
    actor: AuthenticatedUser;
    actorUserId?: number | null;
    searchTerm: string;
    stationToken: string;
    locationCode?: string;
  }) {
    const authorized = await this.getAuthorizedLocations(input.actor);
    let locationCode = input.locationCode;
    if (authorized !== null) {
      if (authorized.length === 0) {
        throw new AppError(403, "forbidden_location_scope", "You do not have access to any location");
      }
      locationCode = locationCode ?? authorized[0];
      if (!authorized.includes(locationCode)) {
        throw new AppError(403, "forbidden_location_scope", "You do not have access to this location");
      }
    } else if (!locationCode) {
      throw new AppError(400, "location_required", "Location is required for this operation");
    }

    await database.executeInTransaction(async (connection) => {
      await connection.execute(
        `INSERT INTO search_events (actor_user_id, search_term, station_token, location_code)
         VALUES (?, ?, ?, ?)`,
        [input.actorUserId ?? null, input.searchTerm, input.stationToken, locationCode]
      );
      await this.writeSystemLogInTransaction(connection, "Content search recorded", {
        actorUserId: input.actor.id,
        searchTerm: input.searchTerm,
        stationToken: input.stationToken,
        locationCode
      });
    });
  },

  async analytics(actor: AuthenticatedUser, filters: AnalyticsFilters) {
    const authorized = await this.getAuthorizedLocations(actor);
    if (authorized !== null && authorized.length === 0) {
      return {
        viewsByStation: [],
        topPosts: [],
        searchTrends: [],
        posts: []
      };
    }
    const resolvedLocations =
      authorized === null
        ? (filters.locationCode ? [filters.locationCode] : null)
        : filters.locationCode
          ? [filters.locationCode]
          : authorized;

    if (authorized !== null && filters.locationCode && !authorized.includes(filters.locationCode)) {
      throw new AppError(403, "forbidden_location_scope", "You do not have access to this location");
    }

    const params: unknown[] = [];
    const conditions: string[] = [];
    const searchConditions: string[] = [];

    if (filters.startDate) {
      conditions.push("cve.created_at >= ?");
      searchConditions.push("se.created_at >= ?");
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push("cve.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
      searchConditions.push("se.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(filters.endDate);
    }

    if (resolvedLocations && resolvedLocations.length > 0) {
      const placeholders = resolvedLocations.map(() => "?").join(",");
      conditions.push(`cve.location_code IN (${placeholders})`);
      searchConditions.push(`se.location_code IN (${placeholders})`);
      params.push(...resolvedLocations);
    }

    if (!filters.includeHistorical) {
      conditions.push("(viewer.id IS NULL OR viewer.active = 1)");
      searchConditions.push("(actor.id IS NULL OR actor.active = 1)");
    }

    const viewWhere = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const searchWhere = searchConditions.length > 0 ? `WHERE ${searchConditions.join(" AND ")}` : "";

    const viewsByStation = await database.query<RowDataPacket[]>(
      `SELECT cve.station_token, COUNT(*) AS views
       FROM content_view_events cve
       LEFT JOIN users viewer ON viewer.id = cve.viewer_user_id
       ${viewWhere}
       GROUP BY cve.station_token
       ORDER BY views DESC`,
      params
    );

    const topPosts = await database.query<RowDataPacket[]>(
      `SELECT cp.id, cp.title, COUNT(*) AS views
       FROM content_view_events cve
       INNER JOIN content_posts cp ON cp.id = cve.post_id
       LEFT JOIN users viewer ON viewer.id = cve.viewer_user_id
       ${viewWhere}
       GROUP BY cp.id, cp.title
       ORDER BY views DESC
       LIMIT 5`,
      params
    );

    const searchTrends = await database.query<RowDataPacket[]>(
      `SELECT se.search_term, COUNT(*) AS uses
       FROM search_events se
       LEFT JOIN users actor ON actor.id = se.actor_user_id
       ${searchWhere}
       GROUP BY se.search_term
       ORDER BY uses DESC
       LIMIT 10`,
      params
    );

    const posts = await this.listPosts(actor, filters.locationCode ?? undefined);

    return {
      viewsByStation: viewsByStation.map((row) => ({
        stationToken: String(row.station_token),
        views: Number(row.views)
      })),
      topPosts: topPosts.map((row) => ({
        id: Number(row.id),
        title: String(row.title),
        views: Number(row.views)
      })),
      searchTrends: searchTrends.map((row) => ({
        term: String(row.search_term),
        uses: Number(row.uses)
      })),
      posts
    };
  }
});
