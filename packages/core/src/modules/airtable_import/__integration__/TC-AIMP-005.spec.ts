import { test, expect } from "@playwright/test";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";

/**
 * TC-AIMP-005: Delete import session
 *
 * Verifies that DELETE removes the session and subsequent GET returns 404.
 */
test.describe("TC-AIMP-005: Delete import session", () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, "admin");
  });

  test("should delete a session and return 404 on subsequent fetch", async ({
    request,
  }) => {
    const createRes = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: {
          airtableToken: "pat_delete_test",
          airtableBaseId: "appDELETE001",
        },
      },
    );
    expect(createRes.ok()).toBeTruthy();
    const { id } = await createRes.json();

    const deleteRes = await apiRequest(
      request,
      "DELETE",
      `/api/airtable_import/sessions/${id}`,
      { token },
    );
    expect(deleteRes.ok()).toBeTruthy();

    const fetchRes = await apiRequest(
      request,
      "GET",
      `/api/airtable_import/sessions/${id}/status`,
      { token },
    );
    expect(fetchRes.status()).toBe(404);
  });

  test("should return 404 when deleting a non-existent session", async ({
    request,
  }) => {
    const res = await apiRequest(
      request,
      "DELETE",
      "/api/airtable_import/sessions/00000000-0000-0000-0000-000000000000",
      { token },
    );
    expect(res.status()).toBe(404);
  });
});
