import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-SALES-013: Sales Channel Config
 * Source: .ai/qa/scenarios/TC-SALES-013-sales-channel-config.md
 */
test.describe('TC-SALES-013: Sales Channel Config', () => {
  test('should create and update a sales channel in UI', async ({ page }) => {
    const base = Date.now();
    const name = `QA Channel ${base}`;
    const updatedName = `QA Channel Updated ${base}`;
    const code = `qa-channel-${base}`;

    await login(page, 'admin');
    await page.goto('/backend/sales/channels');
    await page.getByRole('link', { name: /Add channel/i }).click();

    const createForm = page.locator('form').first();
    await createForm.getByRole('textbox').nth(0).fill(name);
    await createForm.getByRole('textbox').nth(1).fill(code);
    await page.getByRole('button', { name: /Create channel|Create/i }).last().click();

    await expect(page).toHaveURL(/\/backend\/sales\/channels$/i);
    await page.getByRole('textbox', { name: /Search channels/i }).fill(name);
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.getByText(name, { exact: true }).click();
    const editForm = page.locator('form').first();
    await editForm.getByRole('textbox').nth(0).fill(updatedName);
    await page.getByRole('button', { name: /Save changes|Update|Save/i }).last().click();

    await expect(page).toHaveURL(/\/backend\/sales\/channels$/i);
    await page.getByRole('textbox', { name: /Search channels/i }).fill(updatedName);
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
  });
});
