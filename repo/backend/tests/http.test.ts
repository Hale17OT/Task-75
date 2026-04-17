import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { asyncHandler, errorPayload, ok } from "../src/http.js";

describe("http helpers", () => {
  it("ok wraps the payload in { ok: true, data }", async () => {
    const app = express();
    app.get("/x", (_req, res) => ok(res, { count: 7, label: "abc" }));

    const response = await request(app).get("/x");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, data: { count: 7, label: "abc" } });
  });

  it("errorPayload returns the canonical error envelope with details=null when omitted", () => {
    expect(errorPayload("forbidden", "no access")).toEqual({
      ok: false,
      error: { code: "forbidden", message: "no access", details: null }
    });
  });

  it("errorPayload preserves the details object when provided", () => {
    const details = { field: "username", reason: "missing" };
    expect(errorPayload("validation_failed", "bad", details)).toEqual({
      ok: false,
      error: { code: "validation_failed", message: "bad", details }
    });
  });

  it("asyncHandler forwards thrown errors to next() instead of crashing the request", async () => {
    const app = express();
    const failing = asyncHandler(async () => {
      throw new Error("inside async handler");
    });
    app.get("/boom", failing);
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json(errorPayload("internal_error", (err as Error).message));
    });

    const response = await request(app).get("/boom");
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("internal_error");
    expect(response.body.error.message).toBe("inside async handler");
  });

  it("asyncHandler invokes next exactly once on rejection", async () => {
    const next = vi.fn();
    const handler = asyncHandler(async () => {
      throw new Error("rejected");
    });
    await new Promise<void>((resolve) => {
      handler(
        {} as express.Request,
        {} as express.Response,
        ((err?: unknown) => {
          next(err);
          resolve();
        }) as express.NextFunction
      );
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("asyncHandler does not call next when the handler resolves cleanly", async () => {
    const next = vi.fn();
    const handler = asyncHandler(async (_req, res) => {
      (res as unknown as { sentinel: boolean }).sentinel = true;
    });
    const fakeRes = {} as express.Response;
    await new Promise<void>((resolve) => {
      handler({} as express.Request, fakeRes, ((err?: unknown) => {
        next(err);
        resolve();
      }) as express.NextFunction);
      setTimeout(resolve, 10);
    });
    expect(next).not.toHaveBeenCalled();
    expect((fakeRes as unknown as { sentinel: boolean }).sentinel).toBe(true);
  });
});
