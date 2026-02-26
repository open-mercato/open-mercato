import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-ADMIN-002: Revoke API Key
 * Source: .ai/qa/scenarios/TC-ADMIN-002-api-key-revocation.md
 *
 * Verifies that an existing API key can be revoked.
 * Creates a key via API, then revokes it through the UI.
 *
 * Navigation: Settings → Auth → API Keys
 */
test.describe('TC-ADMIN-002: Revoke API Key', () => {
  test('should revoke an existing API key', async ({ page, request }) => {
    const keyName = `QA TC-ADMIN-002 ${Date.now()}`;
    let token: string | null = null;
    let keyId: string | null = null;

    try {
      token = await getAuthToken(request);

      // Create an API key via the UI first
      await login(page, 'admin');
      await page.goto('/backend/api-keys/create');

      const nameField = page.locator('form').getByRole('textbox').first();
      await nameField.fill(keyName);
      await page.getByRole('button', { name: 'Create' }).last().click();

      // Wait for the key dialog
      await expect(page.getByText('Keep this key safe')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Close' }).click();

      // Navigate to API keys list
      await page.goto('/backend/api-keys');
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

      // Search for the key
      await page.getByRole('textbox', { name: 'Search' }).fill(keyName);
      await expect(page.getByText(keyName)).toBeVisible({ timeout: 5_000 });

      // Find and click the row actions for this key — look for a revoke/delete button
      const keyRow = page.locator('table tbody tr').filter({ hasText: keyName }).first();
      await expect(keyRow).toBeVisible();

      // Click the actions button on the row
      const actionsButton = keyRow.getByRole('button', { name: 'Open actions' });
      await actionsButton.click();

      // Click the Delete option in the dropdown menu
      const deleteMenuItem = page.getByRole('menuitem', { name: 'Delete' });
      await expect(deleteMenuItem).toBeVisible();
      await deleteMenuItem.click();

      // Confirm deletion in the dialog
      const confirmButton = page.getByRole('button', { name: 'Confirm' });
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      // Wait for the dialog to close, then verify the key is removed from the list
      await expect(page.getByRole('alertdialog')).not.toBeVisible({ timeout: 5_000 });
      await expect(page.locator('table').getByText(keyName)).not.toBeVisible({ timeout: 5_000 });
    } finally {
      // Cleanup via API
      if (token) {
        const listResponse = await apiRequest(request, 'GET', '/api/auth/api-keys', { token });
        const listData = await listResponse.json().catch(() => null);
        if (listData && Array.isArray(listData.items)) {
          const keyToDelete = listData.items.find((item: Record<string, unknown>) =>
            item.name === keyName,
          );
          if (keyToDelete && typeof keyToDelete.id === 'string') {
            await apiRequest(request, 'DELETE', `/api/auth/api-keys?id=${keyToDelete.id}`, { token }).catch(() => {});
          }
        }
      }
    }
  });
});
