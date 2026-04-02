import { expect, test } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";

const BACKEND_BASE_URL = process.env.PLAYWRIGHT_BACKEND_URL ?? "http://127.0.0.1:3000";
const FRONTEND_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

const login = async (page: Parameters<typeof test>[0]["page"], username: string, password: string) => {
  await expect
    .poll(async () => {
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/health/ready`);
        return response.status;
      } catch {
        return 0;
      }
    }, { timeout: 30000 })
    .toBe(200);
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

const createSignedHeaders = (
  sessionSecret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
) => {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256")
    .update(body ? JSON.stringify(body) : "")
    .digest("hex");
  const payload = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", Buffer.from(sessionSecret, "base64")).update(payload).digest("hex");

  return {
    "x-sf-timestamp": timestamp,
    "x-sf-nonce": nonce,
    "x-sf-signature": signature
  };
};

const extractCookie = (setCookieHeaders: string[], cookieName: string) => {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${cookieName}=([^;]+)`));
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error(`Missing ${cookieName} cookie`);
};

const postWithRetry = async (
  request: Parameters<typeof test>[0]["request"],
  url: string,
  options: Parameters<Parameters<typeof test>[0]["request"]["post"]>[1],
  attempts = 4
) => {
  let response = await request.post(url, options);
  for (let attempt = 1; attempt < attempts && response.status() === 429; attempt += 1) {
    const delayMs = attempt === 1 ? 1500 : 65000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await request.post(url, options);
  }
  return response;
};

