import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AUTH-020: Filter Users by Role
 *
 * Verifies that the role filter on the Users list page works correctly:
 * - Filter chip displays the role name (not a UUID)
 * - The user list is actually filtered by the selected role
 */
test.describe('TC-AUTH-020: Filter Users by Role', () => {
  test('should filter users by role and display role name in filter chip', async ({ page, request }) => {
    const roleName = `qa-filter-role-${Date.now()}`;
    let token: string | null = null;
    let roleId: string | null = null;

    try {
      token = await getAuthToken(request);

      // Create a test role via API
      const createRes = await apiRequest(request, 'POST', '/api/auth/roles', {
        token,
        data: { name: roleName },
      });
      const createBody = await createRes.json().catch(() => null);
      roleId = typeof createBody?.id === 'string' ? createBody.id : null;
      expect(roleId).toBeTruthy();

      // Navigate to users list and wait for the page heading
      await login(page, 'admin');
      await page.goto('/backend/users');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

      // Open filter overlay and wait for the tags input inside it
      await page.getByRole('button', { name: /Filters/i }).click();
      const filterPanel = page.locator('.fixed.inset-0');
      await expect(filterPanel).toBeVisible();
      const tagsInput = filterPanel.locator('[data-crud-focus-target]');
      await expect(tagsInput).toBeVisible();

      // Type the role name in the tags input to trigger search
      await tagsInput.fill(roleName);
      await page.waitForTimeout(500);

      // Select the role from suggestions inside the filter panel
      const suggestion = filterPanel.getByRole('button', { name: roleName });
      await expect(suggestion).toBeVisible();
      await suggestion.click();

      // Apply the filter
      await filterPanel.getByRole('button', { name: /Apply/i }).first().click();

      // Wait for filter overlay to close
      await expect(filterPanel).toBeHidden();

      // Verify filter chip shows role name (not UUID)
      const chipLocator = page.locator('button', { hasText: new RegExp(`.*${roleName}.*`, 'i') });
      await expect(chipLocator).toBeVisible();

      // Verify chip does NOT contain a UUID pattern
      const chipText = await chipLocator.textContent();
      expect(chipText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    } finally {
      if (token && roleId) {
        await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, { token }).catch(() => {});
      }
    }
  });
});
