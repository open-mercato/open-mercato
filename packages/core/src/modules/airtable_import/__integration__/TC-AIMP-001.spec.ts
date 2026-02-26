import { test, expect } from "@playwright/test";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";

/**
 * TC-AIMP-001: List import sessions
 *
 * Verifies that the sessions list endpoint returns a list response
 * and that newly created sessions appear in the list.
 */
test.describe("TC-AIMP-001: List import sessions", () => {
  let token: string;
  let createdSessionId: string | null = null;

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
  });

  test("should return session list with items array", async ({ request }) => {
    const res = await apiRequest(
      request,
      "GET",
      "/api/airtable_import/sessions",
      { token },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBeTruthy();
  });

  test("should include record count fields on each item", async ({
    request,
  }) => {
    const createRes = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: {
          airtableToken: "test_token_list",
          airtableBaseId: "appLIST001",
        },
      },
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    createdSessionId = created.id;

    const listRes = await apiRequest(
      request,
      "GET",
      "/api/airtable_import/sessions",
      { token },
    );
    const body = await listRes.json();
    const found = body.items.find(
      (s: { id: string }) => s.id === createdSessionId,
    );
    expect(found).toBeDefined();
    expect(found.airtableBaseId).toBe("appLIST001");
    expect(found).toHaveProperty("recordsTotal");
    expect(found).toHaveProperty("recordsDone");
    expect(found).toHaveProperty("status");
    expect(found).toHaveProperty("currentStep");
  });
});
