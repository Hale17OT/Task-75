import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import Jimp from "jimp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import type { Database } from "../src/database.js";
import { createFaceService } from "../src/services/face-service.js";
import type { AuthenticatedUser } from "../src/types.js";
import { baseConfig } from "./test-helpers.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();

  return {
    database: {
      pool: {} as Database["pool"],
      query,
      execute,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database,
    query,
    execute
  };
};

const cryptoService = {
  encrypt: vi.fn(async (value: string) => ({
    keyId: "key-1",
    cipherText: `encrypted:${value}`
  })),
  decrypt: vi.fn(async ({ cipherText }: { cipherText: string }) =>
    cipherText.startsWith("encrypted:") ? cipherText.slice("encrypted:".length) : cipherText
  ),
  encryptBytes: vi.fn(async (value: Buffer) => ({
    keyId: "key-1",
    cipherText: `encrypted:${value.toString("base64")}`
  })),
  decryptBytes: vi.fn(),
  hashForComparison: vi.fn((value: string) => `hash:${value}`),
  maskPhone: vi.fn()
};

const createFaceDataUrl = async (options?: { noseShift?: number; blur?: boolean }) => {
  const image = await new Jimp(640, 480, 0xffffffff);
  image.scan(180, 100, 280, 280, (x, y) => {
    const shade = (Math.floor((x - 180) / 6) + Math.floor((y - 100) / 6)) % 2 === 0 ? 0xc8c8c8ff : 0xf0f0f0ff;
    image.setPixelColor(shade, x, y);
  });

  const drawFeature = (left: number, top: number, width: number, height: number) => {
    image.scan(left, top, width, height, (x, y) => {
      image.setPixelColor(0x000000ff, x, y);
    });
  };

  drawFeature(250, 190, 34, 18);
  drawFeature(350, 190, 34, 18);
  drawFeature(305 + Math.round((options?.noseShift ?? 0) * 140), 235, 24, 48);
  drawFeature(270, 305, 100, 10);

  if (options?.blur) {
    image.blur(8);
  }

  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
  return {
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    averageHash: image.hash()
  };
};

