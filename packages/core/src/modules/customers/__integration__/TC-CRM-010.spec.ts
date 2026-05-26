import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-010: Record Customer Activity
 * Source: .ai/qa/scenarios/TC-CRM-010-activity-recording.md
 *
 * Deal detail v3 moved activity creation into an inline composer (no modal dialog). This test
 * exercises the public /api/customers/activities endpoint the composer drives, and then verifies
 * that the saved activity shows up on the deal detail timeline.
 */
test.describe('TC-CRM-010: Record Customer Activity', () => {
  test('should record a call activity on a deal timeline', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    const companyName = `QA TC-CRM-010 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-010 Deal ${Date.now()}`;
    const subject = `QA TC-CRM-010 Activity ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
      });

      const createResp = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          dealId,
          interactionType: 'call',
          title: subject,
          body: 'QA activity body for TC-CRM-010',
        },
      });
      expect(createResp.status(), `POST /api/customers/interactions returned ${createResp.status()}`).toBeLessThan(400);

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);
      await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