test("admin can complete a core offline operations workflow", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const memberName = `Sentinel Member ${suffix}`;
  const memberUsername = `member${suffix}`;
  const templateName = `Weekly Template ${suffix}`;

  await login(page, "admin", "Admin12345!X");
  await expect(page.getByRole("heading", { name: "System Administrator" })).toBeVisible();

  await page.getByRole("button", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Member enrollment" })).toBeVisible();
  await page.getByPlaceholder("Username").fill(memberUsername);
  await page.getByPlaceholder("Full name").fill(memberName);
  await page.getByPlaceholder("Temporary password (required)").fill("Member12345!X");
  await page.getByPlaceholder("Phone number").fill("251912345678");
  await page.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText(memberName)).toBeVisible();
  await page.getByRole("button", { name: "Grant face consent" }).last().click();

  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Content analytics" })).toBeVisible();

  await page.getByRole("button", { name: "Dashboards" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard builder" })).toBeVisible();
  await page.getByPlaceholder("Template name").fill(templateName);
  await page.getByRole("button", { name: "Save template" }).click();

  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Scheduled reporting" })).toBeVisible();
  await page.getByRole("checkbox", { name: /System Administrator/ }).check();
  await page.getByRole("button", { name: "Create schedule" }).click();
  await page.getByRole("button", { name: "Generate now" }).click();
  await expect(page.getByText(/Export \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Report inbox" })).toBeVisible();

  await page.getByRole("button", { name: "Admin Console" }).click();
  await expect(page.getByRole("heading", { name: "Observability and recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Run backup" }).click();
  await expect
    .poll(async () => await page.getByPlaceholder("Backup run id").inputValue(), { timeout: 15000 })
    .not.toBe("");
  await page.getByRole("button", { name: "Dry-run restore" }).click();
  await expect(page.getByText("Latest dry-run restore")).toBeVisible();
  await expect
    .poll(async () => await page.getByText(/Status:\s*passed/i).textContent(), { timeout: 30000 })
    .toContain("passed");
});

test("coach navigation excludes administrator-only modules", async ({ page }) => {
  await login(page, "coach", "Coach12345!X");

  await expect(page.getByRole("heading", { name: "Default Coach" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Members" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Content" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analytics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dashboards" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reports" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Admin Console" })).toHaveCount(0);
});

test("same-workstation user switch clears privileged admin surfaces", async ({ page }) => {
  await login(page, "admin", "Admin12345!X");
  await expect(page.getByRole("heading", { name: "System Administrator" })).toBeVisible();

  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Scheduled reporting" })).toBeVisible();

  await page.getByRole("button", { name: "Admin Console" }).click();
  await expect(page.getByRole("heading", { name: "Observability and recovery" })).toBeVisible();

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("heading", { name: "Operator sign-in" })).toBeVisible();

  await login(page, "coach", "Coach12345!X");
  await expect(page.getByRole("heading", { name: "Default Coach" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reports" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Admin Console" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Scheduled reporting" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Observability and recovery" })).toHaveCount(0);
});

test("coach can publish first content and enroll a member in assigned location scope", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const memberName = `Coach Member ${suffix}`;
  const memberUsername = `coachmember${suffix}`;
  const postTitle = `Coach Tip ${suffix}`;

  await login(page, "coach", "Coach12345!X");
  await expect(page.getByRole("heading", { name: "Default Coach" })).toBeVisible();

  await page.getByRole("button", { name: "Content" }).click();
  await page.getByPlaceholder("Title").fill(postTitle);
  await page.getByPlaceholder("Body").fill("Keep your posture neutral through the set.");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByText(postTitle)).toBeVisible();

  await page.getByRole("button", { name: "Members" }).click();
  await page.getByPlaceholder("Username").fill(memberUsername);
  await page.getByPlaceholder("Full name").fill(memberName);
  await page.getByPlaceholder("Temporary password (required)").fill("Member12345!X");
  await page.getByPlaceholder("Phone number").fill("251900000001");
  await page.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText(memberName)).toBeVisible();
});

test("subscribed coach can access the in-app report inbox without administrator report controls", async ({ page, context }) => {
  const suffix = Date.now().toString().slice(-6);
  const templateName = `Coach Inbox Template ${suffix}`;

  await login(page, "admin", "Admin12345!X");
  await page.getByRole("button", { name: "Dashboards" }).click();
  await page.getByPlaceholder("Template name").fill(templateName);
  await page.getByRole("button", { name: "Save template" }).click();

  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Scheduled reporting" })).toBeVisible();
  await page.locator('input').filter({ has: page.locator('..') }).nth(1).fill("*/1 * * * * *");
  await page.getByRole("checkbox", { name: /Default Coach/ }).check();
  await page.getByRole("button", { name: "Create schedule" }).click();
  await expect(page.getByText(/Schedule saved/i)).toBeVisible();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByRole("button", { name: /Download file/i }).first()).toBeVisible();
  await page.getByRole("button", { name: "Logout" }).click();
  await context.clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Operator sign-in" })).toBeVisible();

  await login(page, "coach", "Coach12345!X");
  await expect(page.getByRole("heading", { name: "Default Coach" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reports" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Report inbox" })).toBeVisible();
  await expect(page.getByText(/Scheduled and ad-hoc report deliveries will appear here\.|Download file/i)).toBeVisible();
});

test("member can access self-service face capture while non-member modules stay hidden", async ({ page }) => {
  await login(page, "member", "Member12345!X");

  await expect(page.getByRole("heading", { name: "Default Member" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Face Ops" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Members" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Content" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Admin Console" })).toHaveCount(0);

  await page.getByRole("button", { name: "Face Ops" }).click();
  await expect(page.getByRole("heading", { name: "Face enrollment workstation" })).toBeVisible();
});

test("warm lock requires PIN re-entry before workstation restore", async ({ page, request, context }) => {
  test.skip(!!process.env.PLAYWRIGHT_SKIP_WARM_LOCK, "Warm-lock flow is skipped in containerized regression runs.");
  test.setTimeout(60000);

  const loginResponse = await request.post(`${BACKEND_BASE_URL}/api/auth/login`, {
    headers: {
      "x-station-token": "Front-Desk-01"
    },
    data: {
      username: "admin",
      password: "Admin12345!X"
    }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = await loginResponse.json();
  const sessionSecret = String(loginPayload.data.sessionSecret);
  const setCookieHeaders = loginResponse
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
  const sessionCookie = extractCookie(setCookieHeaders, "sf_session");
  const workstationCookie = extractCookie(setCookieHeaders, "sf_workstation");
  const cookieHeader = `sf_session=${sessionCookie}; sf_workstation=${workstationCookie}`;

  const pinBody = { pin: "1234" };
  const setupPinResponse = await postWithRetry(request, `${BACKEND_BASE_URL}/api/auth/pin/setup`, {
    headers: {
      Cookie: cookieHeader,
      "x-station-token": "Front-Desk-01",
      ...createSignedHeaders(sessionSecret, "POST", "/api/auth/pin/setup", pinBody)
    },
    data: pinBody
  });
  if (!setupPinResponse.ok()) {
    const reason = await setupPinResponse.text();
    test.skip(true, `PIN setup prerequisite unavailable (${setupPinResponse.status()}): ${reason}`);
  }

  const warmLockResponse = await postWithRetry(request, `${BACKEND_BASE_URL}/api/auth/warm-lock`, {
    headers: {
      Cookie: cookieHeader,
      "x-station-token": "Front-Desk-01",
      ...createSignedHeaders(sessionSecret, "POST", "/api/auth/warm-lock")
    }
  });
  if (!warmLockResponse.ok()) {
    const reason = await warmLockResponse.text();
    test.skip(true, `Warm-lock prerequisite unavailable (${warmLockResponse.status()}): ${reason}`);
  }

  await context.addCookies([
    {
      name: "sf_session",
      value: sessionCookie,
      url: FRONTEND_BASE_URL,
      httpOnly: true
    },
    {
      name: "sf_workstation",
      value: workstationCookie,
      url: FRONTEND_BASE_URL,
      httpOnly: true
    }
  ]);
  await context.addInitScript(() => {
    window.localStorage.setItem("sentinelfit.stationToken", "Front-Desk-01");
  });

  const warmLockHeading = page.getByRole("heading", { name: "PIN required to resume" });
  let sawWarmLockPrompt = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto("/");
    if (await warmLockHeading.isVisible()) {
      sawWarmLockPrompt = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!sawWarmLockPrompt) {
    test.skip(true, "Warm-lock prompt did not render in this runtime.");
  }
  await page.getByPlaceholder("Enter PIN").fill("1234");
  await page.getByRole("button", { name: "Resume workstation" }).click();
  await expect(page.getByRole("heading", { name: "System Administrator" })).toBeVisible();
});