describe("face service", () => {
  const dataDir = join(process.cwd(), "temp-face-service");
  const actor: AuthenticatedUser = {
    id: 1,
    username: "admin",
    fullName: "System Administrator",
    roles: ["Administrator"]
  };
  const unrelatedCoach: AuthenticatedUser = {
    id: 77,
    username: "coach-b",
    fullName: "Coach B",
    roles: ["Coach", "Member"]
  };
  const assignedCoach: AuthenticatedUser = {
    id: 55,
    username: "coach-a",
    fullName: "Coach A",
    roles: ["Coach", "Member"]
  };
  const memberSelfActor: AuthenticatedUser = {
    id: 7,
    username: "member-seven",
    fullName: "Member Seven",
    roles: ["Member"]
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await rm(dataDir, { force: true, recursive: true });
  });

  const startChallenge = async (
    service: ReturnType<typeof createFaceService>,
    memberUserId = 7,
    challengeActor: AuthenticatedUser = actor
  ) => {
    const challenge = await service.startLivenessChallenge(memberUserId, challengeActor);
    return challenge.challengeId;
  };

  it("requires explicit face consent before enrollment", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);

    await expect(
      service.enrollFace({
        memberUserId: 7,
        actorUserId: 1,
        sourceType: "import",
        challengeId: "missing",
        centerImageBase64: "data:image/png;base64,abc",
        turnImageBase64: "data:image/png;base64,abc"
      }, actor)
    ).rejects.toMatchObject({
      code: "consent_required"
    } satisfies Partial<AppError>);
  });

  it("creates a versioned face enrollment with encrypted artifact metadata", async () => {
    const { database, query, execute } = createMockDatabase();
    const center = await createFaceDataUrl();
    const turn = await createFaceDataUrl({ noseShift: 0.32 });
    query
      .mockResolvedValueOnce([{ consent_status: "granted" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12 }])
      .mockResolvedValueOnce([{ max_version: 0 }]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir,
      DEDUP_THRESHOLD: 0.85
    }, cryptoService as never);
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000_000);
    const challengeId = await startChallenge(service);
    nowSpy.mockReturnValue(1_005_000);

    const result = await service.enrollFace({
      memberUserId: 7,
      actorUserId: 1,
      sourceType: "import",
      challengeId,
      centerImageBase64: center.dataUrl,
      turnImageBase64: turn.dataUrl
    }, actor);

    expect(result.faceRecordId).toBe(12);
    expect(result.versionNumber).toBe(1);
    expect(result.blurScore).toBeGreaterThan(12);
    expect(result.livenessScore).toBeGreaterThan(0.2);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO face_record_versions"),
      expect.arrayContaining([12, 1, "import", expect.stringMatching(/\.enc$/), "key-1", "key-1", expect.stringMatching(/^encrypted:/), "key-1"])
    );
  }, 10000);

  it("blocks dedup hits even when the matched face record belongs to a deactivated account", async () => {
    const { database, query } = createMockDatabase();
    const center = await createFaceDataUrl();
    const turn = await createFaceDataUrl({ noseShift: 0.32 });
    query
      .mockResolvedValueOnce([{ consent_status: "granted" }])
      .mockResolvedValueOnce([
        {
          member_user_id: 88,
          status: "deactivated",
          average_hash: `encrypted:${center.averageHash}`,
          average_hash_key_id: "key-1"
        }
      ]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir,
      DEDUP_THRESHOLD: 0.85
    }, cryptoService as never);
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000_000);
    const challengeId = await startChallenge(service);
    nowSpy.mockReturnValue(1_005_000);

    await expect(
      service.enrollFace({
        memberUserId: 7,
        actorUserId: 1,
        sourceType: "import",
        challengeId,
        centerImageBase64: center.dataUrl,
        turnImageBase64: turn.dataUrl
      }, actor)
    ).rejects.toMatchObject({
      code: "duplicate_detected"
    } satisfies Partial<AppError>);
  }, 10000);

  it("previews duplicate warnings before enrollment submission", async () => {
    const { database, query } = createMockDatabase();
    const center = await createFaceDataUrl();
    const turn = await createFaceDataUrl({ noseShift: 0.32 });
    query.mockResolvedValueOnce([
      {
        member_user_id: 88,
        status: "deactivated",
        average_hash: `encrypted:${center.averageHash}`,
        average_hash_key_id: "key-1"
      }
    ]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir,
      DEDUP_THRESHOLD: 0.85
    }, cryptoService as never);

    const preview = await service.previewDedup({
      memberUserId: 7,
      sourceType: "import",
      centerImageBase64: center.dataUrl,
      turnImageBase64: turn.dataUrl
    }, actor);

    expect(preview.warningDetected).toBe(true);
    expect(preview.duplicateWarning).toMatchObject({
      memberUserId: 88,
      status: "deactivated"
    });
    await expect(access(join(dataDir, "uploads"))).rejects.toBeTruthy();
  });

  it("redacts matched member metadata in duplicate previews when actor is not authorized for the matched member", async () => {
    const { database, query } = createMockDatabase();
    const center = await createFaceDataUrl();
    const turn = await createFaceDataUrl({ noseShift: 0.32 });
    query
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([
        {
          member_user_id: 88,
          status: "deactivated",
          average_hash: `encrypted:${center.averageHash}`,
          average_hash_key_id: "key-1"
        }
      ])
      .mockResolvedValueOnce([]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir,
      DEDUP_THRESHOLD: 0.85
    }, cryptoService as never);

    const preview = await service.previewDedup({
      memberUserId: 7,
      sourceType: "import",
      centerImageBase64: center.dataUrl,
      turnImageBase64: turn.dataUrl
    }, assignedCoach);

    expect(preview.warningDetected).toBe(true);
    expect(preview.duplicateWarning).toMatchObject({
      redacted: true
    });
    expect((preview.duplicateWarning as Record<string, unknown>).memberUserId).toBeUndefined();
  });

  it("fails low-quality captures before enrollment is committed", async () => {
    const { database, query } = createMockDatabase();
    const smoothImage = (await createFaceDataUrl({ blur: true })).dataUrl;
    query.mockResolvedValueOnce([{ consent_status: "granted" }]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000_000);
    const challengeId = await startChallenge(service);
    nowSpy.mockReturnValue(1_005_000);

    await expect(
      service.enrollFace({
        memberUserId: 7,
        actorUserId: 1,
        sourceType: "import",
        challengeId,
        centerImageBase64: smoothImage,
        turnImageBase64: smoothImage
      }, actor)
    ).rejects.toMatchObject({
      code: "quality_failed"
    } satisfies Partial<AppError>);
  }, 10000);

  it("fails liveness when the second capture does not show the required server-derived head turn", async () => {
    const { database, query } = createMockDatabase();
    const center = await createFaceDataUrl();
    const turn = await createFaceDataUrl();
    query
      .mockResolvedValueOnce([{ consent_status: "granted" }])
      .mockResolvedValueOnce([]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000_000);
    const challengeId = await startChallenge(service);
    nowSpy.mockReturnValue(1_005_000);

    await expect(
      service.enrollFace({
        memberUserId: 7,
        actorUserId: 1,
        sourceType: "import",
        challengeId,
        centerImageBase64: center.dataUrl,
        turnImageBase64: turn.dataUrl
      }, actor)
    ).rejects.toMatchObject({
      code: "liveness_failed"
    } satisfies Partial<AppError>);
  }, 10000);

  it("rejects liveness captures outside the timed challenge window", async () => {
    const { database, query } = createMockDatabase();
    const center = await createFaceDataUrl();
    const turn = await createFaceDataUrl({ noseShift: 0.32 });
    query.mockResolvedValueOnce([{ consent_status: "granted" }]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000_000);
    const challengeId = await startChallenge(service);
    nowSpy.mockReturnValue(1_061_000);

    await expect(
      service.enrollFace({
        memberUserId: 7,
        actorUserId: 1,
        sourceType: "import",
        challengeId,
        centerImageBase64: center.dataUrl,
        turnImageBase64: turn.dataUrl
      }, actor)
    ).rejects.toMatchObject({
      code: "capture_timing_invalid"
    } satisfies Partial<AppError>);
  }, 10000);

  it("deactivates face records, lists version history, and returns audit trail", async () => {
    const { database, query, execute } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ member_user_id: 7 }])
      .mockResolvedValueOnce([
        {
          face_record_id: 12,
          status: "deactivated",
          deactivated_at: new Date("2026-03-28T10:00:00.000Z"),
          version_number: 2,
          blur_score: 18.2,
          liveness_score: 0.82,
          created_at: new Date("2026-03-28T09:59:00.000Z")
        }
      ])
      .mockResolvedValueOnce([
        {
          event_type: "face_record_deactivated",
          details_json: JSON.stringify({ faceRecordId: 12 }),
          full_name: "System Administrator",
          created_at: new Date("2026-03-28T10:00:01.000Z")
        }
      ]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);
    await service.deactivateFace(12, 1, actor);
    const history = await service.getFaceHistory(7, actor);
    const auditTrail = await service.getAuditTrail(7, actor);

    expect(history[0]?.status).toBe("deactivated");
    expect(history[0]?.versionNumber).toBe(2);
    expect(auditTrail[0]?.eventType).toBe("face_record_deactivated");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE face_records SET status = 'deactivated'"),
      [12]
    );
  });

  it("rejects unrelated coach access to face history", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);

    await expect(service.getFaceHistory(7, unrelatedCoach)).rejects.toMatchObject({
      code: "forbidden"
    } satisfies Partial<AppError>);
  });

  it("allows members to access their own face history", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([
      {
        face_record_id: 12,
        status: "active",
        deactivated_at: null,
        version_number: 1,
        blur_score: 18.2,
        liveness_score: 0.82,
        created_at: new Date("2026-03-28T09:59:00.000Z")
      }
    ]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);

    const history = await service.getFaceHistory(7, memberSelfActor);
    expect(history[0]?.faceRecordId).toBe(12);
  });

  it("rejects members attempting to access another member's face history", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createFaceService(database, {
      ...baseConfig,
      DATA_DIR: dataDir
    }, cryptoService as never);

    await expect(service.getFaceHistory(9, memberSelfActor)).rejects.toMatchObject({
      code: "forbidden"
    } satisfies Partial<AppError>);
  });
});
