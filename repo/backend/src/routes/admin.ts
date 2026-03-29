import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../http.js";
import type { createOpsService } from "../services/ops-service.js";

const dryRunSchema = z.object({
  backupRunId: z.number().int().positive()
});

export const createAdminRouter = (opsService: ReturnType<typeof createOpsService>) => {
  const router = Router();

  router.get("/console", asyncHandler(async (_req, res) => {
    ok(res, {
      console: await opsService.getConsoleOverview()
    });
  }));

  router.post("/backups", asyncHandler(async (_req, res) => {
    ok(res, {
      backup: await opsService.createBackupNow()
    });
  }));

  router.post("/recovery/dry-run", asyncHandler(async (req, res) => {
    const input = dryRunSchema.parse(req.body);
    ok(res, {
      recovery: await opsService.dryRunRestore(input.backupRunId)
    });
  }));

  return router;
};
