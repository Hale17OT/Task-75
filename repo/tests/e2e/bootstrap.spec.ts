import { expect, test } from "@playwright/test";

test.skip(!process.env.PLAYWRIGHT_BOOTSTRAP_ONLY, "Bootstrap scenario runs only in the clean-install verification phase.");

test("clean install allows first administrator bootstrap without demo seeds", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const adminName = `Facility Owner ${suffix}`;
  const adminUsername = `owner${suffix}`;
  const memberUsername = `member${suffix}`;

  await expect
    .poll(async () => {
      try {
        const response = await fetch("http://127.0.0.1:3000/health/ready");
        return response.status;
      } catch {
        return 0;
      }
    }, { timeout: 30000 })
    .toBe(200);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "First administrator setup" })).toBeVisible();
  await page.getByPlaceholder("Full name").fill(adminName);
  await page.getByPlaceholder("Administrator username").fill(adminUsername);
  await page.getByPlaceholder("Administrator password").fill("Owner12345!X");
  await page.getByPlaceholder("Front-Desk-01").fill("Front-Desk-01");
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page.getByRole("heading", { name: adminName })).toBeVisible();

  await page.getByRole("button", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Member enrollment" })).toBeVisible();
  await page.getByPlaceholder("Username").fill(memberUsername);
  await page.getByPlaceholder("Full name").fill(`Bootstrap Member ${suffix}`);
  await page.getByPlaceholder("Temporary password (required)").fill("Member12345!X");
  await page.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText(`Bootstrap Member ${suffix}`)).toBeVisible();
});
