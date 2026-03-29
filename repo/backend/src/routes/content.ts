import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import { asyncHandler, ok } from "../http.js";
import type { createContentService } from "../services/content-service.js";

const postSchema = z.object({
  kind: z.enum(["tip", "announcement"]),
  title: z.string().min(1),
  body: z.string().min(1),
  locationCode: z.string().min(1)
});

const viewSchema = z.object({
  postId: z.number().int().positive()
});

const searchSchema = z.object({
  searchTerm: z.string().min(1),
  locationCode: z.string().min(1)
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const analyticsQuerySchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  locationCode: z.string().min(1).max(100).optional(),
  includeHistorical: z
    .union([z.literal("true"), z.literal("false"), z.undefined()])
    .transform((value) => value === "true")
}).superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must be on or after start date",
      path: ["endDate"]
    });
  }
});

export const createContentRouter = (contentService: ReturnType<typeof createContentService>) => {
  const router = Router();
  const assertCoachAccess = (): RequestHandler => (req, _res, next) => {
    if (!req.currentUser?.roles.some((role) => role === "Coach" || role === "Administrator")) {
      next(new AppError(403, "forbidden", "Coach or Administrator access is required"));
      return;
    }
    next();
  };

  router.get("/posts", asyncHandler(async (req, res) => {
    ok(res, {
      posts: await contentService.listPosts(req.currentUser!, req.query.locationCode as string | undefined)
    });
  }));

  router.post("/posts", assertCoachAccess(), asyncHandler(async (req, res) => {
    const input = postSchema.parse(req.body);
    ok(res, {
      post: await contentService.createPost({
        actor: req.currentUser!,
        ...input,
        authorUserId: req.currentUser!.id
      })
    });
  }));

  router.post("/views", asyncHandler(async (req, res) => {
    const input = viewSchema.parse(req.body);
    await contentService.recordView({
      postId: input.postId,
      actor: req.currentUser!,
      viewerUserId: req.currentUser?.id ?? null,
      stationToken: req.stationToken ?? "Unknown-Station"
    });
    ok(res, { recorded: true });
  }));

  router.post("/search-events", asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.body);
    await contentService.recordSearch({
      actor: req.currentUser!,
      actorUserId: req.currentUser?.id ?? null,
      searchTerm: input.searchTerm,
      stationToken: req.stationToken ?? "Unknown-Station",
      locationCode: input.locationCode
    });
    ok(res, { recorded: true });
  }));

  router.get("/analytics", assertCoachAccess(), asyncHandler(async (req, res) => {
    const filters = analyticsQuerySchema.parse(req.query);
    ok(res, {
      analytics: await contentService.analytics(req.currentUser!, {
        startDate: filters.startDate,
        endDate: filters.endDate,
        locationCode: filters.locationCode,
        includeHistorical: filters.includeHistorical
      })
    });
  }));

  return router;
};
