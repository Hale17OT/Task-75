import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../http.js";
import type { createDashboardService } from "../services/dashboard-service.js";

const templateSchema = z.object({
  name: z.string().min(1),
  layout: z.array(
    z.object({
      id: z.string().min(1),
      widgetType: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      locationCode: z.string().min(1).optional(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number()
    })
  )
});

export const createDashboardsRouter = (
  dashboardService: ReturnType<typeof createDashboardService>
) => {
  const router = Router();

  router.get("/me", asyncHandler(async (req, res) => {
    ok(res, {
      layout: await dashboardService.getLayout(req.currentUser!.id),
      templates: await dashboardService.listTemplates()
    });
  }));

  router.put("/me", asyncHandler(async (req, res) => {
    const input = templateSchema.shape.layout.parse(req.body.layout);
    ok(res, {
      layout: await dashboardService.saveLayout(req.currentUser!.id, input)
    });
  }));

  router.post("/templates", asyncHandler(async (req, res) => {
    const input = templateSchema.parse(req.body);
    ok(res, {
      template: await dashboardService.createTemplate(input.name, input.layout, req.currentUser!.id)
    });
  }));

  return router;
};
