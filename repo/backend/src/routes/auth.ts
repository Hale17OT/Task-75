import { Router } from "express";
import type { RequestHandler, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import { asyncHandler, ok } from "../http.js";
import type { ReturnTypeOfCreateAuthService } from "../service-types.js";
import type { AppConfig } from "../config.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(12)
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/)
});

const pinReentrySchema = z.object({
  username: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/)
});

const bootstrapSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().min(1),
  password: z.string().min(12)
});

export const createAuthRouter = (
  authService: ReturnTypeOfCreateAuthService,
  config: AppConfig,
  rateLimitedSignIn: RequestHandler,
  requireSignedSession: RequestHandler
) => {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.NODE_ENV === "production"
  };
  const setSessionCookies = (res: Response, sessionToken: string, workstationBindingToken: string) => {
    res.cookie("sf_session", sessionToken, cookieOptions);
    res.cookie("sf_workstation", workstationBindingToken, cookieOptions);
  };

  router.get("/bootstrap/status", asyncHandler(async (_req, res) => {
    ok(res, await authService.getBootstrapStatus());
  }));

  router.post("/restore", rateLimitedSignIn, asyncHandler(async (req, res) => {
    const session = await authService.restoreSession(
      req.cookies.sf_session as string | undefined,
      req.cookies.sf_workstation as string | undefined
    );

    ok(res, {
      session: null,
      warmLocked: session?.status === "warm_locked",
      currentUser: session ? session.currentUser : null,
      hasPin: session?.hasPin ?? false,
      warmLockMinutes: session?.warmLockMinutes ?? config.WARM_LOCK_MINUTES,
      sessionTimeoutMinutes: session?.sessionTimeoutMinutes ?? config.SESSION_TIMEOUT_MINUTES,
      lastActivityAt:
        session?.status === "warm_locked"
          ? session.lastActivityAt
          : null
    });
  }));

  router.post("/bootstrap/admin", rateLimitedSignIn, asyncHandler(async (req, res) => {
    const input = bootstrapSchema.parse(req.body);
    const result = await authService.bootstrapAdministrator(
      input.username,
      input.fullName,
      input.password,
      req.stationToken ?? "Unknown-Station"
    );

    setSessionCookies(res, result.session.sessionToken, result.workstationBindingToken);

    ok(res, {
      currentUser: result.currentUser,
      sessionSecret: result.session.sessionSecret,
      sessionTimeoutMinutes: result.sessionTimeoutMinutes,
      warmLockMinutes: result.warmLockMinutes,
      hasPin: result.hasPin
    });
  }));

  router.post("/login", rateLimitedSignIn, asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(
      input.username,
      input.password,
      req.ip ?? req.socket.remoteAddress ?? "unknown",
      req.stationToken ?? "Unknown-Station"
    );

    setSessionCookies(res, result.session.sessionToken, result.workstationBindingToken);

    ok(res, {
      currentUser: result.currentUser,
      sessionSecret: result.session.sessionSecret,
      sessionTimeoutMinutes: result.sessionTimeoutMinutes,
      warmLockMinutes: result.warmLockMinutes,
      hasPin: result.hasPin
    });
  }));

  router.post("/pin/setup", requireSignedSession, asyncHandler(async (req, res) => {
    if (!req.currentUser) {
      throw new AppError(401, "missing_session", "Session is required");
    }
    const input = pinSchema.parse(req.body);
    await authService.setupPin(req.currentUser!.id, input.pin);
    ok(res, { hasPin: true });
  }));

  router.post("/pin/reenter", rateLimitedSignIn, asyncHandler(async (req, res) => {
    const input = pinReentrySchema.parse(req.body);
    const result = await authService.reenterWithPin(
      input.username,
      input.pin,
      req.cookies.sf_session as string | undefined,
      req.stationToken ?? "Unknown-Station",
      req.cookies.sf_workstation as string | undefined,
      req.ip ?? req.socket.remoteAddress ?? "unknown"
    );

    setSessionCookies(res, result.session.sessionToken, result.workstationBindingToken);

    ok(res, {
      currentUser: result.currentUser,
      sessionSecret: result.session.sessionSecret,
      sessionTimeoutMinutes: result.sessionTimeoutMinutes,
      warmLockMinutes: result.warmLockMinutes,
      hasPin: result.hasPin
    });
  }));

  router.post("/warm-lock", requireSignedSession, asyncHandler(async (req, res) => {
    if (!req.currentSession) {
      throw new AppError(401, "missing_session", "Session is required");
    }
    await authService.warmLockSession(req.currentSession.sessionToken);
    ok(res, { warmLocked: true });
  }));

  router.post("/logout", requireSignedSession, asyncHandler(async (req, res) => {
    if (!req.currentSession) {
      throw new AppError(401, "missing_session", "Session is required");
    }
    if (req.currentSession) {
      await authService.logout(req.currentSession.sessionToken);
    }
    res.clearCookie("sf_session");
    res.clearCookie("sf_workstation");
    ok(res, { loggedOut: true });
  }));

  router.get("/session", requireSignedSession, asyncHandler(async (req, res) => {
    if (!req.currentSession || !req.currentUser) {
      throw new AppError(401, "missing_session", "Session is required");
    }
    const session = await authService.getSession(req.currentSession.sessionToken);
    ok(res, {
      session: session
        ? {
            currentUser: session.currentUser,
            hasPin: session.hasPin,
            warmLockMinutes: config.WARM_LOCK_MINUTES,
            sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES,
            lastActivityAt: session.session.lastActivityAt.toISOString()
          }
        : null
    });
  }));

  return router;
};
