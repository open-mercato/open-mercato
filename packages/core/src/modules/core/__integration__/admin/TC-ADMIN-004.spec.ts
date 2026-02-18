import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-ADMIN-004: Manage Dictionary Entries
 * Source: .ai/qa/scenarios/TC-ADMIN-004-dictionary-management.md
 *
 * Verifies that the dictionaries page loads, shows existing dictionaries
 * with their entries, and allows creating a new dictionary.
 *
 * Navigation: Settings → Module Configuration → Dictionaries
 */
test.describe('TC-ADMIN-004: Dictionary Management', () => {
  test('should display dictionaries and allow creating a new one', async ({ page, request }) => {
    let token: string | null = null;
    let dictionaryId: string | null = null;
    let dictionaryKey: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/config/dictionaries');

      // Verify page heading
      await expect(page.getByRole('heading', { name: 'Dictionaries', level: 2 })).toBeVisible();

      // Wait for loading
      await page.getByText('Loading dictionaries').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

      // Verify the "New dictionary" button is available
      await expect(page.getByRole('button', { name: 'New dictionary' })).toBeVisible();

      // The first dictionary should be auto-selected — verify its details panel
      await expect(page.getByText('Manage reusable values and appearance')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add entry' })).toBeVisible();

      // Verify the entries table columns
      await expect(page.getByRole('columnheader', { name: 'Value' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Label' })).toBeVisible();

      // Create a new dictionary
      await page.getByRole('button', { name: 'New dictionary' }).click();

      // Verify the dialog appears
      await expect(page.getByRole('heading', { name: 'Create dictionary', level: 2 })).toBeVisible({ timeout: 5_000 });

      // Fill in the Key field (slug)
      const timestamp = Date.now();
      const dictKey = `qa_tc_admin_004_${timestamp}`;
      const dictName = `QA TC-ADMIN-004 ${timestamp}`;
      dictionaryKey = dictKey;
      await page.getByRole('textbox', { name: 'slug_name' }).fill(dictKey);

      // Fill in the Name field
      await page.getByRole('textbox', { name: 'Display name' }).fill(dictName);

      // Submit
      await page.getByRole('button', { name: 'Save' }).click();

      // Verify the new dictionary appears in the sidebar list
      await expect(page.getByText(dictName)).toBeVisible({ timeout: 5_000 });
    } finally {
      if (token && dictionaryKey) {
        const listResponse = await apiRequest(request, 'GET', '/api/dictionaries', { token }).catch(() => null);
        if (listResponse && listResponse.ok()) {
          const listData = (await listResponse.json().catch(() => null)) as { items?: Array<{ id?: string; key?: string }> } | null;
          dictionaryId = listData?.items?.find((item) => item.key === dictionaryKey)?.id ?? null;
        }
      }
      if (token && dictionaryId) {
        await apiRequest(request, 'DELETE', `/api/dictionaries/${encodeURIComponent(dictionaryId)}`, { token }).catch(() => {});
      }
    }
  });
});
