import request from "supertest";
import { describe, expect, it } from "vitest";
import { createStubApp, createStubDatabase } from "./test-helpers.js";

describe("health routes", () => {
  it("returns live status", async () => {
    const app = createStubApp();

    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.body.data.service).toBe("sentinelfit-backend");
  });

  it("returns backend metadata from the root route", async () => {
    const app = createStubApp();

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe("SentinelFit Operations Backend");
    expect(response.body.data.slice).toBe("full-platform");
  });

  it("returns readiness success when database is healthy", async () => {
    const app = createStubApp(undefined, createStubDatabase(true));

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.data.services.database).toBe("up");
  });

  it("returns degraded readiness when database is unavailable", async () => {
    const app = createStubApp(undefined, createStubDatabase(false));

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.data.status).toBe("degraded");
    expect(response.body.data.services.database).toBe("down");
  });
});

