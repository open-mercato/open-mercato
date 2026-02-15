import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { apiRequest, getAuthToken } from '../helpers/api';

/**
 * TC-SALES-013: Sales Channel Config
 * Source: .ai/qa/scenarios/TC-SALES-013-sales-channel-config.md
 */
test.describe('TC-SALES-013: Sales Channel Config', () => {
  test.setTimeout(30_000);

  test('should create and update a sales channel in UI', async ({ page, request }) => {
    const base = Date.now();
    const name = `QA Channel ${base}`;
    const updatedName = `QA Channel Updated ${base}`;
    const code = `qa-channel-${base}`;
    let token: string | null = null;
    let channelId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/sales/channels');
      await page.getByRole('link', { name: /Add channel/i }).click();

      const createForm = page.locator('form').first();
      await createForm.getByRole('textbox').nth(0).fill(name);
      await createForm.getByRole('textbox').nth(1).fill(code);
      await page.getByRole('button', { name: /Create channel|Create/i }).last().click();

      await expect(page).toHaveURL(/\/backend\/sales\/channels$/i);
      const searchInput = page.getByRole('textbox', { name: /Search channels/i });
      await searchInput.fill(name);
      await searchInput.press('Enter');
      await expect(page.getByText(name, { exact: true })).toBeVisible();

      await page.getByText(name, { exact: true }).click();
      await expect(page).toHaveURL(/\/backend\/sales\/channels\/[0-9a-f-]{36}\/edit$/i);
      channelId = page.url().match(/\/backend\/sales\/channels\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;
      const editForm = page.locator('form').first();
      await editForm.getByRole('textbox').nth(0).fill(updatedName);
      await page.getByRole('button', { name: /Save changes|Update|Save/i }).last().click();

      await expect(page).toHaveURL(/\/backend\/sales\/channels$/i);
      await searchInput.fill(updatedName);
      await searchInput.press('Enter');
      await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
    } finally {
      if (token && channelId) {
        await apiRequest(request, 'DELETE', `/api/sales/channels?id=${encodeURIComponent(channelId)}`, { token }).catch(() => {});
      }
    }
  });
});
