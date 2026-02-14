import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { getAuthToken, apiRequest } from '../helpers/api';

/**
 * TC-ADMIN-005: Create Feature Toggle
 * Source: .ai/qa/scenarios/TC-ADMIN-005-feature-toggle-create.md
 *
 * Verifies that a new feature toggle can be created by a superadmin.
 * The test creates a Boolean toggle and verifies it appears in the list.
 *
 * Navigation: Settings → Feature Toggles → Global → Create
 */
test.describe('TC-ADMIN-005: Create Feature Toggle', () => {
  test('should create a boolean feature toggle and show it in the list', async ({ page, request }) => {
    const timestamp = Date.now();
    const toggleId = `qa_test_toggle_${timestamp}`;
    const toggleName = `QA Test Toggle ${timestamp}`;
    let token: string | null = null;

    try {
      token = await getAuthToken(request, 'superadmin');
      await login(page, 'superadmin');

      // Navigate to feature toggles
      await page.goto('/backend/feature-toggles/global');
      await expect(page.getByRole('heading', { name: 'Feature Toggles', level: 2 })).toBeVisible();
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

      // Verify table columns
      await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Identifier' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();

      // Click Create
      await page.getByRole('link', { name: 'Create' }).click();
      await expect(page).toHaveURL(/\/backend\/feature-toggles\/global\/create$/);
      await expect(page.getByText('Create Feature Toggle')).toBeVisible();

      // Fill Basic Information — fields are textboxes in order: Identifier, Name, Description, Category
      const textboxes = page.locator('main').getByRole('textbox');
      await textboxes.nth(0).fill(toggleId);
      await textboxes.nth(1).fill(toggleName);
      await textboxes.nth(2).fill('QA test toggle for TC-ADMIN-005');
      await textboxes.nth(3).fill('qa_tests');

      // Select Type
      await page.locator('main').getByRole('combobox').selectOption('Boolean');

      // Wait for Default Value section to update
      await page.waitForTimeout(500);

      // Save
      await page.getByRole('button', { name: 'Save' }).first().click();

      // Wait for save to complete — page may redirect or stay
      await page.waitForTimeout(2_000);

      // Navigate to list and verify the toggle appears
      await page.goto('/backend/feature-toggles/global');
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await expect(page.getByText(toggleId)).toBeVisible({ timeout: 5_000 });
    } finally {
      // Cleanup via API
      if (token) {
        const listResponse = await apiRequest(request, 'GET', '/api/feature-toggles/global', { token });
        const listData = await listResponse.json().catch(() => null);
        if (listData && Array.isArray(listData.items)) {
          const toggleToDelete = listData.items.find(
            (item: Record<string, unknown>) => item.identifier === toggleId,
          );
          if (toggleToDelete && typeof toggleToDelete.id === 'string') {
            await apiRequest(request, 'DELETE', `/api/feature-toggles/global?id=${toggleToDelete.id}`, { token }).catch(() => {});
          }
        }
      }
    }
  });
});
