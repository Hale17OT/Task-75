import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  assertPasswordComplexity,
  assertPinComplexity,
  createNonceStore,
  createRateLimiter,
  createSignaturePayload,
  isIpAllowed,
  signPayload,
  verifySignature
} from "../src/security.js";
import { baseConfig } from "./test-helpers.js";

describe("security helpers", () => {
  it("enforces rate limits per bucket", () => {
    const limiter = createRateLimiter();

    limiter.check("signin:127.0.0.1", 2, 10_000);
    limiter.check("signin:127.0.0.1", 2, 10_000);

    expect(() => limiter.check("signin:127.0.0.1", 2, 10_000)).toThrowError(AppError);
  });

  it("rejects replayed nonces in the active window", () => {
    const nonceStore = createNonceStore();

    nonceStore.assertFresh("session-1", "nonce-1", 10_000);

    expect(() => nonceStore.assertFresh("session-1", "nonce-1", 10_000)).toThrowError(AppError);
  });

  it("builds and verifies request signatures", () => {
    const secret = Buffer.alloc(32, 9).toString("base64");
    const payload = createSignaturePayload(
      "POST",
      "/api/members",
      "2026-03-28T10:00:00.000Z",
      "nonce-1",
      { username: "member-one" }
    );
    const signature = signPayload(secret, payload);

    expect(verifySignature(secret, payload, signature)).toBe(true);
    expect(verifySignature(Buffer.alloc(32, 3).toString("base64"), payload, signature)).toBe(false);
  });

  it("enforces password and PIN policies", () => {
    expect(() => assertPasswordComplexity("weak")).toThrowError(AppError);
    expect(() => assertPasswordComplexity("StrongPassword1!")).not.toThrow();

    expect(() => assertPinComplexity("12")).toThrowError(AppError);
    expect(() => assertPinComplexity("1234")).not.toThrow();
  });

  it("enforces CIDR-aware allowlists instead of allowing all by default", () => {
    expect(isIpAllowed(baseConfig, "127.0.0.1")).toBe(true);
    expect(isIpAllowed(baseConfig, "172.18.0.8")).toBe(true);
    expect(
      isIpAllowed(
        {
          ...baseConfig,
          IP_ALLOWLIST: ["127.0.0.1/32"]
        },
        "10.0.0.12"
      )
    ).toBe(false);
  });
});
