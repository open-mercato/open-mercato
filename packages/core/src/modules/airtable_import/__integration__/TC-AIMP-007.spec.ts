import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { login } from "@open-mercato/core/modules/core/__integration__/helpers/auth";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync, unlinkSync } from "fs";

/**
 * TC-AIMP-007: Import session list page UI
 *
 * Tests the /backend/airtable-import list page:
 * - page renders with heading and "Nowy import" button
 * - newly created session appears in the table
 * - clicking "Nowy import" opens the creation dialog
 *
 * Pattern: beforeAll does only API calls (fast). Browser login is lazy —
 * first browser test logs in and saves storageState; subsequent tests reuse it.
 */
test.describe("TC-AIMP-007: Import session list page", () => {
  let token: string;
  let createdSessionId: string | null = null;
  // Shared path — reused by TC-AIMP-008 so it doesn't need its own login
  const storageStatePath = join(tmpdir(), "aimp-admin-state.json");

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, "admin");
  });

  test.afterAll(async ({ request }) => {
    if (createdSessionId) {
      await apiRequest(
        request,
        "DELETE",
        `/api/airtable_import/sessions/${createdSessionId}`,
        { token },
      ).catch(() => {});
    }
    // Note: do NOT delete storageStatePath here — TC-AIMP-008 reuses it.
    // TC-AIMP-008's afterAll is responsible for cleanup.
  });

  async function getAuthContext(browser: Browser): Promise<BrowserContext> {
    if (existsSync(storageStatePath)) {
      return browser.newContext({ storageState: storageStatePath });
    }
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    // Pre-warm: navigate to /backend to trigger Next.js compilation of backend pages.
    // The auth guard redirects to /login, compiling both routes before login()'s
    // internal 23-second timer starts — preventing cold-start compilation timeouts.
    await pg
      .goto("/backend", { waitUntil: "networkidle", timeout: 50_000 })
      .catch(() => {});
    await login(pg, "admin");
    await ctx.storageState({ path: storageStatePath });
    await pg.close();
    return ctx;
  }

  test("should display list page with heading and new import button", async ({
    browser,
  }) => {
    test.slow(); // browser cold-start may take up to 30s
    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto("/backend/airtable-import");
      await expect(
        page.getByRole("heading", { name: "Import z Airtable" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Nowy import" }),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("should show created session in the list", async ({
    browser,
    request,
  }) => {
    const createRes = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: { airtableToken: "pat_ui_test_007", airtableBaseId: "appUI007" },
      },
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    createdSessionId = created.id;

    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto("/backend/airtable-import");
      await expect(page.getByText("appUI007")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("should open new import dialog on button click", async ({ browser }) => {
    test.slow(); // dialog rendering can be slow on first context open
    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto("/backend/airtable-import");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Nowy import" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 40_000 });
      await expect(page.getByText("Nowy import z Airtable")).toBeVisible();
      await expect(
        page.getByPlaceholder(
          "pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        ),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
