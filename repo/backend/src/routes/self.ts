import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../http.js";
import type { createMemberService } from "../services/member-service.js";

const consentSchema = z.object({
  consentStatus: z.enum(["granted", "declined"])
});

export const createSelfRouter = (memberService: ReturnType<typeof createMemberService>) => {
  const router = Router();

  router.get("/profile", asyncHandler(async (req, res) => {
    ok(res, {
      member: await memberService.getMember(req.currentUser!.id, req.currentUser!)
    });
  }));

  router.post("/consent/face", asyncHandler(async (req, res) => {
    const input = consentSchema.parse(req.body);
    ok(res, {
      member: await memberService.recordFaceConsent(
        req.currentUser!.id,
        req.currentUser!.id,
        input.consentStatus,
        req.currentUser!
      )
    });
  }));

  return router;
};
