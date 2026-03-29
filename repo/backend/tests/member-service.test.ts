import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import type { Database } from "../src/database.js";
import { createMemberService } from "../src/services/member-service.js";
import type { AuthenticatedUser } from "../src/types.js";

const createMockDatabase = () => {
  const query = vi.fn();
  const execute = vi.fn();
  const executeInTransaction = vi.fn(async (callback: (connection: any) => Promise<unknown>) => {
    const connection = {
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        const lower = sql.toLowerCase();
        if (lower.includes("insert into users")) {
          return [{ insertId: 10 }, undefined];
        }
        return [undefined, undefined];
      }),
      query: vi.fn(async (_sql: string, _params?: unknown[]) => [[{ id: 10 }], undefined])
    };
    return callback(connection);
  });

  return {
    database: {
      pool: {} as Database["pool"],
      query,
      execute,
      executeInTransaction,
      close: vi.fn(),
      ping: vi.fn(),
      initialize: vi.fn()
    } as unknown as Database,
    query,
    execute,
    executeInTransaction
  };
};

describe("member service", () => {
  const adminActor: AuthenticatedUser = {
    id: 1,
    username: "admin",
    fullName: "System Administrator",
    roles: ["Administrator"]
  };
  const unrelatedCoach: AuthenticatedUser = {
    id: 44,
    username: "coach-b",
    fullName: "Coach B",
    roles: ["Coach", "Member"]
  };
  const assignedCoach: AuthenticatedUser = {
    id: 3,
    username: "coach",
    fullName: "Coach Carter",
    roles: ["Coach", "Member"]
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates members with encrypted phone data and masked output", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    const cryptoService = {
      encrypt: vi.fn().mockResolvedValue({
        keyId: "key-1",
        cipherText: "cipher-phone"
      }),
      decrypt: vi.fn().mockResolvedValue("251912345678"),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue("***-***-5678")
    };
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: "cipher-phone",
          phone_key_id: "key-1",
          phone_last4: "5678",
          active: 1,
          location_code: "HQ",
          notes: "Signed up at front desk",
          coach_user_id: null
        }
      ])
      .mockResolvedValueOnce([]);

    const service = createMemberService(database, cryptoService);
    const member = await service.createMember({
      username: "member-two",
      fullName: "Member Two",
      password: "Member12345!X",
      phone: "251912345678",
      locationCode: "HQ",
      notes: "Signed up at front desk"
    }, adminActor);

    expect(member.phoneMasked).toBe("***-***-5678");
    expect(member.faceConsentStatus).toBe("unknown");
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("rejects duplicate member usernames", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([{ id: 2 }]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn()
    });

    await expect(
      service.createMember({
        username: "member",
        fullName: "Duplicate",
        password: "Member12345!X",
        phone: null,
        locationCode: "HQ"
      }, adminActor)
    ).rejects.toMatchObject({
      code: "member_exists"
    } satisfies Partial<AppError>);
  });

  it("records face consent changes and returns the updated member state", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: null
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: null
        }
      ])
      .mockResolvedValueOnce([{ consent_status: "granted" }]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });
    const member = await service.recordFaceConsent(10, 1, "granted", adminActor);

    expect(member.faceConsentStatus).toBe("granted");
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("assigns coaches, lists members, and lists coach options", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: null
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 3 }])
      .mockResolvedValueOnce([{ location_code: "HQ" }])
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: 3
        }
      ])
      .mockResolvedValueOnce([{ consent_status: "granted" }])
      .mockResolvedValueOnce([{ user_id: 10 }])
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: 3
        }
      ])
      .mockResolvedValueOnce([{ consent_status: "granted" }])
      .mockResolvedValueOnce([
        {
          id: 3,
          username: "coach",
          full_name: "Coach Carter"
        }
      ]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });
    const member = await service.assignCoach(10, 3, adminActor);
    const members = await service.listMembers(adminActor);
    const coaches = await service.listCoaches();

    expect(member.coachUserId).toBe(3);
    expect(members[0]?.id).toBe(10);
    expect(coaches[0]?.fullName).toBe("Coach Carter");
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("allows a coach with location assignment to create an initial member", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ location_code: "HQ" }])
      .mockResolvedValueOnce([{ id: 3 }])
      .mockResolvedValueOnce([{ location_code: "HQ" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-three",
          full_name: "Member Three",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: 3
        }
      ])
      .mockResolvedValueOnce([]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });
    const member = await service.createMember(
      {
        username: "member-three",
        fullName: "Member Three",
        password: "Member12345!X",
        phone: null,
        locationCode: "HQ"
      },
      assignedCoach
    );

    expect(member.coachUserId).toBe(3);
    expect(executeInTransaction).toHaveBeenCalled();
  });

  it("rejects unrelated coach access to another member", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });

    await expect(service.assignCoach(10, 3, unrelatedCoach)).rejects.toMatchObject({
      code: "forbidden"
    } satisfies Partial<AppError>);
  });

  it("returns member profile only when actor is authorized", async () => {
    const { database, query } = createMockDatabase();
    query
      .mockResolvedValueOnce([
        {
          id: 10,
          username: "member-two",
          full_name: "Member Two",
          phone_encrypted: null,
          phone_key_id: null,
          phone_last4: null,
          active: 1,
          location_code: "HQ",
          notes: null,
          coach_user_id: null
        }
      ])
      .mockResolvedValueOnce([{ consent_status: "granted" }]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });

    const member = await service.getMember(10, adminActor);
    expect(member.id).toBe(10);
  });

  it("lists report recipients from active users", async () => {
    const { database, query } = createMockDatabase();
    query.mockResolvedValueOnce([
      {
        id: 1,
        full_name: "System Administrator",
        username: "admin",
        roles: "Administrator,Coach,Member"
      }
    ]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });

    const recipients = await service.listRecipients(adminActor);
    expect(recipients[0]?.username).toBe("admin");
  });

  it("allows administrators to manage coach location assignments", async () => {
    const { database, query, executeInTransaction } = createMockDatabase();
    query
      .mockResolvedValueOnce([{ id: 3 }])
      .mockResolvedValueOnce([
        {
          coach_user_id: 3,
          location_code: "HQ",
          is_active: 1,
          assigned_at: new Date("2026-03-28T10:00:00.000Z")
        }
      ]);

    const service = createMemberService(database, {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptBytes: vi.fn(),
      decryptBytes: vi.fn(),
      hashForComparison: vi.fn().mockReturnValue("hash"),
      maskPhone: vi.fn().mockReturnValue(null)
    });

    const location = await service.assignCoachLocation(3, "HQ", adminActor);
    const locations = await service.listCoachLocations(3, adminActor);

    expect(location.locationCode).toBe("HQ");
    expect(locations[0]?.locationCode).toBe("HQ");
    expect(executeInTransaction).toHaveBeenCalled();
  });
});
