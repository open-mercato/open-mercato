import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { getAuthToken } from '../helpers/api';
import { createDealFixture, createPersonFixture, deleteEntityIfExists } from '../helpers/crmFixtures';

/**
 * TC-CRM-019: Deal Association Remove And Undo
 */
test.describe('TC-CRM-019: Deal Association Remove And Undo', () => {
  test('should remove a linked person from deal and restore via undo', async ({ page, request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;
    const personDisplayName = `QA TC-CRM-019 Person ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TCCRM019${Date.now()}`,
        displayName: personDisplayName,
      });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-019 Deal ${Date.now()}`,
        personIds: [personId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      const removeButtonName = `Remove ${personDisplayName}`;
      await expect(page.getByRole('button', { name: removeButtonName, exact: true })).toBeVisible();
      await page.getByRole('button', { name: removeButtonName, exact: true }).click();
      await page.getByRole('button', { name: /Update deal/ }).click();

      await expect(page.getByRole('button', { name: removeButtonName, exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
      await expect(page.getByRole('button', { name: removeButtonName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
