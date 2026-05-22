import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-039: Object-history icon on Person detail header
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 1
 *
 * Verifies that the Object-history utility icon appears in the bespoke
 * PersonDetailHeader and opens the Version History panel scoped to the person.
 */
test.describe('TC-CRM-039: Person header exposes Object-history icon', () => {
  test('shows Version History icon and opens the history panel from the person detail header', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    const stamp = Date.now();
    const companyName = `QA TC-CRM-039 Co ${stamp}`;
    const personName = `QA TC-CRM-039 Person ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC039-${stamp}`,
        displayName: personName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: personName, exact: true })).toBeVisible({ timeout: 15000 });

      const historyButton = page.getByRole('button', { name: 'Version History' });
      await expect(historyButton).toBeVisible();

      await historyButton.click();

      await expect(page.getByRole('dialog', { name: 'Version History' })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
