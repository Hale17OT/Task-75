import cors from "cors";
import express from "express";
import type { AppConfig } from "./config.js";
import type { Database } from "./database.js";
import { createMiddlewareSuite } from "./middleware.js";
import type { ReturnTypeOfCreateAuthService } from "./service-types.js";
import type { createLoggingService } from "./services/logging-service.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAuthRouter } from "./routes/auth.js";
import { createContentRouter } from "./routes/content.js";
import { createDashboardsRouter } from "./routes/dashboards.js";
import { createFacesRouter } from "./routes/faces.js";
import { createHealthRouter } from "./routes/health.js";
import { createMembersRouter } from "./routes/members.js";
import { createReportsRouter } from "./routes/reports.js";
import { createSelfRouter } from "./routes/self.js";
import type { createMemberService } from "./services/member-service.js";
import type { createFaceService } from "./services/face-service.js";
import type { createContentService } from "./services/content-service.js";
import type { createDashboardService } from "./services/dashboard-service.js";
import type { createReportService } from "./services/report-service.js";
import type { createOpsService } from "./services/ops-service.js";
import "./request-context.js";

interface AppServices {
  authService: ReturnTypeOfCreateAuthService;
  loggingService: ReturnType<typeof createLoggingService>;
  memberService: ReturnType<typeof createMemberService>;
  faceService: ReturnType<typeof createFaceService>;
  contentService: ReturnType<typeof createContentService>;
  dashboardService: ReturnType<typeof createDashboardService>;
  reportService: ReturnType<typeof createReportService>;
  opsService: ReturnType<typeof createOpsService>;
}

export const createApp = (config: AppConfig, database: Database, services: AppServices) => {
  const app = express();
  const middleware = createMiddlewareSuite(config, services.authService, services.loggingService);

  app.use(
    cors({
      origin: config.ALLOWED_ORIGINS,
      credentials: true
    })
  );
  app.use(middleware.cookieParser);
  app.use(express.json({ limit: "10mb" }));
  app.use(middleware.attachStationToken);
  app.use(middleware.requestLogger);
  app.use(middleware.allowlistedIpOnly);

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      data: {
        name: "SentinelFit Operations Backend",
        slice: "full-platform"
      }
    });
  });

  app.use("/health", createHealthRouter(database, config));

  app.use(
    "/api/auth",
    middleware.optionalSession,
    createAuthRouter(
      services.authService,
      config,
      middleware.rateLimitedSignIn,
      middleware.requireSignedSession
    )
  );

  app.use(
    "/api/self",
    middleware.requireSignedSession,
    createSelfRouter(services.memberService)
  );
  app.use(
    "/api/members",
    middleware.requireSignedSession,
    middleware.requireRole("Coach", "Administrator"),
    createMembersRouter(services.memberService)
  );
  app.use(
    "/api/faces",
    middleware.requireSignedSession,
    middleware.requireRole("Member", "Coach", "Administrator"),
    createFacesRouter(services.faceService)
  );
  app.use("/api/content", middleware.requireSignedSession, createContentRouter(services.contentService));
  app.use(
    "/api/dashboards",
    middleware.requireSignedSession,
    middleware.requireRole("Administrator"),
    createDashboardsRouter(services.dashboardService)
  );
  app.use(
    "/api/reports",
    middleware.requireSignedSession,
    createReportsRouter(services.reportService, middleware.requireRole("Administrator"))
  );
  app.use(
    "/api/admin",
    middleware.requireSignedSession,
    middleware.requireRole("Administrator"),
    createAdminRouter(services.opsService)
  );

  app.use(middleware.handleErrors);

  return app;
};
