import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api/client";

describe("api client", () => {
  const fetchMock = vi.fn();
  const sessionSecret = Buffer.alloc(32, 1).toString("base64");

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", webcrypto as unknown as Crypto);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "123e4567-e89b-12d3-a456-426614174000"
    );
  });

  it("sends unsigned login requests without HMAC headers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          currentUser: {
            id: 1,
            username: "admin",
            fullName: "System Administrator",
            roles: ["Administrator"]
          },
          sessionSecret,
          hasPin: true,
          warmLockMinutes: 5,
          sessionTimeoutMinutes: 30
        }
      })
    });

    const client = createApiClient(() => null, () => "Front-Desk-01");
    await client.login({
      username: "admin",
      password: "Admin12345!X"
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["x-station-token"]).toBe("Front-Desk-01");
    expect((options.headers as Record<string, string>)["x-sf-signature"]).toBeUndefined();
  });

  it("signs authenticated requests with nonce, timestamp, and HMAC", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          member: {
            id: 7,
            username: "member",
            fullName: "Member",
            phoneMasked: null,
            phoneLast4: null,
            locationCode: "HQ",
            notes: null,
            active: true,
            coachUserId: null,
            faceConsentStatus: "unknown"
          }
        }
      })
    });

    const client = createApiClient(() => sessionSecret, () => "Lobby-Kiosk-01");
    await client.createMember({
      username: "member",
      fullName: "Member",
      password: "Member12345!X",
      phone: null,
      locationCode: "HQ"
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;

    expect(url).toContain("/api/members");
    expect(headers["x-station-token"]).toBe("Lobby-Kiosk-01");
    expect(headers["x-sf-nonce"]).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(headers["x-sf-timestamp"]).toBeTruthy();
    expect(headers["x-sf-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(options.credentials).toBe("include");
  });

  it("surfaces structured API errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        ok: false,
        error: {
          code: "forbidden",
          message: "You do not have access"
        }
      })
    });

    const client = createApiClient(() => sessionSecret, () => "Front-Desk-01");

    await expect(client.listMembers()).rejects.toThrowError("You do not have access");
  });

  it("exposes the full REST client surface for authenticated workstation flows", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      blob: async () => new Blob(["report"]),
      headers: {
        get: (name: string) =>
          name === "content-disposition" ? 'attachment; filename="weekly-report.pdf"' : null
      },
      json: async () => ({
        ok: true,
        data: {}
      })
    }));

    const client = createApiClient(() => sessionSecret, () => "Front-Desk-01");

    await client.getBootstrapStatus();
    await client.restoreSession();
    await client.bootstrapAdministrator({ username: "owner", fullName: "Facility Owner", password: "Owner12345!X" });
    await client.getSession();
    await client.getSelfProfile();
    await client.setOwnFaceConsent("granted");
    await client.setupPin("1234");
    await client.pinReenter({ username: "admin", pin: "1234" });
    await client.logout();
    await client.listMembers();
    await client.assignCoach(1, 2);
    await client.setFaceConsent(1, "granted");
    await client.startFaceChallenge(1);
    await client.dedupCheck({ memberUserId: 1 });
    await client.enrollFace({ memberUserId: 1 });
    await client.getFaceHistory(1);
    await client.createPost({ kind: "tip", title: "Title", body: "Body", locationCode: "HQ" });
    await client.listPosts();
    await client.recordView(1, "HQ");
    await client.recordSearch("mobility", "HQ");
    await client.analytics(new URLSearchParams({ locationCode: "HQ" }));
    await client.getDashboard();
    await client.saveDashboard([]);
    await client.createTemplate("Template", []);
    await client.listSchedules();
    await client.createSchedule({ templateId: 1, name: "Weekly", cronExpression: "0 6 * * 1" });
    await client.generateReport({ templateId: 1, format: "csv" });
    await client.listRecipients();
    await client.getInbox();
    const download = await client.downloadInboxItem(1);
    await client.getAdminConsole();
    await client.createBackup();
    await client.dryRunRestore(1);

    expect(download.fileName).toBe("weekly-report.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(33);
  });
});
