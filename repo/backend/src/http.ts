import type { NextFunction, Request, Response } from "express";

export const ok = <T>(res: Response, data: T) => {
  res.json({
    ok: true,
    data
  });
};

export const errorPayload = (code: string, message: string, details?: Record<string, unknown>) => ({
  ok: false,
  error: {
    code,
    message,
    details: details ?? null
  }
});

export const asyncHandler =
  <T extends Request>(handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: T, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
