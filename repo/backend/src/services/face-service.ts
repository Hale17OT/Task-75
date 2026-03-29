import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Jimp from "jimp";
import type { RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { AuthenticatedUser } from "../types.js";
import type { ReturnTypeOfCreateCryptoService } from "./service-utility-types.js";
import { generateSessionToken } from "../security.js";

interface Point {
  x: number;
  y: number;
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Landmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
}

interface FaceEnrollmentInput {
  memberUserId: number;
  actorUserId: number;
  sourceType: "camera" | "import";
  challengeId: string;
  centerImageBase64: string;
  turnImageBase64: string;
}

interface FaceDedupPreviewInput {
  memberUserId: number;
  sourceType: "camera" | "import";
  centerImageBase64: string;
  turnImageBase64: string;
}

interface LivenessChallenge {
  challengeId: string;
  memberUserId: number;
  actorUserId: number;
  issuedAt: number;
  expiresAt: number;
}

interface TrustedFaceAnalysis {
  blurScore: number;
  averageHash: string;
  encryptedAverageHash: Awaited<ReturnType<ReturnTypeOfCreateCryptoService["encrypt"]>> | null;
  absolutePath: string | null;
  keyId: string | null;
  width: number;
  height: number;
  faceBox: FaceBox;
  landmarks: Landmarks;
  faceInFrame: boolean;
}

const decodeBase64Image = (value: string) => {
  const match = value.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/);
  if (!match) {
    throw new AppError(400, "image_invalid", "Images must be PNG or JPG data URLs");
  }

  const mimeType = match[1];
  const payload = Buffer.from(match[2], "base64");
  const extension = mimeType === "image/png" ? "png" : "jpg";

  return {
    mimeType,
    extension,
    payload
  };
};

const hammingSimilarity = (left: string, right: string) => {
  const maxLength = Math.max(left.length, right.length);
  let distance = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }

  return 1 - distance / maxLength;
};

const computeBlurScore = (image: Jimp) => {
  const grayscale = image.clone().greyscale();
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < grayscale.bitmap.height - 1; y += 1) {
    for (let x = 1; x < grayscale.bitmap.width - 1; x += 1) {
      const center = Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      const right = Jimp.intToRGBA(grayscale.getPixelColor(x + 1, y)).r;
      const bottom = Jimp.intToRGBA(grayscale.getPixelColor(x, y + 1)).r;
      const edge = Math.abs(center - right) + Math.abs(center - bottom);
      sum += edge;
      sumSquares += edge * edge;
      count += 1;
    }
  }

  const mean = sum / count;
  return Math.sqrt(sumSquares / count - mean * mean);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizePoint = (x: number, y: number, width: number, height: number): Point => ({
  x: Number(clamp(x / width, 0, 1).toFixed(4)),
  y: Number(clamp(y / height, 0, 1).toFixed(4))
});

