import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-020: Deal Note And Activity Creation
 *
 * Deal detail v3 replaced the modal activity dialog with an inline composer, and the note flow
 * moved into a tabbed NotesSection. This test exercises the canonical public APIs and verifies
 * the created records render on the deal detail page.
 */
test.describe('TC-CRM-020: Deal Note And Activity Creation', () => {
  test('should add a deal note and log a deal activity', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-020 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TCCRM020${Date.now()}`,
        displayName: `QA TC-CRM-020 Person ${Date.now()}`,
        companyEntityId: companyId,
      });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-020 Deal ${Date.now()}`,
        companyIds: [companyId],
        personIds: [personId],
      });

      const noteText = `QA deal note ${Date.now()}`;
      const activitySubject = `QA deal activity ${Date.now()}`;

      const noteResp = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: { entityId: companyId, dealId, body: noteText },
      });
      expect(noteResp.status(), `POST /api/customers/comments returned ${noteResp.status()}`).toBeLessThan(400);

      const activityResp = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          dealId,
          interactionType: 'call',
          title: activitySubject,
          body: 'QA deal activity description',
        },
      });
      expect(activityResp.status(), `POST /api/customers/interactions returned ${activityResp.status()}`).toBeLessThan(400);

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);
      await expect(page.getByText(activitySubject).first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole('tab', { name: /Notes/i }).click().catch(() => {});
      await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
