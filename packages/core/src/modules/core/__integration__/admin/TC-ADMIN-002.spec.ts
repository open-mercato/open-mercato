import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createApiKeyFixture } from '@open-mercato/core/helpers/integration/apiKeysFixtures';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

async function waitForApiKeysTable(page: Page): Promise<void> {
  await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
}

async function openApiKeysPage(page: import('@playwright/test').Page): Promise<void> {
  const searchInput = page.getByRole('searchbox', { name: 'Search', exact: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/backend/api-keys', { waitUntil: 'domcontentloaded' });
    await waitForApiKeysTable(page).catch(() => {});

    if (await searchInput.isVisible().catch(() => false)) {
      await waitForApiKeysTable(page);
      return;
    }

    const retryButton = page.getByRole('button', { name: /Try again/i }).first();
    if (await retryButton.isVisible().catch(() => false)) {
      await retryButton.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await waitForApiKeysTable(page).catch(() => {});
      if (await searchInput.isVisible().catch(() => false)) {
        await waitForApiKeysTable(page);
        return;
      }
    }
  }

  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await waitForApiKeysTable(page);
}

async function searchApiKeyRow(page: Page, keyName: string): Promise<Locator> {
  const searchInput = page.getByRole('searchbox', { name: 'Search', exact: true });
  const keyRow = page.locator('table tbody tr').filter({ hasText: keyName }).first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await searchInput.fill(keyName);
    await waitForApiKeysTable(page).catch(() => {});
    if (await keyRow.isVisible().catch(() => false)) {
      return keyRow;
    }

    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitForApiKeysTable(page).catch(() => {});
  }

  await expect(keyRow).toBeVisible({ timeout: 15_000 });
  return keyRow;
}

async function clickDeleteMenuItem(
  page: Page,
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
    test.slow();

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
      const keyRow = await searchApiKeyRow(page, keyName);
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
