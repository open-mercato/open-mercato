import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { apiRequest, getAuthToken } from '../helpers/api';

/**
 * TC-ADMIN-008: Create Custom Entity Record
 * Source: .ai/qa/scenarios/TC-ADMIN-008-custom-entity-record.md
 */
test.describe('TC-ADMIN-008: Create Custom Entity Record', () => {
  test('should create and edit a record for a custom entity', async ({ page, request }) => {
    const stamp = Date.now();
    const location = `QA Location ${stamp}`;
    const title = `QA Title ${stamp}`;
    const updatedTitle = `${title} Updated`;
    let token: string | null = null;
    let recordId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/entities/user/example%3Acalendar_entity/records');

      await expect(page.getByRole('heading', { name: /Records: example:calendar_entity/i })).toBeVisible();
      await page.getByRole('link', { name: 'Create' }).click();

      await expect(page).toHaveURL(/\/backend\/entities\/user\/example%3Acalendar_entity\/records\/create$/);
      await page.getByRole('textbox').nth(0).fill(location);
      await page.getByRole('textbox').nth(2).fill(title);
      await page.getByRole('textbox').nth(3).fill('2026-02-14');
      await page.getByRole('button', { name: 'Save' }).first().click();

      await expect(page).toHaveURL(/\/backend\/entities\/user\/example%3Acalendar_entity\/records$/);
      await expect(page.getByRole('row', { name: new RegExp(location, 'i') })).toBeVisible();

      await page.getByRole('row', { name: new RegExp(location, 'i') }).click();
      await expect(page).toHaveURL(/\/backend\/entities\/user\/example%3Acalendar_entity\/records\/[^/]+$/);
      recordId =
        page.url().match(/\/backend\/entities\/user\/example%3Acalendar_entity\/records\/([^/?#]+)$/i)?.[1] ??
        null;

      await page.getByRole('textbox').nth(2).fill(updatedTitle);
      await page.getByRole('button', { name: 'Save' }).first().click();

      await expect(page).toHaveURL(/\/backend\/entities\/user\/example%3Acalendar_entity\/records$/);
      await expect(page.getByRole('row', { name: new RegExp(updatedTitle, 'i') })).toBeVisible();
    } finally {
      if (token && recordId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/entities/records?entityId=${encodeURIComponent('example:calendar_entity')}&recordId=${encodeURIComponent(recordId)}`,
          { token },
        ).catch(() => {});
      }
    }
  });
});
