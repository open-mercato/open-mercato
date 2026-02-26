import { test, expect } from "@playwright/test";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";

/**
 * TC-AIMP-003: Get session status and mapping
 *
 * Verifies the status and mapping GET endpoints return correct shape
 * for a freshly created session.
 */
test.describe("TC-AIMP-003: Get session status and mapping", () => {
  let token: string;
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, "admin");
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: {
          airtableToken: "pat_status_test",
          airtableBaseId: "appSTATUS001",
        },
      },
    );
    const body = await res.json();
    sessionId = body.id;
  });

  test.afterAll(async ({ request }) => {
    await apiRequest(
      request,
      "DELETE",
      `/api/airtable_import/sessions/${sessionId}`,
      { token },
    ).catch(() => {});
  });

  test("should return session status with all required fields", async ({
    request,
  }) => {
    const res = await apiRequest(
      request,
      "GET",
      `/api/airtable_import/sessions/${sessionId}/status`,
      { token },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.id).toBe(sessionId);
    expect(body.status).toBe("draft");
    expect(body.currentStep).toBe(1);
    expect(body.airtableBaseId).toBe("appSTATUS001");
    expect(body).toHaveProperty("mappingJson");
    expect(body).toHaveProperty("configJson");
    expect(body).toHaveProperty("progressJson");
    expect(body).toHaveProperty("reportJson");
  });

  test("should return 404 for unknown session id", async ({ request }) => {
    const res = await apiRequest(
      request,
      "GET",
      "/api/airtable_import/sessions/00000000-0000-0000-0000-000000000000/status",
      { token },
    );
    expect(res.status()).toBe(404);
  });

  test("should return mapping endpoint with null mapping for new session", async ({
    request,
  }) => {
    const res = await apiRequest(
      request,
      "GET",
      `/api/airtable_import/sessions/${sessionId}/mapping`,
      { token },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty("mapping");
    expect(body).toHaveProperty("schema");
    expect(body).toHaveProperty("currentStep");
  });
});
