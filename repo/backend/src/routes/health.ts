import { Router } from "express";
import type { AppConfig } from "../config.js";
import type { Database } from "../database.js";
import { asyncHandler, ok } from "../http.js";

export const createHealthRouter = (database: Database, config: AppConfig) => {
  const router = Router();

  router.get("/live", (_req, res) => {
    ok(res, {
      status: "ok",
      environment: config.NODE_ENV,
      service: "sentinelfit-backend"
    });
  });

  router.get("/ready", asyncHandler(async (_req, res) => {
    const databaseReady = await database.ping();
    res.status(databaseReady ? 200 : 503);
    ok(res, {
      status: databaseReady ? "ok" : "degraded",
      environment: config.NODE_ENV,
      services: {
        api: "up",
        database: databaseReady ? "up" : "down"
      }
    });
  }));

  return router;
};
