import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import "../src/request-context.js";
import type { AuthenticatedUser, SessionRecord } from "../src/types.js";

describe("request-context augmentation", () => {
  it("allows handlers to attach currentUser, currentSession, stationToken, and requestId to the Request", async () => {
    const app = express();
    app.get("/inspect", (req, _res, next) => {
      req.currentUser = {
        id: 7,
        username: "ctx",
        fullName: "Context User",
        roles: ["Member"]
      } as AuthenticatedUser;
      req.currentSession = {
        id: 1,
        userId: 7,
        sessionToken: "ctx-session",
        sessionSecret: "secret",
        sessionSecretKeyId: "key-1",
        stationToken: "Ctx-Desk",
        workstationBindingHash: null,
        warmLockedAt: null,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        revokedAt: null
      } as SessionRecord;
      req.stationToken = "Ctx-Desk";
      req.requestId = "req-1";
      next();
    });
    app.get("/inspect", (req, res) => {
      res.json({
        currentUser: req.currentUser,
        stationToken: req.stationToken,
        requestId: req.requestId,
        sessionToken: req.currentSession?.sessionToken
      });
    });

    const response = await request(app).get("/inspect");
    expect(response.status).toBe(200);
    expect(response.body.currentUser).toEqual(
      expect.objectContaining({ id: 7, username: "ctx", roles: ["Member"] })
    );
    expect(response.body.stationToken).toBe("Ctx-Desk");
    expect(response.body.requestId).toBe("req-1");
    expect(response.body.sessionToken).toBe("ctx-session");
  });

  it("leaves the Request augmented fields undefined when not set by upstream middleware", async () => {
    const app = express();
    app.get("/inspect", (req, res) => {
      res.json({
        hasUser: req.currentUser !== undefined,
        hasSession: req.currentSession !== undefined,
        stationToken: req.stationToken ?? null,
        requestId: req.requestId ?? null
      });
    });

    const response = await request(app).get("/inspect");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      hasUser: false,
      hasSession: false,
      stationToken: null,
      requestId: null
    });
  });
});
