import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { AuthenticatedUser } from "../types.js";
import type { ReturnTypeOfCreateCryptoService } from "./service-utility-types.js";
import { generateSessionToken } from "../security.js";
import { createFaceImageAnalyzer } from "./face/analysis.js";
import { hammingSimilarity } from "./face/dedup.js";
import { computeTrustedLivenessScore } from "./face/liveness.js";
import type {
  FaceDedupPreviewInput,
  FaceEnrollmentInput
} from "./face/types.js";

export const createFaceService = (
  database: Database,
  config: AppConfig,
  cryptoService: ReturnTypeOfCreateCryptoService
) => {
  const uploadsDir = join(config.DATA_DIR, "uploads");
  const minLivenessDelayMs = 1_000;
  const maxLivenessDelayMs = 30_000;
  const analyzeImage = createFaceImageAnalyzer(cryptoService, uploadsDir);

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

  const clearExpiredChallenges = async () => {
    await database.execute(
      `DELETE FROM liveness_challenges
       WHERE expires_at < UTC_TIMESTAMP()`
    );
  };

  const consumeChallenge = async (challengeId: string, memberUserId: number, actorUserId: number) => {
    await clearExpiredChallenges();
    const rows = await database.query<RowDataPacket[]>(
      `SELECT challenge_id, member_user_id, actor_user_id, issued_at, expires_at
       FROM liveness_challenges
       WHERE challenge_id = ?
       LIMIT 1`,
      [challengeId]
    );
    const challenge = rows[0];
    if (!challenge) {
      throw new AppError(400, "capture_timing_invalid", "A valid timed liveness challenge is required");
    }

    await database.execute(`DELETE FROM liveness_challenges WHERE challenge_id = ?`, [challengeId]);

    if (Number(challenge.member_user_id) !== memberUserId || Number(challenge.actor_user_id) !== actorUserId) {
      throw new AppError(403, "capture_timing_invalid", "Timed liveness challenge does not match the active operator context");
    }

    const now = Date.now();
    const issuedAtMs = new Date(challenge.issued_at).getTime();
    const expiresAtMs = new Date(challenge.expires_at).getTime();
    const captureDelayMs = now - issuedAtMs;

    if (captureDelayMs < minLivenessDelayMs || captureDelayMs > maxLivenessDelayMs || now > expiresAtMs) {
      throw new AppError(
        400,
        "capture_timing_invalid",
        "The prompted head-turn capture must occur within the allowed timed challenge window"
      );
    }

    return {
      issuedAt: new Date(issuedAtMs).toISOString(),
      captureDelayMs
    };
  };

  return {
    async startLivenessChallenge(memberUserId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(memberUserId, actor);
      await clearExpiredChallenges();
      const challengeId = generateSessionToken();
      const issuedAt = Date.now();
      const expiresAt = issuedAt + maxLivenessDelayMs;
      await database.execute(
        `INSERT INTO liveness_challenges (challenge_id, member_user_id, actor_user_id, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [challengeId, memberUserId, actor.id, new Date(issuedAt), new Date(expiresAt)]
      );

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

      const challengeWindow = await consumeChallenge(input.challengeId, input.memberUserId, input.actorUserId);

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
