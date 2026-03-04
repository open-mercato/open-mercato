import { test, expect } from "@playwright/test";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";

/**
 * TC-AIMP-002: Create import session
 *
 * Verifies that POST /api/airtable_import/sessions creates a session
 * with draft status (verified via status endpoint), and that invalid
 * payloads are rejected with 400.
 */
test.describe("TC-AIMP-002: Create import session", () => {
  let token: string;
  const createdIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, "admin");
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdIds) {
      await apiRequest(
        request,
        "DELETE",
        `/api/airtable_import/sessions/${id}`,
        { token },
      ).catch(() => {});
    }
  });

  test("should create a session and return its id with status 201", async ({
    request,
  }) => {
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: {
          airtableToken: "pat_test_token_001",
          airtableBaseId: "appCREATE001",
        },
      },
    );
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(typeof body.id).toBe("string");
    createdIds.push(body.id);

    // Verify session is draft via status endpoint
    const statusRes = await apiRequest(
      request,
      "GET",
      `/api/airtable_import/sessions/${body.id}/status`,
      { token },
    );
    const status = await statusRes.json();
    expect(status.status).toBe("draft");
    expect(status.currentStep).toBe(1);
    expect(status.airtableBaseId).toBe("appCREATE001");
  });

  test("should reject missing airtableToken", async ({ request }) => {
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: { airtableBaseId: "appCREATE002" },
      },
    );
    expect(res.status()).toBe(400);
  });

  test("should reject missing airtableBaseId", async ({ request }) => {
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: { airtableToken: "pat_test_token_001" },
      },
    );
    expect(res.status()).toBe(400);
  });

  test("should reject empty token", async ({ request }) => {
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: { airtableToken: "", airtableBaseId: "appCREATE003" },
      },
    );
    expect(res.status()).toBe(400);
  });
});
