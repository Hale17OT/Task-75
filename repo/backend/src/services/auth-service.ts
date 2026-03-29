import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "../config.js";
import type { Database } from "../database.js";
import { AppError } from "../errors.js";
import type { AuthenticatedUser, Role, SessionRecord } from "../types.js";
import type { ReturnTypeOfCreateCryptoService } from "./service-utility-types.js";
import {
  assertPasswordComplexity,
  assertPinComplexity,
  generateSessionSecret,
  generateSessionToken,
  generateWorkstationBindingToken
} from "../security.js";

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  full_name: string;
  password_hash: string;
  active: number;
}

interface SessionPayload {
  sessionToken: string;
  sessionSecret: string;
  workstationBindingToken: string;
}

type SqlExecutor = {
  execute(sql: string, params?: any): Promise<unknown>;
};

type RestoreSessionResult =
  | {
      status: "warm_locked";
      currentUser: AuthenticatedUser;
      hasPin: true;
      warmLockMinutes: number;
      sessionTimeoutMinutes: number;
      lastActivityAt: string;
    }
  | null;

export const expandRoles = (roles: Role[]): Role[] => {
  const roleSet = new Set<Role>(roles);

  if (roleSet.has("Administrator")) {
    roleSet.add("Coach");
    roleSet.add("Member");
  }

  if (roleSet.has("Coach")) {
    roleSet.add("Member");
  }

  return Array.from(roleSet);
};

