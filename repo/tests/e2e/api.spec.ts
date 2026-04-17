import { expect, test } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";

const BACKEND_BASE_URL = process.env.PLAYWRIGHT_BACKEND_URL ?? "http://127.0.0.1:3000";

type RequestApi = Parameters<typeof test>[0]["request"];

const sign = (sessionSecret: string, method: string, path: string, body?: unknown) => {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256")
    .update(body ? JSON.stringify(body) : "")
    .digest("hex");
  const payload = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", Buffer.from(sessionSecret, "base64"))
    .update(payload)
    .digest("hex");
  return { timestamp, nonce, signature };
};

const extractCookie = (setCookieHeaders: string[], name: string) => {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error(`missing cookie ${name}`);
};

const waitForBackend = async () => {
  await expect
    .poll(
      async () => {
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/health/ready`);
          return res.status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 }
    )
    .toBe(200);
};

const loginAs = async (
  request: RequestApi,
  username: string,
  password: string,
  station = "Api-Spec-Desk"
) => {
  let attempt = 0;
  let response = await request.post(`${BACKEND_BASE_URL}/api/auth/login`, {
    headers: { "x-station-token": station },
    data: { username, password }
  });
  while (response.status() === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 65000));
    response = await request.post(`${BACKEND_BASE_URL}/api/auth/login`, {
      headers: { "x-station-token": station },
      data: { username, password }
    });
    attempt += 1;
  }
  expect(response.ok(), `login failed for ${username}: ${response.status()}`).toBeTruthy();
  const payload = await response.json();
  const setCookies = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  return {
    sessionSecret: String(payload.data.sessionSecret),
    sessionCookie: extractCookie(setCookies, "sf_session"),
    workstationCookie: extractCookie(setCookies, "sf_workstation"),
    currentUser: payload.data.currentUser as {
      id: number;
      username: string;
      fullName: string;
      roles: string[];
    },
    station
  };
};

interface AuthMaterial {
  sessionSecret: string;
  sessionCookie: string;
  workstationCookie: string;
  currentUser: { id: number; username: string; fullName: string; roles: string[] };
  station: string;
}

const signedRequest = async (
  request: RequestApi,
  auth: AuthMaterial,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
) => {
  const sig = sign(auth.sessionSecret, method, path, body);
  const headers: Record<string, string> = {
    cookie: `sf_session=${auth.sessionCookie}; sf_workstation=${auth.workstationCookie}`,
    "x-station-token": auth.station,
    "x-sf-timestamp": sig.timestamp,
    "x-sf-nonce": sig.nonce,
    "x-sf-signature": sig.signature
  };
  const url = `${BACKEND_BASE_URL}${path}`;

  let response;
  let attempt = 0;
  while (true) {
    if (method === "GET") {
      response = await request.get(url, { headers });
    } else if (method === "POST") {
      response = await request.post(url, { headers, data: body ?? {} });
    } else if (method === "PUT") {
      response = await request.put(url, { headers, data: body ?? {} });
    } else if (method === "PATCH") {
      response = await request.patch(url, { headers, data: body ?? {} });
    } else {
      response = await request.delete(url, { headers });
    }
    if (response.status() !== 429 || attempt >= 2) {
      break;
    }
    attempt += 1;
    await new Promise((r) => setTimeout(r, 65000));
  }
  return response;
};

interface SweepState {
  auth: AuthMaterial;
  coachUserId: number;
  memberId: number;
  templateId: number;
  createdPostId: number;
  inboxItemId: number;
  backupId: number;
  suffix: string;
}

const sweep: SweepState = {
  auth: null as unknown as AuthMaterial,
  coachUserId: 0,
  memberId: 0,
  templateId: 0,
  createdPostId: 0,
  inboxItemId: 0,
  backupId: 0,
  suffix: ""
};

test.describe("no-mock HTTP coverage — unsigned endpoints", () => {
  test.describe.configure({ mode: "serial", timeout: 60_000 });
  test.skip(
    !!process.env.PLAYWRIGHT_BOOTSTRAP_ONLY,
    "Unsigned endpoint sweep needs the seeded pass; bootstrap pass uses a fresh DB."
  );

  test("GET /health/live returns service metadata", async ({ request }) => {
    await waitForBackend();
    const res = await request.get(`${BACKEND_BASE_URL}/health/live`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.service).toBe("sentinelfit-backend");
    expect(body.data.status).toBe("ok");
  });

  test("GET /health/ready reports api=up and database=up", async ({ request }) => {
    const res = await request.get(`${BACKEND_BASE_URL}/health/ready`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.services.api).toBe("up");
    expect(body.data.services.database).toBe("up");
  });

  test("GET / returns the backend identity envelope", async ({ request }) => {
    const res = await request.get(`${BACKEND_BASE_URL}/`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("SentinelFit Operations Backend");
    expect(body.data.slice).toBe("full-platform");
  });

  test("GET /api/auth/bootstrap/status reports requiresBootstrap=false on the seeded stack", async ({
    request
  }) => {
    const res = await request.get(`${BACKEND_BASE_URL}/api/auth/bootstrap/status`, {
      headers: { "x-station-token": "Api-Spec-Desk" }
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.requiresBootstrap).toBe(false);
  });

  test("POST /api/auth/bootstrap/admin rejects a second admin with 409 bootstrap_unavailable", async ({
    request
  }) => {
    const res = await request.post(`${BACKEND_BASE_URL}/api/auth/bootstrap/admin`, {
      headers: { "x-station-token": "Api-Spec-Desk" },
      data: {
        username: "second-admin",
        fullName: "Second Admin",
        password: "Admin12345!X"
      }
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("bootstrap_unavailable");
  });

  test("GET /api/auth/session returns null when no cookie is provided", async ({ request }) => {
    const res = await request.get(`${BACKEND_BASE_URL}/api/auth/session`, {
      headers: { "x-station-token": "Api-Spec-Desk" }
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.session).toBeNull();
  });

  test("POST /api/auth/pin/reenter without a warm session rejects with 401 missing_session", async ({
    request
  }) => {
    const res = await request.post(`${BACKEND_BASE_URL}/api/auth/pin/reenter`, {
      headers: { "x-station-token": "Api-Spec-Desk" },
      data: { username: "admin", pin: "1234" }
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("missing_session");
  });
});

test.describe("no-mock HTTP coverage — signed admin route families", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(
    !!process.env.PLAYWRIGHT_BOOTSTRAP_ONLY,
    "Signed sweep needs seeded demo accounts; the clean-install bootstrap pass uses a fresh DB."
  );

  test.beforeAll(async ({ request }) => {
    await waitForBackend();
    sweep.auth = await loginAs(request, "admin", "Admin12345!X");
    sweep.suffix = Date.now().toString().slice(-7);
  });

  test("self routes: GET /api/self/profile and POST /api/self/consent/face (member-scoped)", async ({
    request
  }) => {
    // /api/self/* targets the caller's own member_profiles row.
    // The admin demo user is NOT a member, so we log in as the seeded `member` user
    // for this test and restore the admin sweep auth afterwards.
    const memberAuth = await loginAs(request, "member", "Member12345!X", "Member-Self-Desk");

    const profile = await signedRequest(request, memberAuth, "GET", "/api/self/profile");
    expect(profile.status()).toBe(200);
    const profileBody = await profile.json();
    expect(profileBody.data.member.id).toBe(memberAuth.currentUser.id);
    expect(typeof profileBody.data.member.username).toBe("string");

    const consent = await signedRequest(request, memberAuth, "POST", "/api/self/consent/face", {
      consentStatus: "granted"
    });
    expect(consent.status()).toBe(200);
    expect(Number((await consent.json()).data.member.id)).toBe(memberAuth.currentUser.id);
  });

  test("GET /api/members returns member and coach lists including the seeded coach", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "GET", "/api/members");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.members)).toBe(true);
    expect(Array.isArray(body.data.coaches)).toBe(true);
    const coach = (body.data.coaches as Array<{ id: number; username: string }>).find(
      (c) => c.username === "coach"
    );
    expect(coach, "demo seed must include a coach").toBeTruthy();
    sweep.coachUserId = coach!.id;
  });

  test("POST /api/members creates a member and POST /consent/face grants consent", async ({
    request
  }) => {
    const memberPayload = {
      username: `apispec${sweep.suffix}`,
      fullName: `API Spec Member ${sweep.suffix}`,
      password: "Member12345!X",
      phone: "251911111111",
      locationCode: "HQ"
    };
    const createMember = await signedRequest(
      request,
      sweep.auth,
      "POST",
      "/api/members",
      memberPayload
    );
    expect(createMember.status()).toBe(200);
    const createdBody = await createMember.json();
    expect(createdBody.data.member.username).toBe(memberPayload.username);
    expect(createdBody.data.member.fullName).toBe(memberPayload.fullName);
    sweep.memberId = Number(createdBody.data.member.id);
    expect(sweep.memberId).toBeGreaterThan(0);

    const grant = await signedRequest(
      request,
      sweep.auth,
      "POST",
      `/api/members/${sweep.memberId}/consent/face`,
      { consentStatus: "granted" }
    );
    expect(grant.status()).toBe(200);
    const grantBody = await grant.json();
    expect(Number(grantBody.data.member.id)).toBe(sweep.memberId);
    expect(grantBody.data.member.faceConsentStatus).toBe("granted");
  });

  test("POST /api/members/:id/coach-assignment assigns the seeded coach", async ({ request }) => {
    const res = await signedRequest(
      request,
      sweep.auth,
      "POST",
      `/api/members/${sweep.memberId}/coach-assignment`,
      { coachUserId: sweep.coachUserId }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Number(body.data.member.id)).toBe(sweep.memberId);
    expect(Number(body.data.member.coachUserId)).toBe(sweep.coachUserId);
  });

  test("coach locations: POST adds HQ and GET returns it", async ({ request }) => {
    const add = await signedRequest(
      request,
      sweep.auth,
      "POST",
      `/api/members/coaches/${sweep.coachUserId}/locations`,
      { locationCode: "HQ" }
    );
    expect(add.status()).toBe(200);
    const addBody = await add.json();
    expect(addBody.data.location.coachUserId).toBe(sweep.coachUserId);
    expect(addBody.data.location.locationCode).toBe("HQ");
    expect(addBody.data.location.isActive).toBe(true);

    const list = await signedRequest(
      request,
      sweep.auth,
      "GET",
      `/api/members/coaches/${sweep.coachUserId}/locations`
    );
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    const entry = (listBody.data.locations as Array<{ locationCode: string; isActive: boolean }>)
      .find((l) => l.locationCode === "HQ");
    expect(entry).toBeTruthy();
    expect(entry!.isActive).toBe(true);
  });

  test("POST /api/faces/challenge returns a challengeId with a delay window", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/faces/challenge", {
      memberUserId: sweep.memberId
    });
    expect(res.status()).toBe(200);
    const challenge = (await res.json()).data.challenge;
    expect(typeof challenge.challengeId).toBe("string");
    expect(challenge.challengeId.length).toBeGreaterThan(0);
    expect(typeof challenge.issuedAt).toBe("string");
    expect(typeof challenge.expiresAt).toBe("string");
    expect(typeof challenge.minDelayMs).toBe("number");
    expect(typeof challenge.maxDelayMs).toBe("number");
    expect(challenge.maxDelayMs).toBeGreaterThan(challenge.minDelayMs);
  });

  test("POST /api/faces/dedup-check with invalid image data rejects 400 image_invalid", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/faces/dedup-check", {
      memberUserId: sweep.memberId,
      sourceType: "import",
      centerImageBase64: "not-a-data-url",
      turnImageBase64: "not-a-data-url"
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("image_invalid");
  });

  test("POST /api/faces/enroll with unknown challengeId rejects 400 capture_timing_invalid", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/faces/enroll", {
      memberUserId: sweep.memberId,
      sourceType: "import",
      challengeId: "no-challenge",
      centerImageBase64: "data:image/png;base64,AAAA",
      turnImageBase64: "data:image/png;base64,AAAA"
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("capture_timing_invalid");
  });

  test("GET /api/faces/history/:memberUserId returns an array for the new member", async ({
    request
  }) => {
    const res = await signedRequest(
      request,
      sweep.auth,
      "GET",
      `/api/faces/history/${sweep.memberId}`
    );
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).data.history)).toBe(true);
  });

  test("GET /api/faces/audit/:memberUserId returns an array for the new member", async ({
    request
  }) => {
    const res = await signedRequest(
      request,
      sweep.auth,
      "GET",
      `/api/faces/audit/${sweep.memberId}`
    );
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).data.auditTrail)).toBe(true);
  });

  test("PATCH /api/faces/:faceRecordId/deactivate on an unknown id returns 404 face_record_not_found", async ({
    request
  }) => {
    const res = await signedRequest(
      request,
      sweep.auth,
      "PATCH",
      "/api/faces/999999/deactivate"
    );
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("face_record_not_found");
  });

  test("content: GET /api/content/posts lists posts; POST /api/content/posts creates one", async ({
    request
  }) => {
    const list = await signedRequest(request, sweep.auth, "GET", "/api/content/posts");
    expect(list.status()).toBe(200);
    expect(Array.isArray((await list.json()).data.posts)).toBe(true);

    const create = await signedRequest(request, sweep.auth, "POST", "/api/content/posts", {
      kind: "tip",
      title: `Api Tip ${sweep.suffix}`,
      body: "API spec post body",
      locationCode: "HQ"
    });
    expect(create.status()).toBe(200);
    const createBody = await create.json();
    expect(createBody.data.post.title).toBe(`Api Tip ${sweep.suffix}`);
    expect(createBody.data.post.kind).toBe("tip");
    expect(createBody.data.post.locationCode).toBe("HQ");
    sweep.createdPostId = Number(createBody.data.post.id);
    expect(sweep.createdPostId).toBeGreaterThan(0);
  });

  test("POST /api/content/views records a view on the created post", async ({ request }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/content/views", {
      postId: sweep.createdPostId
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.recorded).toBe(true);
  });

  test("POST /api/content/search-events records a search event", async ({ request }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/content/search-events", {
      searchTerm: "mobility",
      locationCode: "HQ"
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.recorded).toBe(true);
  });

  test("GET /api/content/analytics returns the four analytics arrays", async ({ request }) => {
    const res = await signedRequest(
      request,
      sweep.auth,
      "GET",
      "/api/content/analytics?locationCode=HQ"
    );
    expect(res.status()).toBe(200);
    const analytics = (await res.json()).data.analytics;
    expect(Array.isArray(analytics.viewsByStation)).toBe(true);
    expect(Array.isArray(analytics.topPosts)).toBe(true);
    expect(Array.isArray(analytics.searchTrends)).toBe(true);
    expect(Array.isArray(analytics.posts)).toBe(true);
  });

  test("dashboards: GET /api/dashboards/me returns layout+templates; PUT persists a layout", async ({
    request
  }) => {
    const get = await signedRequest(request, sweep.auth, "GET", "/api/dashboards/me");
    expect(get.status()).toBe(200);
    const getBody = await get.json();
    expect(Array.isArray(getBody.data.layout)).toBe(true);
    expect(Array.isArray(getBody.data.templates)).toBe(true);

    const put = await signedRequest(request, sweep.auth, "PUT", "/api/dashboards/me", {
      layout: [
        { id: "members", widgetType: "members", title: "Members", x: 0, y: 0, width: 2, height: 2 }
      ]
    });
    expect(put.status()).toBe(200);
    const savedLayout = (await put.json()).data.layout as Array<{ id: string; widgetType?: string }>;
    const membersWidget = savedLayout.find((w) => w.id === "members");
    expect(membersWidget).toBeTruthy();
    expect(membersWidget!.widgetType).toBe("members");
  });

  test("POST /api/dashboards/templates creates and returns a new template", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/dashboards/templates", {
      name: `API Template ${sweep.suffix}`,
      layout: []
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.template.name).toBe(`API Template ${sweep.suffix}`);
    sweep.templateId = Number(body.data.template.id);
    expect(sweep.templateId).toBeGreaterThan(0);
  });

  test("reports: schedules and recipients listings return arrays", async ({ request }) => {
    const schedules = await signedRequest(request, sweep.auth, "GET", "/api/reports/schedules");
    expect(schedules.status()).toBe(200);
    expect(Array.isArray((await schedules.json()).data.schedules)).toBe(true);

    const recipients = await signedRequest(request, sweep.auth, "GET", "/api/reports/recipients");
    expect(recipients.status()).toBe(200);
    expect(Array.isArray((await recipients.json()).data.recipients)).toBe(true);
  });

  test("POST /api/reports/schedules persists a weekly PDF schedule", async ({ request }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/reports/schedules", {
      templateId: sweep.templateId,
      name: `API Schedule ${sweep.suffix}`,
      cronExpression: "0 6 * * 1",
      format: "pdf",
      subscriberUserIds: [sweep.auth.currentUser.id]
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Number(body.data.schedule.id)).toBeGreaterThan(0);
    expect(body.data.schedule.exportFormat ?? body.data.schedule.format).toMatch(/pdf/i);
  });

  test("POST /api/reports/generate produces an export with a positive exportId", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/reports/generate", {
      templateId: sweep.templateId,
      format: "pdf",
      locationCode: "HQ"
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Number(body.data.report.exportId)).toBeGreaterThan(0);
  });

  test("GET /api/reports/inbox surfaces at least the just-generated item", async ({ request }) => {
    const res = await signedRequest(request, sweep.auth, "GET", "/api/reports/inbox");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const inbox = body.data.inbox as Array<{ id: number; format: string; fileName: string; status: string }>;
    expect(inbox.length).toBeGreaterThan(0);
    const first = inbox[0];
    expect(Number(first.id)).toBeGreaterThan(0);
    expect(typeof first.fileName).toBe("string");
    expect(first.fileName.length).toBeGreaterThan(0);
    sweep.inboxItemId = Number(first.id);
  });

  test("GET /api/reports/inbox/:id/download streams an attachment", async ({ request }) => {
    const res = await signedRequest(
      request,
      sweep.auth,
      "GET",
      `/api/reports/inbox/${sweep.inboxItemId}/download`
    );
    expect(res.status()).toBe(200);
    const contentDisposition = (res.headers()["content-disposition"] ?? "").toLowerCase();
    expect(contentDisposition).toContain("attachment");
  });

  test("admin: GET /api/admin/console exposes metrics and recent-log/alert arrays", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "GET", "/api/admin/console");
    expect(res.status()).toBe(200);
    const consoleData = (await res.json()).data.console;
    expect(typeof consoleData.metrics.totalLogs).toBe("number");
    expect(typeof consoleData.metrics.uptimeSeconds).toBe("number");
    expect(typeof consoleData.metrics.averageRequestDurationMs).toBe("number");
    expect(Array.isArray(consoleData.recentLogs)).toBe(true);
    expect(Array.isArray(consoleData.recentAlerts)).toBe(true);
  });

  test("POST /api/admin/backups kicks off a backup with a positive id", async ({ request }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/admin/backups");
    expect(res.status()).toBe(200);
    const body = await res.json();
    sweep.backupId = Number(body.data.backup.id);
    expect(sweep.backupId).toBeGreaterThan(0);
  });

  test("POST /api/admin/recovery/dry-run against the new backup reports passed", async ({
    request
  }) => {
    const res = await signedRequest(request, sweep.auth, "POST", "/api/admin/recovery/dry-run", {
      backupRunId: sweep.backupId
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.recovery.status).toBe("passed");
  });
});

test.describe("no-mock HTTP coverage — auth lifecycle (PIN setup, logout, warm-lock)", () => {
  test.describe.configure({ mode: "serial", timeout: 60_000 });
  test.skip(
    !!process.env.PLAYWRIGHT_BOOTSTRAP_ONLY,
    "Lifecycle tests need seeded demo accounts."
  );

  test("POST /api/auth/pin/setup upserts the PIN and returns hasPin=true", async ({ request }) => {
    await waitForBackend();
    const auth = await loginAs(request, "admin", "Admin12345!X", "Lifecycle-Desk");
    const res = await signedRequest(request, auth, "POST", "/api/auth/pin/setup", { pin: "1234" });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.hasPin).toBe(true);
  });

  test("POST /api/auth/logout revokes the signed session and returns loggedOut=true", async ({
    request
  }) => {
    await waitForBackend();
    const auth = await loginAs(request, "admin", "Admin12345!X", "Lifecycle-Desk");
    const res = await signedRequest(request, auth, "POST", "/api/auth/logout");
    expect(res.status()).toBe(200);
    expect((await res.json()).data.loggedOut).toBe(true);
  });

  test("POST /api/auth/warm-lock marks the session warm-locked unconditionally (no env skip)", async ({
    request
  }) => {
    await waitForBackend();
    const auth = await loginAs(request, "admin", "Admin12345!X", "Warm-Lock-Desk");
    const res = await signedRequest(request, auth, "POST", "/api/auth/warm-lock");
    expect(res.status()).toBe(200);
    expect((await res.json()).data.warmLocked).toBe(true);
  });
});
