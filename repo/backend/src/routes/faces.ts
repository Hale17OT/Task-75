import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../http.js";
import type { createFaceService } from "../services/face-service.js";

const enrollSchema = z.object({
  memberUserId: z.number().int().positive(),
  sourceType: z.enum(["camera", "import"]),
  challengeId: z.string().min(1),
  centerImageBase64: z.string().min(1),
  turnImageBase64: z.string().min(1)
});

const dedupCheckSchema = z.object({
  memberUserId: z.number().int().positive(),
  sourceType: z.enum(["camera", "import"]),
  centerImageBase64: z.string().min(1),
  turnImageBase64: z.string().min(1)
});

const challengeSchema = z.object({
  memberUserId: z.number().int().positive()
});

export const createFacesRouter = (faceService: ReturnType<typeof createFaceService>) => {
  const router = Router();

  router.post("/challenge", asyncHandler(async (req, res) => {
    const input = challengeSchema.parse(req.body);
    ok(res, {
      challenge: await faceService.startLivenessChallenge(input.memberUserId, req.currentUser!)
    });
  }));

  router.post("/dedup-check", asyncHandler(async (req, res) => {
    const input = dedupCheckSchema.parse(req.body);
    ok(res, {
      dedup: await faceService.previewDedup(input, req.currentUser!)
    });
  }));

  router.post("/enroll", asyncHandler(async (req, res) => {
    const input = enrollSchema.parse(req.body);
    ok(res, {
      result: await faceService.enrollFace({
        ...input,
        actorUserId: req.currentUser!.id
      }, req.currentUser!)
    });
  }));

  router.patch("/:faceRecordId/deactivate", asyncHandler(async (req, res) => {
    await faceService.deactivateFace(Number(req.params.faceRecordId), req.currentUser!.id, req.currentUser!);
    ok(res, { deactivated: true });
  }));

  router.get("/history/:memberUserId", asyncHandler(async (req, res) => {
    ok(res, {
      history: await faceService.getFaceHistory(Number(req.params.memberUserId), req.currentUser!)
    });
  }));

  router.get("/audit/:memberUserId", asyncHandler(async (req, res) => {
    ok(res, {
      auditTrail: await faceService.getAuditTrail(Number(req.params.memberUserId), req.currentUser!)
    });
  }));

  return router;
};
