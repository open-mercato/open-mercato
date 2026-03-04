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
 * TC-AIMP-008: Wizard page navigation UI
 *
 * Tests the /backend/airtable-import/[id] wizard:
 * - step 1 content is shown (heading + base ID info)
 * - step indicator shows 8 numbered circles
 * - clicking "Dalej" navigates to step 2
 * - non-existent session shows error message
 *
 * Pattern: beforeAll does only API calls (fast). Browser login is lazy —
 * first browser test logs in and saves storageState; subsequent tests reuse it.
 */
test.describe("TC-AIMP-008: Wizard page navigation", () => {
  let token: string;
  let sessionId: string | null = null;
  // Shared path — TC-AIMP-007 saves the login state here first;
  // if tests run together, no extra login is needed for 008
  const storageStatePath = join(tmpdir(), "aimp-admin-state.json");

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, "admin");
    const createRes = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: { airtableToken: "pat_ui_test_008", airtableBaseId: "appUI008" },
      },
    );
    const created = await createRes.json();
    sessionId = created.id;
  });

  test.afterAll(async ({ request }) => {
    if (sessionId) {
      await apiRequest(
        request,
        "DELETE",
        `/api/airtable_import/sessions/${sessionId}`,
        { token },
      ).catch(() => {});
    }
    try {
      unlinkSync(storageStatePath);
    } catch {
      /* ignore */
    }
  });

  async function getAuthContext(browser: Browser): Promise<BrowserContext> {
    if (existsSync(storageStatePath)) {
      return browser.newContext({ storageState: storageStatePath });
    }
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    await login(pg, "admin");
    await ctx.storageState({ path: storageStatePath });
    await pg.close();
    return ctx;
  }

  test("should display wizard with step 1 content", async ({ browser }) => {
    test.slow(); // browser cache may not be warm for this test
    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto(`/backend/airtable-import/${sessionId}`);
      await expect(
        page.getByText("Krok 1: Połączenie z Airtable"),
      ).toBeVisible();
      // Base ID shown in monospaced span in the connection info panel
      await expect(
        page.locator("span.font-mono").filter({ hasText: "appUI008" }),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("should show step indicator with 8 numbered circles", async ({
    browser,
  }) => {
    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto(`/backend/airtable-import/${sessionId}`);
      // The StepIndicator renders 8 circles (h-7 w-7 divs) numbered 1–8
      const circles = page.locator(".flex.h-7.w-7");
      await expect(circles).toHaveCount(8);
      // Current step label is shown below the indicator
      await expect(page.getByText("Połączenie", { exact: true })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("should navigate to step 2 on Dalej click", async ({ browser }) => {
    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto(`/backend/airtable-import/${sessionId}`);
      await expect(
        page.getByText("Krok 1: Połączenie z Airtable"),
      ).toBeVisible();
      await page.getByRole("button", { name: /Dalej/i }).click();
      await expect(page.getByText("Krok 2: Analiza bazy")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("should show error for non-existent session", async ({ browser }) => {
    const ctx = await getAuthContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto(
        "/backend/airtable-import/00000000-0000-0000-0000-000000000000",
      );
      // When session is not found the page shows this error via ErrorMessage component
      await expect(page.getByText("Nie udało się załadować sesji")).toBeVisible(
        { timeout: 10_000 },
      );
    } finally {
      await ctx.close();
    }
  });
});
