import bcrypt from "bcryptjs";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Database } from "../database.js";
import { AppError } from "../errors.js";
import { assertPasswordComplexity } from "../security.js";
import type { AuthenticatedUser } from "../types.js";
import type { ReturnTypeOfCreateCryptoService } from "./service-utility-types.js";

interface CreateMemberInput {
  username: string;
  fullName: string;
  password: string;
  phone: string | null;
  locationCode: string;
  notes?: string | null;
  coachUserId?: number | null;
}

export const createMemberService = (
  database: Database,
  cryptoService: ReturnTypeOfCreateCryptoService
) => {
  const isAdministrator = (actor: AuthenticatedUser) => actor.roles.includes("Administrator");
  const isCoach = (actor: AuthenticatedUser) => actor.roles.includes("Coach");

  const writeSystemLogInTransaction = async (
    connection: PoolConnection,
    message: string,
    details: Record<string, unknown>
  ) => {
    await connection.execute(
      `INSERT INTO application_logs (category, level, message, details_json)
       VALUES ('member_admin', 'info', ?, ?)`,
      [message, JSON.stringify(details)]
    );
  };

  const ensureCoach = async (coachUserId: number) => {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT u.id
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = ? AND ur.role_name IN ('Coach', 'Administrator')
       LIMIT 1`,
      [coachUserId]
    );

    if (rows.length === 0) {
      throw new AppError(404, "coach_not_found", "Coach was not found");
    }
  };

  const getCoachAssignedLocations = async (coachUserId: number) => {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT location_code
       FROM coach_location_assignments
       WHERE coach_user_id = ? AND is_active = 1`,
      [coachUserId]
    );
    return rows.map((row) => String(row.location_code));
  };

  const assertCoachCanOperateInLocation = async (coachUserId: number, locationCode: string) => {
    const locations = await getCoachAssignedLocations(coachUserId);
    if (!locations.includes(locationCode)) {
      throw new AppError(403, "forbidden", "Coach is not assigned to this location");
    }
  };

  const getActorAllowedLocations = async (actor: AuthenticatedUser) => {
    if (isAdministrator(actor)) {
      return null;
    }

    if (isCoach(actor)) {
      return getCoachAssignedLocations(actor.id);
    }
    const ownRows = await database.query<RowDataPacket[]>(
      `SELECT location_code FROM member_profiles WHERE user_id = ?`,
      [actor.id]
    );
    return ownRows.map((row) => String(row.location_code));
  };

  const assertActorCanCreateInLocation = async (locationCode: string, actor: AuthenticatedUser) => {
    if (isAdministrator(actor)) {
      return;
    }
    if (!isCoach(actor)) {
      throw new AppError(403, "forbidden", "Only coaches and administrators can create members");
    }

    const allowedLocations = await getActorAllowedLocations(actor);
    if (!allowedLocations || !allowedLocations.includes(locationCode)) {
      throw new AppError(403, "forbidden", "You do not have permission to create members in this location");
    }
  };

  const loadMember = async (userId: number) => {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.phone_encrypted, u.phone_key_id, u.phone_last4, u.active,
              mp.location_code, mp.notes,
              coach_assignments.coach_user_id
       FROM users u
       INNER JOIN member_profiles mp ON mp.user_id = u.id
       LEFT JOIN coach_assignments
         ON coach_assignments.member_user_id = u.id AND coach_assignments.is_active = 1
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      throw new AppError(404, "member_not_found", "Member was not found");
    }

    const row = rows[0];
    let phone: string | null = null;
    if (row.phone_encrypted && row.phone_key_id) {
      phone = await cryptoService.decrypt({
        keyId: String(row.phone_key_id),
        cipherText: String(row.phone_encrypted)
      });
    }

    const consentRows = await database.query<RowDataPacket[]>(
      `SELECT consent_status
       FROM consent_records
       WHERE member_user_id = ? AND consent_type = 'face_enrollment'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [userId]
    );

    return {
      id: Number(row.id),
      username: String(row.username),
      fullName: String(row.full_name),
      phoneMasked: cryptoService.maskPhone(phone),
      phoneLast4: row.phone_last4 ? String(row.phone_last4) : null,
      locationCode: String(row.location_code),
      notes: row.notes ? String(row.notes) : null,
      active: Boolean(row.active),
      coachUserId: row.coach_user_id ? Number(row.coach_user_id) : null,
      faceConsentStatus: consentRows[0] ? String(consentRows[0].consent_status) : "unknown"
    };
  };

  const assertActorCanAccessMember = async (memberUserId: number, actor: AuthenticatedUser) => {
    if (isAdministrator(actor) || actor.id === memberUserId) {
      return;
    }

    if (!isCoach(actor)) {
      throw new AppError(403, "forbidden", "You do not have access to this member");
    }

    const rows = await database.query<RowDataPacket[]>(
      `SELECT id
       FROM coach_assignments
       WHERE member_user_id = ? AND coach_user_id = ? AND is_active = 1
       LIMIT 1`,
      [memberUserId, actor.id]
    );

    if (rows.length === 0) {
      throw new AppError(403, "forbidden", "You do not have access to this member");
    }
  };

  return {
    async createMember(input: CreateMemberInput, actor: AuthenticatedUser) {
      assertPasswordComplexity(input.password);
      await assertActorCanCreateInLocation(input.locationCode, actor);

      if (!isAdministrator(actor) && input.coachUserId && input.coachUserId !== actor.id) {
        throw new AppError(403, "forbidden", "Coaches can only create members assigned to themselves");
      }

      const resolvedCoachUserId = input.coachUserId ?? (isCoach(actor) && !isAdministrator(actor) ? actor.id : null);
      if (resolvedCoachUserId) {
        await ensureCoach(resolvedCoachUserId);
        await assertCoachCanOperateInLocation(resolvedCoachUserId, input.locationCode);
      }

      const existing = await database.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        [input.username]
      );
      if (existing.length > 0) {
        throw new AppError(409, "member_exists", "A user with that username already exists");
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      let phoneEncrypted: string | null = null;
      let phoneKeyId: string | null = null;
      let phoneLast4: string | null = null;

      if (input.phone) {
        const encrypted = await cryptoService.encrypt(input.phone);
        phoneEncrypted = encrypted.cipherText;
        phoneKeyId = encrypted.keyId;
        phoneLast4 = input.phone.replace(/\D/g, "").slice(-4);
      }

      const userId = await database.executeInTransaction(async (connection) => {
        const [insertUserResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO users (username, full_name, password_hash, phone_encrypted, phone_key_id, phone_last4)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [input.username, input.fullName, passwordHash, phoneEncrypted, phoneKeyId, phoneLast4]
        );
        const createdUserId = Number(insertUserResult.insertId);

        await connection.execute(`INSERT INTO user_roles (user_id, role_name) VALUES (?, 'Member')`, [createdUserId]);
        await connection.execute(
          `INSERT INTO member_profiles (user_id, location_code, notes) VALUES (?, ?, ?)`,
          [createdUserId, input.locationCode, input.notes ?? null]
        );

        if (resolvedCoachUserId) {
          await connection.execute(
            `INSERT INTO coach_assignments (member_user_id, coach_user_id, is_active) VALUES (?, ?, 1)`,
            [createdUserId, resolvedCoachUserId]
          );
        }

        await writeSystemLogInTransaction(connection, "Member created", {
          actorUserId: actor.id,
          memberUserId: createdUserId,
          locationCode: input.locationCode,
          assignedCoachUserId: resolvedCoachUserId
        });

        return createdUserId;
      });

      return loadMember(userId);
    },

    async assignCoach(memberUserId: number, coachUserId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(memberUserId, actor);
      if (!isAdministrator(actor) && coachUserId !== actor.id) {
        throw new AppError(403, "forbidden", "Coaches can only assign members to themselves");
      }

      const member = await loadMember(memberUserId);
      await ensureCoach(coachUserId);
      await assertCoachCanOperateInLocation(coachUserId, member.locationCode);

      await database.executeInTransaction(async (connection) => {
        await connection.execute(
          `UPDATE coach_assignments SET is_active = 0 WHERE member_user_id = ?`,
          [memberUserId]
        );
        await connection.execute(
          `INSERT INTO coach_assignments (member_user_id, coach_user_id, is_active) VALUES (?, ?, 1)`,
          [memberUserId, coachUserId]
        );
        await writeSystemLogInTransaction(connection, "Member coach assignment updated", {
          actorUserId: actor.id,
          memberUserId,
          coachUserId
        });
      });

      return loadMember(memberUserId);
    },

    async recordFaceConsent(
      memberUserId: number,
      actorUserId: number,
      consentStatus: "granted" | "declined",
      actor: AuthenticatedUser
    ) {
      await assertActorCanAccessMember(memberUserId, actor);
      await loadMember(memberUserId);

      await database.executeInTransaction(async (connection) => {
        await connection.execute(
          `INSERT INTO consent_records (member_user_id, consent_type, consent_status, recorded_by_user_id)
           VALUES (?, 'face_enrollment', ?, ?)`,
          [memberUserId, consentStatus, actorUserId]
        );
        await writeSystemLogInTransaction(connection, "Member face consent updated", {
          actorUserId,
          memberUserId,
          consentStatus
        });
      });

      return loadMember(memberUserId);
    },

    async listMembers(actor: AuthenticatedUser) {
      let rows: RowDataPacket[];
      if (isAdministrator(actor)) {
        rows = await database.query<RowDataPacket[]>(
          `SELECT user_id FROM member_profiles ORDER BY created_at DESC`
        );
      } else if (isCoach(actor)) {
        rows = await database.query<RowDataPacket[]>(
          `SELECT mp.user_id
           FROM member_profiles mp
           INNER JOIN coach_assignments ca ON ca.member_user_id = mp.user_id AND ca.is_active = 1
           WHERE ca.coach_user_id = ?
           ORDER BY mp.created_at DESC`,
          [actor.id]
        );
      } else {
        rows = await database.query<RowDataPacket[]>(
          `SELECT user_id FROM member_profiles WHERE user_id = ? LIMIT 1`,
          [actor.id]
        );
      }

      return Promise.all(rows.map((row) => loadMember(Number(row.user_id))));
    },

    async listCoaches() {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT DISTINCT u.id, u.username, u.full_name
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role_name IN ('Coach', 'Administrator')
         ORDER BY u.full_name ASC`
      );

      return rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        fullName: String(row.full_name)
      }));
    },

    async assignCoachLocation(
      coachUserId: number,
      locationCode: string,
      actor: AuthenticatedUser
    ) {
      if (!isAdministrator(actor)) {
        throw new AppError(403, "forbidden", "Only administrators can manage coach locations");
      }
      await ensureCoach(coachUserId);
      await database.executeInTransaction(async (connection) => {
        await connection.execute(
          `INSERT INTO coach_location_assignments (coach_user_id, location_code, is_active)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE is_active = 1, assigned_at = CURRENT_TIMESTAMP`,
          [coachUserId, locationCode]
        );
        await writeSystemLogInTransaction(connection, "Coach location assigned", {
          actorUserId: actor.id,
          coachUserId,
          locationCode
        });
      });

      return {
        coachUserId,
        locationCode,
        isActive: true
      };
    },

    async listCoachLocations(coachUserId: number, actor: AuthenticatedUser) {
      if (!isAdministrator(actor) && actor.id !== coachUserId) {
        throw new AppError(403, "forbidden", "You do not have access to coach location assignments");
      }
      const rows = await database.query<RowDataPacket[]>(
        `SELECT coach_user_id, location_code, is_active, assigned_at
         FROM coach_location_assignments
         WHERE coach_user_id = ?
         ORDER BY assigned_at DESC`,
        [coachUserId]
      );
      return rows.map((row) => ({
        coachUserId: Number(row.coach_user_id),
        locationCode: String(row.location_code),
        isActive: Boolean(row.is_active),
        assignedAt: new Date(row.assigned_at).toISOString()
      }));
    },

    async getMember(userId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(userId, actor);
      return loadMember(userId);
    },

    async assertActorCanAccessMember(memberUserId: number, actor: AuthenticatedUser) {
      await assertActorCanAccessMember(memberUserId, actor);
    },

    async listRecipients(_actor: AuthenticatedUser) {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT u.id, u.full_name, u.username,
                GROUP_CONCAT(ur.role_name ORDER BY ur.role_name SEPARATOR ',') AS roles
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         WHERE u.active = 1
         GROUP BY u.id, u.full_name, u.username
         ORDER BY u.full_name ASC`
      );

      return rows.map((row) => ({
        id: Number(row.id),
        fullName: String(row.full_name),
        username: String(row.username),
        roles: String(row.roles).split(",")
      }));
    }
  };
};
