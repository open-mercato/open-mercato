import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createApiKeyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/apiKeysFixtures';

async function openApiKeysPage(page: import('@playwright/test').Page): Promise<void> {
  const searchInput = page.getByRole('textbox', { name: 'Search' });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/backend/api-keys', { waitUntil: 'domcontentloaded' });
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    if (await searchInput.isVisible().catch(() => false)) {
      return;
    }

    const retryButton = page.getByRole('button', { name: /Try again/i }).first();
    if (await retryButton.isVisible().catch(() => false)) {
      await retryButton.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      if (await searchInput.isVisible().catch(() => false)) {
        return;
      }
    }
  }

  await expect(searchInput).toBeVisible({ timeout: 10_000 });
}

async function clickDeleteMenuItem(
  page: import('@playwright/test').Page,
  openMenu: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openMenu();
    const deleteMenuItem = page.getByRole('menuitem').filter({ hasText: /^Delete$/ }).first();
    const opened = await deleteMenuItem.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false);
    if (!opened) {
      continue;
    }
    const clicked = await deleteMenuItem.click().then(() => true).catch(() => false);
    if (clicked) {
      return;
    }
  }

  throw new Error('Could not click the Delete menu item for the API key row.');
}

/**
 * TC-ADMIN-002: Revoke API Key
 * Source: .ai/qa/scenarios/TC-ADMIN-002-api-key-revocation.md
 *
 * Verifies that an existing API key can be revoked.
 * Creates a key via API fixture, then revokes it through the UI.
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
      const created = await createApiKeyFixture(request, token, keyName);
      keyId = created.id;

      await login(page, 'admin');
      await openApiKeysPage(page);

      // Search for the key
      await page.getByRole('textbox', { name: 'Search' }).fill(keyName);
      await expect(page.getByText(keyName)).toBeVisible({ timeout: 5_000 });

      // Find and click the row actions for this key — look for a revoke/delete button
      const keyRow = page.locator('table tbody tr').filter({ hasText: keyName }).first();
      await expect(keyRow).toBeVisible();

      const openRowActions = async (): Promise<void> => {
        const actionsButton = keyRow.getByRole('button', { name: 'Open actions' });
        await expect(actionsButton).toBeVisible({ timeout: 5_000 });
        await actionsButton.click().catch(async () => {
          await actionsButton.focus();
          await actionsButton.press('Enter');
        });
        const deleteMenuItem = page.getByRole('menuitem').filter({ hasText: /^Delete$/ }).first();
        if (await deleteMenuItem.isVisible().catch(() => false)) {
          return;
        }
        await actionsButton.focus().catch(() => {});
        await actionsButton.press('Enter').catch(() => {});
        if (await deleteMenuItem.isVisible().catch(() => false)) {
          return;
        }
        await actionsButton.press('Space').catch(() => {});
      };

      await clickDeleteMenuItem(page, openRowActions);

      // Confirm deletion in the dialog
      const confirmButton = page.getByRole('button', { name: 'Confirm' });
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      // Wait for the dialog to close, then verify the key is removed from the list
      await expect(page.getByRole('alertdialog')).not.toBeVisible({ timeout: 5_000 });
      await expect(page.locator('table').getByText(keyName)).not.toBeVisible({ timeout: 5_000 });
    } finally {
      // Cleanup via API
      if (token && keyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token }).catch(() => {});
      }
    }
  });
});
