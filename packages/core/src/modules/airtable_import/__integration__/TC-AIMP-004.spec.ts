import { test, expect } from "@playwright/test";
import {
  getAuthToken,
  apiRequest,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";

/**
 * TC-AIMP-004: Update session mapping
 *
 * Verifies that PUT /api/airtable_import/sessions/:id/mapping accepts
 * a valid mapping payload and persists it, and that invalid payloads
 * are rejected with 400.
 */
test.describe("TC-AIMP-004: Update session mapping", () => {
  let token: string;
  let sessionId: string;

  const validMapping = {
    mapping: {
      tables: [
        {
          airtableTableId: "tblQA001",
          airtableTableName: "QA Test Table",
          targetModule: "customers.people",
          targetEntitySlug: null,
          confidence: 85,
          skip: false,
          fieldMappings: [
            {
              airtableFieldId: "fldQA001",
              airtableFieldName: "Name",
              airtableFieldType: "singleLineText",
              omFieldKey: "display_name",
              omFieldType: "text",
              isMappedToCreatedAt: false,
              isMappedToUpdatedAt: false,
              skip: false,
              sampleValues: ["John Doe", "Jane Smith"],
            },
            {
              airtableFieldId: "fldQA002",
              airtableFieldName: "Email",
              airtableFieldType: "email",
              omFieldKey: "email",
              omFieldType: "text",
              isMappedToCreatedAt: false,
              isMappedToUpdatedAt: false,
              skip: false,
              sampleValues: ["john@example.com"],
            },
          ],
        },
      ],
    },
  };

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, "admin");
    const res = await apiRequest(
      request,
      "POST",
      "/api/airtable_import/sessions",
      {
        token,
        data: {
          airtableToken: "pat_mapping_test",
          airtableBaseId: "appMAPPING001",
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

  test("should save valid mapping and advance step", async ({ request }) => {
    const res = await apiRequest(
      request,
      "PUT",
      `/api/airtable_import/sessions/${sessionId}/mapping`,
      {
        token,
        data: validMapping,
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it was persisted
    const statusRes = await apiRequest(
      request,
      "GET",
      `/api/airtable_import/sessions/${sessionId}/status`,
      { token },
    );
    const status = await statusRes.json();
    expect(status.currentStep).toBeGreaterThanOrEqual(4);
    expect(status.mappingJson).not.toBeNull();
    expect(status.mappingJson.tables[0].airtableTableId).toBe("tblQA001");
  });

  test("should reject mapping with missing required table fields", async ({
    request,
  }) => {
    const res = await apiRequest(
      request,
      "PUT",
      `/api/airtable_import/sessions/${sessionId}/mapping`,
      {
        token,
        data: { mapping: { tables: [{ airtableTableId: "tbl001" }] } },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("should reject empty body", async ({ request }) => {
    const res = await apiRequest(
      request,
      "PUT",
      `/api/airtable_import/sessions/${sessionId}/mapping`,
      {
        token,
        data: {},
      },
    );
    expect(res.status()).toBe(400);
  });
});
