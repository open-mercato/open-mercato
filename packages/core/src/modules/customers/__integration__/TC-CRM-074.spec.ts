import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-074: Person detail clean navigation guard
 *
 * Opening a person detail page must not mark the form dirty by normalizing
 * empty API values during initialization. Leaving the untouched page should
 * navigate normally without a native beforeunload prompt or app alertdialog.
 */
test.describe('TC-CRM-074: Person detail clean navigation guard', () => {
  test('leaves an untouched person detail page without an unsaved-changes prompt', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let personId: string | null = null;
    let nativeDialogOpened = false;
    const displayName = `QA TC-CRM-074 Person ${Date.now()}`;

    page.on('dialog', async (dialog) => {
      nativeDialogOpened = true;
      await dialog.dismiss().catch(() => {});
    });

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: 'Guard',
        displayName,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(750);

      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/backend/customers/people';
        link.textContent = 'Leave person detail';
        link.setAttribute('data-testid', 'person-detail-clean-leave-link');
        document.body.appendChild(link);
      });

      await page.getByTestId('person-detail-clean-leave-link').click();

      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      expect(nativeDialogOpened).toBe(false);
      await expect(page).toHaveURL(/\/backend\/customers\/people(?:\?.*)?$/);
      await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
