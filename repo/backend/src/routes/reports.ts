import { Router } from "express";
import { access } from "node:fs/promises";
import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../http.js";
import type { createReportService } from "../services/report-service.js";

const scheduleSchema = z.object({
  templateId: z.number().int().positive(),
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  format: z.enum(["csv", "excel", "pdf"]),
  locationCode: z.string().nullable().optional(),
  subscriberUserIds: z.array(z.number().int().positive()).optional()
});

const generateSchema = z.object({
  templateId: z.number().int().positive(),
  format: z.enum(["csv", "excel", "pdf"]),
  locationCode: z.string().nullable().optional()
});

export const createReportsRouter = (
  reportService: ReturnType<typeof createReportService>,
  requireAdmin: RequestHandler
) => {
  const router = Router();

  router.get("/schedules", requireAdmin, asyncHandler(async (_req, res) => {
    ok(res, { schedules: await reportService.listSchedules() });
  }));

  router.get("/recipients", requireAdmin, asyncHandler(async (_req, res) => {
    ok(res, { recipients: await reportService.listRecipients() });
  }));

  router.post("/schedules", requireAdmin, asyncHandler(async (req, res) => {
    const input = scheduleSchema.parse(req.body);
    ok(res, {
      schedule: await reportService.createSchedule({
        ...input,
        createdByUserId: req.currentUser!.id
      })
    });
  }));

  router.post("/generate", requireAdmin, asyncHandler(async (req, res) => {
    const input = generateSchema.parse(req.body);
    ok(res, {
      report: await reportService.generateNow(
        input.templateId,
        input.format,
        req.currentUser!.id,
        input.locationCode ?? undefined
      )
    });
  }));

  router.get("/inbox", asyncHandler(async (req, res) => {
    ok(res, {
      inbox: await reportService.listInbox(req.currentUser!.id)
    });
  }));

  router.get("/inbox/:id/download", asyncHandler(async (req, res) => {
    const download = await reportService.getInboxDownload(req.currentUser!.id, Number(req.params.id));
    await access(download.filePath);
    res.download(download.filePath, download.fileName);
  }));

  return router;
};
