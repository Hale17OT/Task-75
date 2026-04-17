import cookieParser from "cookie-parser";
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, isAppError } from "./errors.js";
import { errorPayload } from "./http.js";
import { isIpAllowed } from "./security.js";
import type { AppConfig } from "./config.js";
import { createRateLimiter, createSignaturePayload, verifySignature } from "./security.js";
import type { ReturnTypeOfCreateAuthService } from "./service-types.js";
import type { createLoggingService } from "./services/logging-service.js";
import type { Database } from "./database.js";

export type LoggingService = ReturnType<typeof createLoggingService>;

export const createMiddlewareSuite = (
  config: AppConfig,
  database: Database,
  authService: ReturnTypeOfCreateAuthService,
  loggingService: LoggingService
) => {
  const rateLimiter = createRateLimiter();
  const rateWindowMs = 60_000;
  const ipAbuseLimitMultiplier = 3;
  const resolveIpAddress = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";
  const resolveStationToken = (req: Request) => {
    const stationToken = req.stationToken?.trim();
    return stationToken && stationToken.length > 0 ? stationToken : "unknown-station";
  };
  const resolveAuthScope = (currentUser?: Request["currentUser"], currentSession?: Request["currentSession"]) =>
    currentUser?.id
      ? `user:${currentUser.id}`
      : currentSession?.sessionToken
        ? `session:${currentSession.sessionToken}`
        : "anonymous";
  const nonceStore = (() => {
    return {
      async assertFresh(sessionToken: string, nonce: string) {
        const windowMs = config.HMAC_WINDOW_MINUTES * 60 * 1000;
        const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
        const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
        await database.execute("DELETE FROM request_nonces WHERE expires_at <= UTC_TIMESTAMP()");
        try {
          await database.execute(
            `INSERT INTO request_nonces (session_token_hash, nonce, expires_at)
             VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
            [sessionTokenHash, nonce, windowSeconds]
          );
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
          if (code === "ER_DUP_ENTRY") {
            throw new AppError(401, "nonce_replayed", "The request nonce has already been used");
          }
          throw error;
        }
      }
    };
  })();

  const requestLogger = async (req: Request, res: Response, next: NextFunction) => {
    const ipAddress = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const startedAt = Date.now();

    res.on("finish", () => {
      void loggingService.access({
        userId: req.currentUser?.id ?? null,
        ipAddress,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        stationToken: req.stationToken,
        durationMs: Date.now() - startedAt
      });
    });

    next();
  };

  const allowlistedIpOnly = (req: Request, _res: Response, next: NextFunction) => {
    const ipAddress = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!isIpAllowed(config, ipAddress)) {
      next(new AppError(403, "ip_forbidden", "IP address is not allowlisted"));
      return;
    }

    next();
  };

  const rateLimitedSignIn = (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ipAddress = resolveIpAddress(req);
      const stationToken = resolveStationToken(req);
      rateLimiter.check(
        `signin:abuse-ip:${ipAddress}`,
        config.LOGIN_RATE_LIMIT_PER_MINUTE * ipAbuseLimitMultiplier,
        rateWindowMs
      );
      rateLimiter.check(
        `signin:ip:${ipAddress}:station:${stationToken}`,
        config.LOGIN_RATE_LIMIT_PER_MINUTE,
        rateWindowMs
      );
      next();
    } catch (error) {
      next(error);
    }
  };

  const rateLimitedApi = (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ipAddress = resolveIpAddress(req);
      const stationToken = resolveStationToken(req);
      rateLimiter.check(
        `api:abuse-ip:${ipAddress}`,
        config.API_RATE_LIMIT_PER_MINUTE * ipAbuseLimitMultiplier,
        rateWindowMs
      );
      rateLimiter.check(
        `api:ip:${ipAddress}:station:${stationToken}`,
        config.API_RATE_LIMIT_PER_MINUTE,
        rateWindowMs
      );
      next();
    } catch (error) {
      next(error);
    }
  };

  const attachStationToken = (req: Request, _res: Response, next: NextFunction) => {
    req.stationToken = req.header("x-station-token") ?? null;
    next();
  };

  const optionalSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionToken = req.cookies.sf_session as string | undefined;
      const sessionData = await authService.getSession(sessionToken);

      if (sessionData) {
        req.currentUser = sessionData.currentUser;
        req.currentSession = sessionData.session;
      }

      next();
    } catch (error) {
      if (isAppError(error) && (error.code === "invalid_session" || error.code === "session_expired")) {
        req.currentUser = undefined;
        req.currentSession = undefined;
        res.clearCookie("sf_session");
        res.clearCookie("sf_workstation");
        next();
        return;
      }
      next(error);
    }
  };

  const requireSignedSession = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const sessionToken = req.cookies.sf_session as string | undefined;
      if (!sessionToken) {
        throw new AppError(401, "missing_session", "Session cookie is required");
      }

      const sessionData = await authService.getSession(sessionToken);
      if (!sessionData) {
        throw new AppError(401, "invalid_session", "Session is not active");
      }
      await authService.assertWorkstationBinding(sessionToken, req.cookies.sf_workstation as string | undefined);
      if (sessionData.hasPin && sessionData.session.warmLockedAt) {
        throw new AppError(423, "warm_locked", "PIN re-entry is required to continue on this workstation");
      }

      const ipAddress = resolveIpAddress(req);
      const stationToken = resolveStationToken(req);
      rateLimiter.check(
        `auth:abuse-ip:${ipAddress}`,
        config.AUTH_RATE_LIMIT_PER_MINUTE * ipAbuseLimitMultiplier,
        rateWindowMs
      );
      rateLimiter.check(
        `auth:ip:${ipAddress}:station:${stationToken}:scope:${resolveAuthScope(
          sessionData.currentUser,
          sessionData.session
        )}`,
        config.AUTH_RATE_LIMIT_PER_MINUTE,
        rateWindowMs
      );

      const timestamp = req.header("x-sf-timestamp");
      const nonce = req.header("x-sf-nonce");
      const signature = req.header("x-sf-signature");

      if (!timestamp || !nonce || !signature) {
        throw new AppError(401, "signature_missing", "Signed request headers are required");
      }

      const timestampMs = Date.parse(timestamp);
      if (Number.isNaN(timestampMs)) {
        throw new AppError(401, "timestamp_invalid", "Timestamp header is invalid");
      }

      const windowMs = config.HMAC_WINDOW_MINUTES * 60 * 1000;
      if (Math.abs(Date.now() - timestampMs) > windowMs) {
        throw new AppError(401, "timestamp_stale", "Timestamp is outside the allowed window");
      }

      await nonceStore.assertFresh(sessionToken, nonce);
      const requestPath = req.originalUrl || req.path;
      const requestBody =
        req.method === "GET" ||
        req.method === "HEAD" ||
        !req.body ||
        (typeof req.body === "object" && Object.keys(req.body).length === 0)
          ? undefined
          : req.body;
      const payload = createSignaturePayload(req.method, requestPath, timestamp, nonce, requestBody);
      const valid = verifySignature(sessionData.session.sessionSecret, payload, signature);

      if (!valid) {
        throw new AppError(401, "signature_invalid", "Request signature is invalid");
      }

      req.currentUser = sessionData.currentUser;
      req.currentSession = sessionData.session;
      await authService.touchSession(sessionToken);
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireRole = (...requiredRoles: string[]) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      next(new AppError(401, "missing_session", "Session is required"));
      return;
    }

    const hasRole = requiredRoles.some((role) => req.currentUser?.roles.includes(role as never));
    if (!hasRole) {
      next(new AppError(403, "forbidden", "You do not have access to this resource"));
      return;
    }

    next();
  };

  const handleErrors = async (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      const details = error.flatten();
      await loggingService.log("http", "warn", "Request validation failed", {
        code: "validation_failed",
        statusCode: 400,
        details
      });
      res.status(400).json(errorPayload("validation_failed", "Request validation failed", details as never));
      return;
    }

    if (isAppError(error)) {
      await loggingService.log("http", "warn", error.message, {
        code: error.code,
        statusCode: error.statusCode,
        details: error.details ?? null
      });
      res.status(error.statusCode).json(errorPayload(error.code, error.message, error.details));
      return;
    }

    const message = error instanceof Error ? error.message : "Unexpected server error";
    if (message.includes("biometric_audit_log is immutable")) {
      await loggingService.alert(
        "audit_integrity",
        "high",
        "A biometric audit log mutation attempt was blocked"
      );
    }
    await loggingService.log("http", "error", message);
    res.status(500).json(errorPayload("internal_error", "Unexpected server error"));
  };

  return {
    cookieParser: cookieParser(),
    requestLogger,
    allowlistedIpOnly,
    rateLimitedApi,
    rateLimitedSignIn,
    attachStationToken,
    optionalSession,
    requireSignedSession,
    requireRole,
    handleErrors
  };
};
