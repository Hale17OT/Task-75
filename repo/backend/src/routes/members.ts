import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../http.js";
import type { createMemberService } from "../services/member-service.js";

const createMemberSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().min(1),
  password: z.string().min(12),
  phone: z.string().nullable(),
  locationCode: z.string().min(1),
  notes: z.string().nullable().optional(),
  coachUserId: z.number().int().positive().nullable().optional()
});

const assignCoachSchema = z.object({
  coachUserId: z.number().int().positive()
});

const consentSchema = z.object({
  consentStatus: z.enum(["granted", "declined"])
});

const coachLocationSchema = z.object({
  locationCode: z.string().min(1)
});

export const createMembersRouter = (memberService: ReturnType<typeof createMemberService>) => {
  const router = Router();

  router.get("/", asyncHandler(async (req, res) => {
    ok(res, {
      members: await memberService.listMembers(req.currentUser!),
      coaches: await memberService.listCoaches()
    });
  }));

  router.post("/", asyncHandler(async (req, res) => {
    const input = createMemberSchema.parse(req.body);
    ok(res, {
      member: await memberService.createMember(input, req.currentUser!)
    });
  }));

  router.post("/:id/coach-assignment", asyncHandler(async (req, res) => {
    const input = assignCoachSchema.parse(req.body);
    ok(res, {
      member: await memberService.assignCoach(Number(req.params.id), input.coachUserId, req.currentUser!)
    });
  }));

  router.post("/:id/consent/face", asyncHandler(async (req, res) => {
    const input = consentSchema.parse(req.body);
    ok(res, {
      member: await memberService.recordFaceConsent(
        Number(req.params.id),
        req.currentUser!.id,
        input.consentStatus,
        req.currentUser!
      )
    });
  }));

  router.get("/coaches/:coachUserId/locations", asyncHandler(async (req, res) => {
    ok(res, {
      locations: await memberService.listCoachLocations(Number(req.params.coachUserId), req.currentUser!)
    });
  }));

  router.post("/coaches/:coachUserId/locations", asyncHandler(async (req, res) => {
    const input = coachLocationSchema.parse(req.body);
    ok(res, {
      location: await memberService.assignCoachLocation(
        Number(req.params.coachUserId),
        input.locationCode,
        req.currentUser!
      )
    });
  }));

  return router;
};