const deriveWeightedPoint = (
  image: Jimp,
  region: { left: number; top: number; right: number; bottom: number },
  threshold: number,
  label: string
) => {
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let darkest = { value: Number.POSITIVE_INFINITY, x: region.left, y: region.top };

  for (let y = Math.max(0, Math.floor(region.top)); y < Math.min(image.bitmap.height, Math.ceil(region.bottom)); y += 1) {
    for (let x = Math.max(0, Math.floor(region.left)); x < Math.min(image.bitmap.width, Math.ceil(region.right)); x += 1) {
      const brightness = Jimp.intToRGBA(image.getPixelColor(x, y)).r;
      if (brightness < darkest.value) {
        darkest = { value: brightness, x, y };
      }

      const weight = Math.max(0, threshold - brightness);
      if (weight <= 0) {
        continue;
      }

      totalWeight += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  if (totalWeight <= 0) {
    if (darkest.value < threshold) {
      return { x: darkest.x, y: darkest.y };
    }

    throw new AppError(400, "face_landmarks_invalid", `Unable to derive a trusted ${label} landmark from the image`);
  }

  return {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight
  };
};

const deriveTrustedMetadata = (image: Jimp) => {
  const grayscale = image.clone().greyscale();
  const width = grayscale.bitmap.width;
  const height = grayscale.bitmap.height;
  const sampleStep = 2;
  let brightnessTotal = 0;
  let brightnessCount = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      brightnessTotal += Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      brightnessCount += 1;
    }
  }

  const meanBrightness = brightnessTotal / brightnessCount;
  const darkThreshold = clamp(meanBrightness - 20, 24, 210);
  const horizontalMargin = width * 0.08;
  const verticalMargin = height * 0.08;

  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let y = Math.floor(verticalMargin); y < Math.ceil(height - verticalMargin); y += sampleStep) {
    for (let x = Math.floor(horizontalMargin); x < Math.ceil(width - horizontalMargin); x += sampleStep) {
      const brightness = Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      const weight = Math.max(0, darkThreshold - brightness);
      if (weight <= 0) {
        continue;
      }

      totalWeight += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  if (totalWeight <= 200) {
    throw new AppError(400, "face_box_invalid", "A trusted face region could not be derived from the image");
  }

  const centroidX = weightedX / totalWeight;
  const centroidY = weightedY / totalWeight;

  for (let y = Math.floor(verticalMargin); y < Math.ceil(height - verticalMargin); y += sampleStep) {
    for (let x = Math.floor(horizontalMargin); x < Math.ceil(width - horizontalMargin); x += sampleStep) {
      const brightness = Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      const weight = Math.max(0, darkThreshold - brightness);
      if (weight <= 0) {
        continue;
      }

      varianceX += (x - centroidX) ** 2 * weight;
      varianceY += (y - centroidY) ** 2 * weight;
    }
  }

  const spreadX = Math.sqrt(varianceX / totalWeight);
  const spreadY = Math.sqrt(varianceY / totalWeight);
  const boxWidth = clamp(spreadX * 5.2, width * 0.22, width * 0.92);
  const boxHeight = clamp(spreadY * 6.2, height * 0.25, height * 0.94);
  const left = clamp(centroidX - boxWidth / 2, 0, width - boxWidth);
  const top = clamp(centroidY - boxHeight / 2, 0, height - boxHeight);

  const faceBox: FaceBox = {
    x: Number((left / width).toFixed(4)),
    y: Number((top / height).toFixed(4)),
    width: Number((boxWidth / width).toFixed(4)),
    height: Number((boxHeight / height).toFixed(4))
  };

  const faceInFrame =
    faceBox.width >= 0.22 &&
    faceBox.height >= 0.25 &&
    faceBox.x >= 0.02 &&
    faceBox.y >= 0.02 &&
    faceBox.x + faceBox.width <= 0.98 &&
    faceBox.y + faceBox.height <= 0.98;

  if (!faceInFrame) {
    throw new AppError(400, "face_box_invalid", "Face must be fully in frame");
  }

  const leftEye = deriveWeightedPoint(
    grayscale,
    {
      left,
      top,
      right: left + boxWidth * 0.48,
      bottom: top + boxHeight * 0.42
    },
    darkThreshold,
    "left eye"
  );
  const rightEye = deriveWeightedPoint(
    grayscale,
    {
      left: left + boxWidth * 0.52,
      top,
      right: left + boxWidth,
      bottom: top + boxHeight * 0.42
    },
    darkThreshold,
    "right eye"
  );
  const nose = deriveWeightedPoint(
    grayscale,
    {
      left: left + boxWidth * 0.28,
      top: top + boxHeight * 0.32,
      right: left + boxWidth * 0.72,
      bottom: top + boxHeight * 0.82
    },
    darkThreshold,
    "nose"
  );

  const landmarks: Landmarks = {
    leftEye: normalizePoint(leftEye.x, leftEye.y, width, height),
    rightEye: normalizePoint(rightEye.x, rightEye.y, width, height),
    nose: normalizePoint(nose.x, nose.y, width, height)
  };

  if (landmarks.leftEye.x >= landmarks.rightEye.x) {
    throw new AppError(400, "face_landmarks_invalid", "Trusted landmark detection did not produce a valid face geometry");
  }

  return {
    faceBox,
    landmarks,
    faceInFrame
  };
};

const computeTrustedLivenessScore = (
  centerLandmarks: Landmarks,
  turnLandmarks: Landmarks,
  centerFaceBox: FaceBox,
  turnFaceBox: FaceBox
) => {
  const centerMidEye = (centerLandmarks.leftEye.x + centerLandmarks.rightEye.x) / 2;
  const turnMidEye = (turnLandmarks.leftEye.x + turnLandmarks.rightEye.x) / 2;
  const centerEyeDistance = Math.abs(centerLandmarks.rightEye.x - centerLandmarks.leftEye.x);
  const turnEyeDistance = Math.abs(turnLandmarks.rightEye.x - turnLandmarks.leftEye.x);
  const noseShift = Math.abs((turnLandmarks.nose.x - turnMidEye) - (centerLandmarks.nose.x - centerMidEye));
  const boxShift = Math.abs(
    turnFaceBox.x + turnFaceBox.width / 2 - (centerFaceBox.x + centerFaceBox.width / 2)
  );
  const verticalStabilityPenalty = Math.min(1, Math.abs(centerLandmarks.nose.y - turnLandmarks.nose.y) * 5);
  const eyeDistancePenalty = Math.min(1, Math.abs(centerEyeDistance - turnEyeDistance) * 4);
  const movementScore = noseShift * 4 + boxShift * 2;
  const structuralScore = Math.max(0, 1 - verticalStabilityPenalty - eyeDistancePenalty);

  return Math.max(0, Math.min(1, movementScore * 0.85 + structuralScore * 0.15));
};

export const createFaceService = (
  database: Database,
  config: AppConfig,
  cryptoService: ReturnTypeOfCreateCryptoService
) => {
  const uploadsDir = join(config.DATA_DIR, "uploads");
  const minLivenessDelayMs = 1_000;
  const maxLivenessDelayMs = 30_000;
  const challengeStore = new Map<string, LivenessChallenge>();

  const assertActorCanAccessMember = async (memberUserId: number, actor: AuthenticatedUser) => {
    if (actor.roles.includes("Administrator")) {
      return;
    }
    if (actor.roles.includes("Member") && actor.id === memberUserId) {
      return;
    }

    const rows = await database.query<RowDataPacket[]>(
      `SELECT id
       FROM coach_assignments
       WHERE member_user_id = ? AND coach_user_id = ? AND is_active = 1
       LIMIT 1`,
      [memberUserId, actor.id]
    );

    if (rows.length === 0) {
      throw new AppError(403, "forbidden", "You do not have access to this member's face records");
    }
  };

  const canActorAccessMember = async (memberUserId: number, actor: AuthenticatedUser) => {
    if (actor.roles.includes("Administrator")) {
      return true;
    }
    if (actor.roles.includes("Member") && actor.id === memberUserId) {
      return true;
    }

    const rows = await database.query<RowDataPacket[]>(
      `SELECT id
       FROM coach_assignments
       WHERE member_user_id = ? AND coach_user_id = ? AND is_active = 1
       LIMIT 1`,
      [memberUserId, actor.id]
    );

    return rows.length > 0;
  };

  const sanitizeDuplicateWarning = async (
    duplicate: { memberUserId: number; status: string; similarity: number } | null,
    actor: AuthenticatedUser
  ) => {
    if (!duplicate) {
      return null;
    }

    const canAccessMatchedMember = await canActorAccessMember(duplicate.memberUserId, actor);
    if (canAccessMatchedMember) {
      return duplicate;
    }

    return {
      redacted: true,
      similarity: Number(duplicate.similarity.toFixed(4))
    };
  };

  const ensureConsentGranted = async (memberUserId: number) => {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT consent_status
       FROM consent_records
       WHERE member_user_id = ? AND consent_type = 'face_enrollment'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [memberUserId]
    );

    if (!rows[0] || rows[0].consent_status !== "granted") {
      throw new AppError(400, "consent_required", "Face consent must be granted before enrollment");
    }
  };

  const appendAudit = async (
    memberUserId: number,
    actorUserId: number,
    eventType: string,
    details: Record<string, unknown>,
    faceRecordId?: number
  ) => {
    await database.execute(
      `INSERT INTO biometric_audit_log (member_user_id, face_record_id, event_type, details_json, actor_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [memberUserId, faceRecordId ?? null, eventType, JSON.stringify(details), actorUserId]
    );
  };

  const findDuplicateMatch = async (averageHash: string, memberUserId: number) => {
    const allVersions = await database.query<RowDataPacket[]>(
      `SELECT fr.member_user_id, fr.status, frv.average_hash, frv.average_hash_key_id
       FROM face_record_versions frv
       INNER JOIN face_records fr ON fr.id = frv.face_record_id`
    );

    return (await Promise.all(
      allVersions.map(async (row) => ({
        memberUserId: Number(row.member_user_id),
        status: String(row.status),
        similarity: hammingSimilarity(
          averageHash,
          await cryptoService.decrypt({
            keyId: String(row.average_hash_key_id ?? "legacy"),
            cipherText: String(row.average_hash)
          })
        )
      }))
    ))
      .filter((row) => row.similarity >= config.DEDUP_THRESHOLD && row.memberUserId !== memberUserId)
      .sort((left, right) => right.similarity - left.similarity)[0] ?? null;
  };

  const analyzeImage = async (
    dataUrl: string,
    filePrefix: string,
    options?: { persistArtifact?: boolean }
  ): Promise<TrustedFaceAnalysis> => {
    const { payload, extension } = decodeBase64Image(dataUrl);

    if (payload.byteLength > 5 * 1024 * 1024) {
      throw new AppError(400, "image_too_large", "Images must be 5 MB or smaller");
    }

    const image = await Jimp.read(payload);
    if (image.bitmap.width < 640 || image.bitmap.height < 480) {
      throw new AppError(400, "image_too_small", "Images must be at least 640x480");
    }

    const blurScore = computeBlurScore(image);
    const averageHash = image.hash();
    const trustedMetadata = deriveTrustedMetadata(image);

    if (options?.persistArtifact === false) {
      return {
        blurScore,
        averageHash,
        encryptedAverageHash: null,
        absolutePath: null,
        keyId: null,
        width: image.bitmap.width,
        height: image.bitmap.height,
        ...trustedMetadata
      };
    }

    const encryptedPayload = await cryptoService.encryptBytes(payload);
    const encryptedAverageHash = await cryptoService.encrypt(averageHash);
    const fileName = `${filePrefix}.${extension}.enc`;
    const absolutePath = join(uploadsDir, fileName);
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(absolutePath, JSON.stringify(encryptedPayload), "utf8");

    return {
      blurScore,
      averageHash,
      encryptedAverageHash,
      absolutePath,
      keyId: encryptedPayload.keyId,
      width: image.bitmap.width,
      height: image.bitmap.height,
      ...trustedMetadata
    };
  };

  const consumeChallenge = (challengeId: string, memberUserId: number, actorUserId: number) => {
    const challenge = challengeStore.get(challengeId);
    if (!challenge) {
      throw new AppError(400, "capture_timing_invalid", "A valid timed liveness challenge is required");
    }

    if (challenge.memberUserId !== memberUserId || challenge.actorUserId !== actorUserId) {
      challengeStore.delete(challengeId);
      throw new AppError(403, "capture_timing_invalid", "Timed liveness challenge does not match the active operator context");
    }

    const now = Date.now();
    const captureDelayMs = now - challenge.issuedAt;
    challengeStore.delete(challengeId);

    if (captureDelayMs < minLivenessDelayMs || captureDelayMs > maxLivenessDelayMs || now > challenge.expiresAt) {
      throw new AppError(
        400,
        "capture_timing_invalid",
        "The prompted head-turn capture must occur within the allowed timed challenge window"
      );
    }

    return {
      issuedAt: new Date(challenge.issuedAt).toISOString(),
      captureDelayMs
    };
  };

  return {
    async startLivenessChallenge(memberUserId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(memberUserId, actor);
      const challengeId = generateSessionToken();
      const issuedAt = Date.now();
      const expiresAt = issuedAt + maxLivenessDelayMs;
      challengeStore.set(challengeId, {
        challengeId,
        memberUserId,
        actorUserId: actor.id,
        issuedAt,
        expiresAt
      });

      return {
        challengeId,
        issuedAt: new Date(issuedAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        minDelayMs: minLivenessDelayMs,
        maxDelayMs: maxLivenessDelayMs
      };
    },

    async previewDedup(input: FaceDedupPreviewInput, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(input.memberUserId, actor);

      const center = await analyzeImage(
        input.centerImageBase64,
        `preview-member-${input.memberUserId}-${Date.now()}-center`,
        { persistArtifact: false }
      );
      await analyzeImage(
        input.turnImageBase64,
        `preview-member-${input.memberUserId}-${Date.now()}-turn`,
        { persistArtifact: false }
      );

      const duplicate = await findDuplicateMatch(center.averageHash, input.memberUserId);
      const duplicateWarning = await sanitizeDuplicateWarning(duplicate, actor);

      return {
        duplicateWarning,
        warningDetected: Boolean(duplicate)
      };
    },

    async enrollFace(input: FaceEnrollmentInput, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(input.memberUserId, actor);
      await ensureConsentGranted(input.memberUserId);

      const challengeWindow = consumeChallenge(input.challengeId, input.memberUserId, input.actorUserId);

      await appendAudit(input.memberUserId, input.actorUserId, "capture_attempted", {
        sourceType: input.sourceType,
        challengeIssuedAt: challengeWindow.issuedAt,
        captureDelayMs: challengeWindow.captureDelayMs
      });

      const timestamp = Date.now();
      const center = await analyzeImage(
        input.centerImageBase64,
        `member-${input.memberUserId}-${timestamp}-center`
      );
      const turn = await analyzeImage(
        input.turnImageBase64,
        `member-${input.memberUserId}-${timestamp}-turn`
      );

      if (center.blurScore < 12 || turn.blurScore < 12) {
        await appendAudit(input.memberUserId, input.actorUserId, "quality_failed", {
          centerBlurScore: center.blurScore,
          turnBlurScore: turn.blurScore
        });
        throw new AppError(400, "quality_failed", "Blur score is below the acceptance threshold");
      }

      const livenessScore = computeTrustedLivenessScore(
        center.landmarks,
        turn.landmarks,
        center.faceBox,
        turn.faceBox
      );
      if (livenessScore < 0.2) {
        await appendAudit(input.memberUserId, input.actorUserId, "liveness_failed", {
          livenessScore,
          centerLandmarks: center.landmarks,
          turnLandmarks: turn.landmarks
        });
        throw new AppError(400, "liveness_failed", "Liveness challenge did not pass");
      }

      const duplicate = await findDuplicateMatch(center.averageHash, input.memberUserId);
      const duplicateDetails = await sanitizeDuplicateWarning(duplicate, actor);

      if (duplicate) {
        await appendAudit(input.memberUserId, input.actorUserId, "duplicate_detected", {
          duplicateMatchedMemberUserId: duplicate.memberUserId,
          duplicateStatus: duplicate.status,
          similarity: duplicate.similarity
        });
        throw new AppError(409, "duplicate_detected", "A similar face record already exists", duplicateDetails ?? undefined);
      }

      const existingFaceRows = await database.query<RowDataPacket[]>(
        `SELECT id FROM face_records WHERE member_user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [input.memberUserId]
      );

      let faceRecordId: number;
      if (existingFaceRows.length === 0) {
        await database.execute(
          `INSERT INTO face_records (member_user_id, status) VALUES (?, 'active')`,
          [input.memberUserId]
        );
        const createdRows = await database.query<RowDataPacket[]>(
          `SELECT id FROM face_records WHERE member_user_id = ? ORDER BY created_at DESC LIMIT 1`,
          [input.memberUserId]
        );
        faceRecordId = Number(createdRows[0].id);
      } else {
        faceRecordId = Number(existingFaceRows[0].id);
        await database.execute(`UPDATE face_records SET status = 'active', deactivated_at = NULL WHERE id = ?`, [
          faceRecordId
        ]);
      }

      const versionRows = await database.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(version_number), 0) AS max_version
         FROM face_record_versions
         WHERE face_record_id = ?`,
        [faceRecordId]
      );
      const versionNumber = Number(versionRows[0].max_version) + 1;

      if (!center.encryptedAverageHash) {
        throw new AppError(500, "internal_error", "Encrypted biometric metadata was not produced");
      }

      await database.execute(
        `INSERT INTO face_record_versions
         (face_record_id, version_number, source_type, center_image_path, center_image_key_id,
          turn_image_path, turn_image_key_id, average_hash, average_hash_key_id, blur_score, face_in_frame,
          center_landmarks_json, turn_landmarks_json, liveness_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          faceRecordId,
          versionNumber,
          input.sourceType,
          center.absolutePath,
          center.keyId,
          turn.absolutePath,
          turn.keyId,
          center.encryptedAverageHash.cipherText,
          center.encryptedAverageHash.keyId,
          Number(((center.blurScore + turn.blurScore) / 2).toFixed(4)),
          1,
          JSON.stringify(center.landmarks),
          JSON.stringify(turn.landmarks),
          Number(livenessScore.toFixed(4))
        ]
      );

      await appendAudit(
        input.memberUserId,
        input.actorUserId,
        "enrollment_completed",
        {
          faceRecordId,
          versionNumber,
          livenessScore,
          blurScore: Number(((center.blurScore + turn.blurScore) / 2).toFixed(4)),
          serverDerivedFaceBox: {
            center: center.faceBox,
            turn: turn.faceBox
          }
        },
        faceRecordId
      );

      return {
        faceRecordId,
        versionNumber,
        blurScore: Number(((center.blurScore + turn.blurScore) / 2).toFixed(4)),
        livenessScore: Number(livenessScore.toFixed(4)),
        duplicateWarning: duplicate ?? null
      };
    },

    async deactivateFace(faceRecordId: number, actorUserId: number, actor: AuthenticatedUser) {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT member_user_id FROM face_records WHERE id = ? LIMIT 1`,
        [faceRecordId]
      );

      if (!rows[0]) {
        throw new AppError(404, "face_record_not_found", "Face record was not found");
      }

      await assertActorCanAccessMember(Number(rows[0].member_user_id), actor);

      await database.execute(
        `UPDATE face_records SET status = 'deactivated', deactivated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [faceRecordId]
      );
      await appendAudit(
        Number(rows[0].member_user_id),
        actorUserId,
        "face_record_deactivated",
        { faceRecordId },
        faceRecordId
      );
    },

    async getFaceHistory(memberUserId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(memberUserId, actor);
      const rows = await database.query<RowDataPacket[]>(
        `SELECT fr.id AS face_record_id, fr.status, fr.deactivated_at,
                frv.version_number, frv.blur_score, frv.liveness_score, frv.created_at
         FROM face_records fr
         LEFT JOIN face_record_versions frv ON frv.face_record_id = fr.id
         WHERE fr.member_user_id = ?
         ORDER BY frv.version_number DESC`,
        [memberUserId]
      );

      return rows.map((row) => ({
        faceRecordId: Number(row.face_record_id),
        status: String(row.status),
        deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at).toISOString() : null,
        versionNumber: row.version_number ? Number(row.version_number) : null,
        blurScore: row.blur_score ? Number(row.blur_score) : null,
        livenessScore: row.liveness_score ? Number(row.liveness_score) : null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
      }));
    },

    async getAuditTrail(memberUserId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(memberUserId, actor);
      const rows = await database.query<RowDataPacket[]>(
        `SELECT bal.event_type, bal.details_json, bal.created_at, u.full_name AS actor_name
         FROM biometric_audit_log bal
         INNER JOIN users u ON u.id = bal.actor_user_id
         WHERE bal.member_user_id = ?
         ORDER BY bal.created_at DESC
         LIMIT 25`,
        [memberUserId]
      );

      return rows.map((row) => ({
        eventType: String(row.event_type),
        actorName: String(row.actor_name),
        details: typeof row.details_json === "string" ? JSON.parse(row.details_json) : row.details_json,
        createdAt: new Date(row.created_at).toISOString()
      }));
    },

    async hardenStoredArtifacts() {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT id, center_image_path, center_image_key_id, turn_image_path, turn_image_key_id,
                average_hash, average_hash_key_id
         FROM face_record_versions
         WHERE center_image_key_id = 'legacy'
            OR turn_image_key_id = 'legacy'
            OR average_hash_key_id = 'legacy'
            OR center_image_key_id IS NULL
            OR turn_image_key_id IS NULL
            OR average_hash_key_id IS NULL`
      );

      for (const row of rows) {
        let centerKeyId = String(row.center_image_key_id ?? "legacy");
        let turnKeyId = String(row.turn_image_key_id ?? "legacy");
        let averageHashKeyId = String(row.average_hash_key_id ?? "legacy");
        let averageHashCipherText = String(row.average_hash);

        if (centerKeyId === "legacy") {
          const encrypted = await cryptoService.encryptBytes(await readFile(String(row.center_image_path)));
          await writeFile(String(row.center_image_path), JSON.stringify(encrypted), "utf8");
          centerKeyId = encrypted.keyId;
        }

        if (turnKeyId === "legacy") {
          const encrypted = await cryptoService.encryptBytes(await readFile(String(row.turn_image_path)));
          await writeFile(String(row.turn_image_path), JSON.stringify(encrypted), "utf8");
          turnKeyId = encrypted.keyId;
        }

        if (averageHashKeyId === "legacy") {
          const encrypted = await cryptoService.encrypt(String(row.average_hash));
          averageHashCipherText = encrypted.cipherText;
          averageHashKeyId = encrypted.keyId;
        }

        await database.execute(
          `UPDATE face_record_versions
           SET center_image_key_id = ?, turn_image_key_id = ?, average_hash = ?, average_hash_key_id = ?
           WHERE id = ?`,
          [centerKeyId, turnKeyId, averageHashCipherText, averageHashKeyId, Number(row.id)]
        );
      }
    }
  };
};
