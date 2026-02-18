import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-ADMIN-001: Create API Key
 * Source: .ai/qa/scenarios/TC-ADMIN-001-api-key-creation.md
 *
 * Verifies that API keys can be created from the create form,
 * that the generated key is shown once, and that the key appears
 * in the API keys list.
 *
 * Navigation: Settings → Auth → API Keys → Create
 */
test.describe('TC-ADMIN-001: Create API Key', () => {
  test('should create an API key and show it in the list', async ({ page, request }) => {
    const keyName = `QA TC-ADMIN-001 ${Date.now()}`;
    let token: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');

      // Navigate to API Keys via Settings
      await page.goto('/backend/api-keys');
      await expect(page.getByRole('heading', { name: 'API Keys', level: 2 })).toBeVisible();

      // Click Create
      await page.getByRole('link', { name: 'Create' }).click();
      await expect(page).toHaveURL(/\/backend\/api-keys\/create$/);
      await expect(page.getByText('Create API Key')).toBeVisible();

      // Fill in the name
      const nameField = page.locator('form').getByRole('textbox').first();
      await nameField.fill(keyName);

      // Click Create button
      await page.getByRole('button', { name: 'Create' }).last().click();

      // After creation, a dialog shows the generated key (one-time view)
      await expect(page.getByText('Keep this key safe')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/Prefix: omk_/)).toBeVisible();

      // Close the key dialog
      await page.getByRole('button', { name: 'Close' }).click();

      // Navigate back to list
      await page.goto('/backend/api-keys');
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

      // Search for the created key
      await page.getByRole('textbox', { name: 'Search' }).fill(keyName);
      await expect(page.getByText(keyName)).toBeVisible({ timeout: 5_000 });
    } finally {
      // Cleanup: try to delete the API key via API (best effort)
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
