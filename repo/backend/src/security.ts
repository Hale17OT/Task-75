import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { AppError } from "./errors.js";
import type { AppConfig } from "./config.js";

interface RateBucket {
  count: number;
  resetAt: number;
}

export const createRateLimiter = () => {
  const buckets = new Map<string, RateBucket>();

  return {
    check(key: string, limit: number, windowMs: number) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, {
          count: 1,
          resetAt: now + windowMs
        });
        return;
      }

      if (bucket.count >= limit) {
        throw new AppError(429, "rate_limited", "Rate limit exceeded");
      }

      bucket.count += 1;
      buckets.set(key, bucket);
    }
  };
};

export const createNonceStore = () => {
  const values = new Map<string, Map<string, number>>();

  return {
    assertFresh(sessionToken: string, nonce: string, windowMs: number) {
      const now = Date.now();
      const sessionValues = values.get(sessionToken) ?? new Map<string, number>();

      for (const [existingNonce, expiresAt] of sessionValues.entries()) {
        if (expiresAt <= now) {
          sessionValues.delete(existingNonce);
        }
      }

      if (sessionValues.has(nonce)) {
        throw new AppError(401, "nonce_replayed", "The request nonce has already been used");
      }

      sessionValues.set(nonce, now + windowMs);
      values.set(sessionToken, sessionValues);
    }
  };
};

export const createSignaturePayload = (
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: unknown
) => {
  const bodyHash = createHash("sha256")
    .update(body ? JSON.stringify(body) : "")
    .digest("hex");

  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
};

export const signPayload = (secret: string, payload: string) =>
  createHmac("sha256", Buffer.from(secret, "base64")).update(payload).digest("hex");

export const verifySignature = (secret: string, payload: string, signature: string) => {
  const expected = Buffer.from(signPayload(secret, payload), "hex");
  const actual = Buffer.from(signature, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const generateSessionToken = () => randomBytes(32).toString("hex");

export const generateSessionSecret = () => randomBytes(32).toString("base64");

export const generateWorkstationBindingToken = () => randomBytes(32).toString("hex");

export const assertPasswordComplexity = (password: string) => {
  const complexityRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/;

  if (!complexityRegex.test(password)) {
    throw new AppError(
      400,
      "password_policy",
      "Passwords must be at least 12 characters and include upper, lower, number, and symbol"
    );
  }
};

export const assertPinComplexity = (pin: string) => {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new AppError(400, "pin_policy", "PIN must be 4 to 6 digits");
  }
};

const normalizeIp = (value: string) => value.replace(/^::ffff:/, "");

const ipv4ToInt = (value: string) =>
  normalizeIp(value)
    .split(".")
    .map((segment) => Number(segment))
    .reduce((accumulator, segment) => (accumulator << 8) + segment, 0) >>> 0;

const matchesCidr = (ip: string, rule: string) => {
  const [range, prefixValue] = rule.split("/");
  if (!range || !prefixValue || isIP(normalizeIp(ip)) !== 4 || isIP(normalizeIp(range)) !== 4) {
    return false;
  }

  const prefix = Number(prefixValue);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
};

export const isIpAllowed = (config: AppConfig, ip: string) => {
  const normalizedIp = normalizeIp(ip);
  return config.IP_ALLOWLIST.some((rule) => {
    const normalizedRule = normalizeIp(rule);
    return normalizedRule.includes("/")
      ? matchesCidr(normalizedIp, normalizedRule)
      : normalizedRule === normalizedIp;
  });
};
