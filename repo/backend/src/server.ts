import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createCryptoService } from "./crypto.js";
import { createDatabase } from "./database.js";
import { createKeyVault } from "./key-vault.js";
import { logger } from "./logger.js";
import { createAuthService } from "./services/auth-service.js";
import { createContentService } from "./services/content-service.js";
import { createDashboardService } from "./services/dashboard-service.js";
import { createFaceService } from "./services/face-service.js";
import { createLoggingService } from "./services/logging-service.js";
import { createMemberService } from "./services/member-service.js";
import { createOpsService } from "./services/ops-service.js";
import { createReportService } from "./services/report-service.js";

const wait = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const start = async () => {
  const config = loadConfig();
  const database = createDatabase(config);
  let initialized = false;
  let attempts = 0;

  while (!initialized && attempts < 5) {
    try {
      await database.initialize();
      initialized = true;
    } catch (error) {
      attempts += 1;
      if (attempts >= 5) {
        throw error;
      }
      logger.warn({ attempt: attempts, error }, "Database initialization failed, retrying");
      await wait(2_000 * attempts);
    }
  }

  const keyVault = createKeyVault(config, async (key) => {
    await database.execute(
      `INSERT INTO encryption_keys (key_id, created_at, rotated_at, is_active)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rotated_at = VALUES(rotated_at), is_active = VALUES(is_active)`,
      [
        key.id,
        key.createdAt.slice(0, 19).replace("T", " "),
        key.rotatedAt ? key.rotatedAt.slice(0, 19).replace("T", " ") : null,
        key.active ? 1 : 0
      ]
    );
  });
  await keyVault.syncMetadata();

  const cryptoService = createCryptoService(keyVault);
  const loggingService = createLoggingService(database);
  const authService = createAuthService(database, config, cryptoService);
  const memberService = createMemberService(database, cryptoService);
  const faceService = createFaceService(database, config, cryptoService);
  const contentService = createContentService(database);
  const dashboardService = createDashboardService(database);
  const reportService = createReportService(
    database,
    config,
    contentService,
    dashboardService,
    loggingService
  );
  const opsService = createOpsService(database, config, cryptoService, loggingService);

  await authService.hardenStoredSessions();
  await faceService.hardenStoredArtifacts();
  await reportService.loadSchedules();
  await opsService.registerBackgroundJobs();

  const app = createApp(config, database, {
    authService,
    loggingService,
    memberService,
    faceService,
    contentService,
    dashboardService,
    reportService,
    opsService
  });

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "SentinelFit backend started");
  });

  const shutdown = async () => {
    logger.info("Shutting down SentinelFit backend");
    server.close(async () => {
      await database.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  logger.error({ err: error }, "Failed to start SentinelFit backend");
  process.exit(1);
});
