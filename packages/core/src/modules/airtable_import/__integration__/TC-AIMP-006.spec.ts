import { test, expect } from "@playwright/test";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";

/**
 * TC-AIMP-006: Access control — RBAC enforcement
 *
 * Verifies that unauthenticated requests and employee role are blocked
 * from managing import sessions, while admin role has full access.
 */
test.describe("TC-AIMP-006: Access control", () => {
  let adminToken: string;
  let employeeToken: string;
  let createdSessionId: string | null = null;

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, "admin");
    employeeToken = await getAuthToken(request, "employee");
  });

  test.afterAll(async ({ request }) => {
    if (createdSessionId) {
      await apiRequest(
        request,
        "DELETE",
        `/api/airtable_import/sessions/${createdSessionId}`,
        { token: adminToken },
      ).catch(() => {});
    }
  });

  test("should return 401 for unauthenticated list request", async ({
    request,
  }) => {
    const res = await request.get(
      `${process.env.BASE_URL || "http://localhost:3000"}/api/airtable_import/sessions`,
    );
    expect(res.status()).toBe(401);
  });

  test("should return 401 for unauthenticated create request", async ({
    request,
  }) => {
    const res = await request.post(
      `${process.env.BASE_URL || "http://localhost:3000"}/api/airtable_import/sessions`,
      {
        data: { airtableToken: "pat_unauth", airtableBaseId: "appUNAUTH001" },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status()).toBe(401);
  });

  test("should return 403 for employee role on create", async ({ request }) => {
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token: employeeToken,
        data: { airtableToken: "pat_employee", airtableBaseId: "appEMPL001" },
      },
    );
    expect([401, 403]).toContain(res.status());
  });

  test("should allow admin to create a session", async ({ request }) => {
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token: adminToken,
        data: { airtableToken: "pat_admin_rbac", airtableBaseId: "appRBAC001" },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    createdSessionId = body.id;
  });
});
