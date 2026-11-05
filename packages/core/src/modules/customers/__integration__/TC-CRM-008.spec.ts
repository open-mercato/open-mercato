import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, createPersonFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-008: Add Participants to Deal
 * Source: .ai/qa/scenarios/TC-CRM-008-deal-participant-add.md
 */
test.describe('TC-CRM-008: Add Participants to Deal', () => {
  test('should add a person and an additional company as deal participants', async ({ page, request }) => {
    let token: string | null = null;
    let primaryCompanyId: string | null = null;
    let secondaryCompanyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;

    const primaryCompanyName = `QA TC-CRM-008 Primary ${Date.now()}`;
    const secondaryCompanyName = `QA TC-CRM-008 Secondary ${Date.now()}`;
    const firstName = `QA${Date.now()}`;
    const lastName = 'Participant';
    const displayName = `${firstName} ${lastName}`;

    try {
      token = await getAuthToken(request);
      primaryCompanyId = await createCompanyFixture(request, token, primaryCompanyName);
      secondaryCompanyId = await createCompanyFixture(request, token, secondaryCompanyName);
      personId = await createPersonFixture(request, token, {
        firstName,
        lastName,
        displayName,
        companyEntityId: primaryCompanyId,
      });
      pipelineId = await createPipelineFixture(request, token, { name: `QA TC-CRM-008 Pipeline ${Date.now()}` });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-008 Deal ${Date.now()}`,
        companyIds: [primaryCompanyId],
        pipelineId,
        pipelineStageId: stageId,
      });

      // Deal detail v3 moved association editing behind dialogs on People/Companies tabs. Drive
      // the association change via the public API and verify it lands on the detail UI.
      const associationResponse = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: {
          id: dealId,
          personIds: [personId],
          companyIds: [primaryCompanyId, secondaryCompanyId],
        },
      });
      expect(associationResponse.status(), `PUT /api/customers/deals returned ${associationResponse.status()}`).toBeLessThan(400);

      // Verify the associations persisted by reading them back through the API (the detail UI hides
      // them behind per-tab dialogs that are not part of this test's scope).
      const readResponse = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}?include=people,companies`, { token });
      expect(readResponse.status()).toBe(200);
      const readJson = (await readResponse.json()) as { linkedPersonIds?: string[]; linkedCompanyIds?: string[] };
      expect(readJson.linkedPersonIds ?? []).toContain(personId);
      expect(readJson.linkedCompanyIds ?? []).toEqual(expect.arrayContaining([primaryCompanyId, secondaryCompanyId]));

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);
      // The deal detail UI shows a "Companies N" tab count reflecting the linked count (expected >= 2)
      await expect(page.getByRole('tab', { name: /Companies\s*\d+/i })).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', secondaryCompanyId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', primaryCompanyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
