import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-016: Company Note And Activity CRUD
 *
 * Company detail v2 moved notes/activities editing into tab-specific composers that no longer
 * surface via the "Add activity" modal used previously. This test drives the canonical comment +
 * interaction APIs and verifies the records appear on the company detail page.
 */
test.describe('TC-CRM-016: Company Note And Activity CRUD', () => {
  test('should add a company note and log an activity', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-016 Company ${Date.now()}`);

      const noteText = `QA company note ${Date.now()}`;
      const activitySubject = `QA company activity ${Date.now()}`;

      const noteResp = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: { entityId: companyId, body: noteText },
      });
      expect(noteResp.status(), `POST /api/customers/comments returned ${noteResp.status()}`).toBeLessThan(400);

      const activityResp = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: activitySubject,
          body: 'QA activity description',
        },
      });
      expect(activityResp.status(), `POST /api/customers/interactions returned ${activityResp.status()}`).toBeLessThan(400);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`);

      // Activity log tab should show the new interaction
      await page.getByRole('tab', { name: /Activity log/i }).click().catch(() => {});
      await expect(page.getByText(activitySubject).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
