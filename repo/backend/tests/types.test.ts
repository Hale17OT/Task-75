import { describe, expect, it, expectTypeOf } from "vitest";
import { roles } from "../src/types.js";
import type {
  AppErrorShape,
  AuthenticatedUser,
  Role,
  SessionRecord
} from "../src/types.js";
import type { ReturnTypeOfCreateAuthService } from "../src/service-types.js";
import type {
  ReturnTypeOfCreateContentService,
  ReturnTypeOfCreateDashboardService
} from "../src/services/service-type-helpers.js";
import type { ReturnTypeOfCreateCryptoService } from "../src/services/service-utility-types.js";
import { createAuthService } from "../src/services/auth-service.js";
import { createContentService } from "../src/services/content-service.js";
import { createDashboardService } from "../src/services/dashboard-service.js";
import { createCryptoService } from "../src/crypto.js";

describe("types.ts — role constants and authentication types", () => {
  it("exports roles in the canonical order", () => {
    expect(roles).toEqual(["Member", "Coach", "Administrator"]);
  });

  it("makes the roles array readonly at the type level", () => {
    expectTypeOf(roles).toMatchTypeOf<readonly Role[]>();
  });

  it("constrains Role to the three supported role names", () => {
    expectTypeOf<Role>().toEqualTypeOf<"Member" | "Coach" | "Administrator">();
  });

  it("AuthenticatedUser requires id, username, fullName, and roles", () => {
    const user: AuthenticatedUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    expectTypeOf(user.id).toEqualTypeOf<number>();
    expectTypeOf(user.roles).toEqualTypeOf<Role[]>();
  });

  it("AppErrorShape carries statusCode, code, message, and optional details", () => {
    const shape: AppErrorShape = {
      statusCode: 400,
      code: "validation_failed",
      message: "bad input"
    };
    expect(shape.code).toBe("validation_failed");
    expectTypeOf<AppErrorShape["details"]>().toEqualTypeOf<Record<string, unknown> | undefined>();
  });

  it("SessionRecord types timestamp fields as Date and nullable where expected", () => {
    expectTypeOf<SessionRecord["lastActivityAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<SessionRecord["warmLockedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<SessionRecord["revokedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<SessionRecord["workstationBindingHash"]>().toEqualTypeOf<string | null>();
  });
});

describe("service-types.ts — ReturnTypeOfCreateAuthService", () => {
  it("equals ReturnType<typeof createAuthService>", () => {
    expectTypeOf<ReturnTypeOfCreateAuthService>().toEqualTypeOf<ReturnType<typeof createAuthService>>();
  });

  it("surfaces the core auth-service API as callable members", () => {
    expectTypeOf<ReturnTypeOfCreateAuthService["login"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateAuthService["getBootstrapStatus"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateAuthService["getSession"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateAuthService["touchSession"]>().toBeFunction();
  });
});

describe("services/service-type-helpers.ts", () => {
  it("ReturnTypeOfCreateContentService matches createContentService", () => {
    expectTypeOf<ReturnTypeOfCreateContentService>().toEqualTypeOf<
      ReturnType<typeof createContentService>
    >();
  });

  it("ReturnTypeOfCreateDashboardService matches createDashboardService", () => {
    expectTypeOf<ReturnTypeOfCreateDashboardService>().toEqualTypeOf<
      ReturnType<typeof createDashboardService>
    >();
  });

  it("exposes expected service methods at the type level", () => {
    expectTypeOf<ReturnTypeOfCreateContentService["listPosts"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateDashboardService["createTemplate"]>().toBeFunction();
  });
});

describe("services/service-utility-types.ts", () => {
  it("ReturnTypeOfCreateCryptoService matches createCryptoService", () => {
    expectTypeOf<ReturnTypeOfCreateCryptoService>().toEqualTypeOf<
      ReturnType<typeof createCryptoService>
    >();
  });

  it("exposes encrypt/decrypt/encryptBytes/hashForComparison on the crypto surface", () => {
    expectTypeOf<ReturnTypeOfCreateCryptoService["encrypt"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateCryptoService["decrypt"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateCryptoService["encryptBytes"]>().toBeFunction();
    expectTypeOf<ReturnTypeOfCreateCryptoService["hashForComparison"]>().toBeFunction();
  });
});