export const createAuthService = (
  database: Database,
  config: AppConfig,
  cryptoService: ReturnTypeOfCreateCryptoService
) => {
  const claimBootstrapGuard = async (executor: SqlExecutor) => {
    try {
      await executor.execute(
        `INSERT INTO bootstrap_guard (id, initialized_at)
         VALUES (1, UTC_TIMESTAMP())`,
        []
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("duplicate")) {
        throw new AppError(409, "bootstrap_unavailable", "The first administrator has already been created");
      }
      throw error;
    }
  };

  const hasAdministratorAccount = async () => {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM user_roles
       WHERE role_name = 'Administrator'`
    );

    return Number(rows[0]?.total ?? 0) > 0;
  };

  const loadUserRoles = async (userId: number): Promise<Role[]> => {
    const rows = await database.query<RowDataPacket[]>(
      "SELECT role_name FROM user_roles WHERE user_id = ?",
      [userId]
    );

    return expandRoles(rows.map((row) => row.role_name as Role));
  };

  const toAuthenticatedUser = async (user: UserRow): Promise<AuthenticatedUser> => ({
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    roles: await loadUserRoles(user.id)
  });

  const assertNotLocked = async (username: string) => {
    const rows = await database.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS failures
       FROM failed_login_attempts
       WHERE username = ?
         AND was_successful = 0
         AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
      [username, config.ACCOUNT_LOCK_MINUTES]
    );

    if (Number(rows[0].failures) >= config.ACCOUNT_LOCK_MAX_ATTEMPTS) {
      throw new AppError(
        423,
        "account_locked",
        `Account locked for ${config.ACCOUNT_LOCK_MINUTES} minutes after repeated failures`
      );
    }
  };

  const recordAttempt = async (username: string, ipAddress: string, wasSuccessful: boolean) => {
    await database.execute(
      `INSERT INTO failed_login_attempts (username, ip_address, was_successful) VALUES (?, ?, ?)`,
      [username, ipAddress, wasSuccessful ? 1 : 0]
    );
  };

  const revokeSession = async (sessionToken: string) => {
    await database.execute(
      "UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE session_token = ? AND revoked_at IS NULL",
      [cryptoService.hashForComparison(sessionToken)]
    );
  };

  const createSession = async (
    userId: number,
    stationToken: string,
    workstationBindingToken = generateWorkstationBindingToken(),
    executor: SqlExecutor = database as unknown as SqlExecutor
  ): Promise<SessionPayload> => {
    const sessionToken = generateSessionToken();
    const sessionSecret = generateSessionSecret();
    const encryptedSecret = await cryptoService.encrypt(sessionSecret);

    await executor.execute(
      `INSERT INTO sessions
       (user_id, session_token, session_secret, session_secret_key_id, station_token, workstation_binding_hash, warm_locked_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP())`,
      [
        userId,
        cryptoService.hashForComparison(sessionToken),
        encryptedSecret.cipherText,
        encryptedSecret.keyId,
        stationToken,
        cryptoService.hashForComparison(workstationBindingToken)
      ]
    );

    return {
      sessionToken,
      sessionSecret,
      workstationBindingToken
    };
  };

  const loadSession = async (sessionToken: string): Promise<SessionRecord | null> => {
    const sessionTokenHash = cryptoService.hashForComparison(sessionToken);
    const rows = await database.query<RowDataPacket[]>(
      `SELECT id, user_id, session_token, session_secret, session_secret_key_id, station_token, workstation_binding_hash, warm_locked_at, last_activity_at, created_at, revoked_at
       FROM sessions
       WHERE session_token = ?
       LIMIT 1`,
      [sessionTokenHash]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      sessionToken,
      sessionSecret: await cryptoService.decrypt({
        keyId: String(row.session_secret_key_id),
        cipherText: String(row.session_secret)
      }),
      sessionSecretKeyId: String(row.session_secret_key_id),
      stationToken: String(row.station_token),
      workstationBindingHash: row.workstation_binding_hash ? String(row.workstation_binding_hash) : null,
      warmLockedAt: row.warm_locked_at ? new Date(row.warm_locked_at) : null,
      lastActivityAt: new Date(row.last_activity_at),
      createdAt: new Date(row.created_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null
    };
  };

  const verifyWorkstationBinding = (session: SessionRecord, workstationBindingToken: string | undefined) => {
    if (!workstationBindingToken || !session.workstationBindingHash) {
      throw new AppError(401, "workstation_binding_required", "A trusted workstation binding is required");
    }

    if (cryptoService.hashForComparison(workstationBindingToken) !== session.workstationBindingHash) {
      throw new AppError(403, "pin_context_invalid", "PIN re-entry is only allowed on the bound workstation");
    }
  };

  const assertSessionActive = async (sessionToken: string) => {
    const session = await loadSession(sessionToken);

    if (!session || session.revokedAt) {
      throw new AppError(401, "invalid_session", "Session is not active");
    }

    const inactiveForMs = Date.now() - session.lastActivityAt.getTime();
    if (inactiveForMs > config.SESSION_TIMEOUT_MINUTES * 60 * 1000) {
      await revokeSession(sessionToken);
      throw new AppError(401, "session_expired", "Session expired after inactivity");
    }

    return session;
  };

  const touchSession = async (sessionToken: string) => {
    await database.execute(
      "UPDATE sessions SET last_activity_at = UTC_TIMESTAMP() WHERE session_token = ?",
      [cryptoService.hashForComparison(sessionToken)]
    );
  };

  const warmLockSession = async (sessionToken: string) => {
    await assertSessionActive(sessionToken);
    await database.execute(
      "UPDATE sessions SET warm_locked_at = UTC_TIMESTAMP() WHERE session_token = ? AND revoked_at IS NULL",
      [cryptoService.hashForComparison(sessionToken)]
    );
  };

  return {
    async getBootstrapStatus() {
      return {
        requiresBootstrap: !(await hasAdministratorAccount())
      };
    },

    async bootstrapAdministrator(
      username: string,
      fullName: string,
      password: string,
      stationToken: string
    ) {
      assertPasswordComplexity(password);
      const connection: PoolConnection = await database.pool.getConnection();
      let createdUser: UserRow | null = null;
      let session: SessionPayload | null = null;
      try {
        await connection.beginTransaction();
        await claimBootstrapGuard(connection);

        const existing = await connection.query<RowDataPacket[]>(
          "SELECT id FROM users WHERE username = ? LIMIT 1",
          [username]
        );
        const existingRows = existing[0];

        if (existingRows.length > 0) {
          throw new AppError(409, "user_exists", "A user with that username already exists");
        }

        const adminCountResult = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total
           FROM user_roles
           WHERE role_name = 'Administrator'`
        );
        const adminCountRows = adminCountResult[0];
        if (Number(adminCountRows[0]?.total ?? 0) > 0) {
          throw new AppError(409, "bootstrap_unavailable", "The first administrator has already been created");
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await connection.execute(
          `INSERT INTO users (username, full_name, password_hash)
           VALUES (?, ?, ?)`,
          [username, fullName, passwordHash]
        );

        const userRowsResult = await connection.query<UserRow[]>(
          "SELECT id, username, full_name, password_hash, active FROM users WHERE username = ? LIMIT 1",
          [username]
        );
        const userRows = userRowsResult[0];
        createdUser = userRows[0];

        await connection.execute(
          `INSERT INTO user_roles (user_id, role_name) VALUES (?, 'Administrator')`,
          [createdUser.id]
        );

        session = await createSession(createdUser.id, stationToken, generateWorkstationBindingToken(), connection);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      if (!createdUser || !session) {
        throw new AppError(500, "bootstrap_failed", "Unable to complete first administrator setup");
      }

      return {
        currentUser: await toAuthenticatedUser(createdUser),
        session,
        workstationBindingToken: session.workstationBindingToken,
        sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES,
        warmLockMinutes: config.WARM_LOCK_MINUTES,
        hasPin: false
      };
    },

    async login(username: string, password: string, ipAddress: string, stationToken: string) {
      assertPasswordComplexity(password);
      await assertNotLocked(username);

      const rows = await database.query<UserRow[]>(
        "SELECT id, username, full_name, password_hash, active FROM users WHERE username = ? LIMIT 1",
        [username]
      );

      const user = rows[0];
      if (!user || !user.active) {
        await recordAttempt(username, ipAddress, false);
        throw new AppError(401, "invalid_credentials", "Invalid credentials");
      }

      const matches = await bcrypt.compare(password, user.password_hash);
      if (!matches) {
        await recordAttempt(username, ipAddress, false);
        throw new AppError(401, "invalid_credentials", "Invalid credentials");
      }

      await recordAttempt(username, ipAddress, true);
      const session = await createSession(user.id, stationToken);
      const currentUser = await toAuthenticatedUser(user);
      const pinRows = await database.query<RowDataPacket[]>(
        "SELECT user_id FROM pin_credentials WHERE user_id = ? LIMIT 1",
        [user.id]
      );

      return {
        currentUser,
        session,
        workstationBindingToken: session.workstationBindingToken,
        sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES,
        warmLockMinutes: config.WARM_LOCK_MINUTES,
        hasPin: pinRows.length > 0
      };
    },

    async setupPin(userId: number, pin: string) {
      assertPinComplexity(pin);
      const pinHash = await bcrypt.hash(pin, 10);

      await database.execute(
        `INSERT INTO pin_credentials (user_id, pin_hash)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE pin_hash = VALUES(pin_hash), updated_at = CURRENT_TIMESTAMP()`,
        [userId, pinHash]
      );
    },

    async reenterWithPin(
      username: string,
      pin: string,
      sessionToken: string | undefined,
      stationToken: string,
      workstationBindingToken: string | undefined,
      ipAddress: string
    ) {
      assertPinComplexity(pin);
      await assertNotLocked(username);
      if (!sessionToken) {
        throw new AppError(401, "missing_session", "A warm workstation session is required for PIN re-entry");
      }
      const users = await database.query<UserRow[]>(
        "SELECT id, username, full_name, password_hash, active FROM users WHERE username = ? LIMIT 1",
        [username]
      );
      const user = users[0];

      if (!user || !user.active) {
        await recordAttempt(username, ipAddress, false);
        throw new AppError(401, "invalid_pin_login", "Active session with PIN is not available");
      }

      const pinRows = await database.query<RowDataPacket[]>(
        "SELECT pin_hash FROM pin_credentials WHERE user_id = ? LIMIT 1",
        [user.id]
      );

      if (pinRows.length === 0 || !(await bcrypt.compare(pin, String(pinRows[0].pin_hash)))) {
        await recordAttempt(username, ipAddress, false);
        throw new AppError(401, "invalid_pin_login", "Active session with PIN is not available");
      }

      const activeSession = await assertSessionActive(sessionToken);

      if (activeSession.userId !== user.id) {
        await recordAttempt(username, ipAddress, false);
        throw new AppError(403, "pin_context_invalid", "PIN re-entry is only allowed for the active workstation user");
      }

      if (activeSession.stationToken !== stationToken) {
        await recordAttempt(username, ipAddress, false);
        throw new AppError(403, "pin_context_invalid", "PIN re-entry is only allowed on the same workstation");
      }

      try {
        verifyWorkstationBinding(activeSession, workstationBindingToken);
      } catch (error) {
        await recordAttempt(username, ipAddress, false);
        throw error;
      }

      await recordAttempt(username, ipAddress, true);
      await revokeSession(activeSession.sessionToken);
      const session = await createSession(user.id, stationToken, workstationBindingToken);

      return {
        currentUser: await toAuthenticatedUser(user),
        session,
        workstationBindingToken: session.workstationBindingToken,
        sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES,
        warmLockMinutes: config.WARM_LOCK_MINUTES,
        hasPin: true
      };
    },

    async restoreSession(sessionToken: string | undefined, workstationBindingToken: string | undefined): Promise<RestoreSessionResult> {
      if (!sessionToken) {
        return null;
      }

      const session = await assertSessionActive(sessionToken);
      verifyWorkstationBinding(session, workstationBindingToken);
      const rows = await database.query<UserRow[]>(
        "SELECT id, username, full_name, password_hash, active FROM users WHERE id = ? LIMIT 1",
        [session.userId]
      );
      const user = rows[0];

      if (!user || !user.active) {
        throw new AppError(401, "invalid_session", "Session is not active");
      }

      const pinRows = await database.query<RowDataPacket[]>(
        "SELECT user_id FROM pin_credentials WHERE user_id = ? LIMIT 1",
        [user.id]
      );
      const hasPin = pinRows.length > 0;

      if (!hasPin) {
        return null;
      }

      if (!session.warmLockedAt) {
        await database.execute(
          "UPDATE sessions SET warm_locked_at = UTC_TIMESTAMP() WHERE session_token = ? AND revoked_at IS NULL",
          [cryptoService.hashForComparison(sessionToken)]
        );
      }

      if (hasPin) {
        return {
          status: "warm_locked",
          currentUser: await toAuthenticatedUser(user),
          hasPin: true,
          warmLockMinutes: config.WARM_LOCK_MINUTES,
          sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES,
          lastActivityAt: session.lastActivityAt.toISOString()
        };
      }
      return null;
    },

    async assertWorkstationBinding(sessionToken: string, workstationBindingToken: string | undefined) {
      const session = await assertSessionActive(sessionToken);
      verifyWorkstationBinding(session, workstationBindingToken);
    },

    async logout(sessionToken: string) {
      await revokeSession(sessionToken);
    },

    async getSession(sessionToken: string | undefined) {
      if (!sessionToken) {
        return null;
      }

      const session = await assertSessionActive(sessionToken);
      const rows = await database.query<UserRow[]>(
        "SELECT id, username, full_name, password_hash, active FROM users WHERE id = ? LIMIT 1",
        [session.userId]
      );
      const user = rows[0];

      if (!user || !user.active) {
        throw new AppError(401, "invalid_session", "Session is not active");
      }

      const pinRows = await database.query<RowDataPacket[]>(
        "SELECT user_id FROM pin_credentials WHERE user_id = ? LIMIT 1",
        [user.id]
      );

      return {
        currentUser: await toAuthenticatedUser(user),
        session,
        hasPin: pinRows.length > 0,
        warmLockMinutes: config.WARM_LOCK_MINUTES,
        sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES
      };
    },

    async hardenStoredSessions() {
      const rows = await database.query<RowDataPacket[]>(
        `SELECT id, session_token, session_secret, session_secret_key_id
         FROM sessions
         WHERE session_secret_key_id = 'legacy' OR session_secret_key_id IS NULL`
      );

      for (const row of rows) {
        const rawToken = String(row.session_token);
        const rawSecret = String(row.session_secret);
        const encryptedSecret = await cryptoService.encrypt(rawSecret);
        await database.execute(
          `UPDATE sessions
           SET session_token = ?, session_secret = ?, session_secret_key_id = ?
           WHERE id = ?`,
          [
            cryptoService.hashForComparison(rawToken),
            encryptedSecret.cipherText,
            encryptedSecret.keyId,
            Number(row.id)
          ]
        );
      }
    },

    warmLockSession,
    assertSessionActive,
    touchSession
  };
};
