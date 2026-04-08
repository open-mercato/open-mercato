import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-030: DataTable Bulk Delete
 * Verifies that selecting rows via checkboxes and executing bulk delete
 * removes the selected records with a confirmation dialog.
 */
test.describe('TC-CRM-030: DataTable Bulk Delete', () => {
  test('should bulk delete selected companies via checkbox selection', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    const companyIds: string[] = [];
    const prefix = `QA TC-CRM-030 ${Date.now()}`;

    try {
      token = await getAuthToken(request);

      for (let i = 0; i < 2; i++) {
        const createResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
          token,
          data: { displayName: `${prefix} Co${i}` },
        });
        expect(createResponse.ok()).toBeTruthy();
        const body = (await readJsonSafe<{ id?: unknown }>(createResponse)) ?? {};
        const id = typeof body.id === 'string' ? body.id : null;
        expect(id).toBeTruthy();
        companyIds.push(id!);
      }

      await login(page, 'admin');
      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });

      const searchInput = page.getByPlaceholder(/Search by name/i);
      await searchInput.fill(prefix);
      await page.waitForTimeout(1200);
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      const selectAllCheckbox = page.locator('thead').getByRole('checkbox');
      await expect(selectAllCheckbox).toBeVisible();
      await selectAllCheckbox.check();

      const deleteButton = page.getByRole('button', { name: /Delete selected/i });
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();

      const confirmDialog = page.getByRole('alertdialog');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: /Delete|Confirm/i }).click();

      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/customers/companies?search=${encodeURIComponent(prefix)}&pageSize=20`,
              { token: token! },
            );
            if (!listResponse.ok()) return -1;
            const payload = (await readJsonSafe<{ items?: unknown[] }>(listResponse)) ?? {};
            return Array.isArray(payload.items) ? payload.items.length : -1;
          },
          { timeout: 15000 },
        )
        .toBe(0);

      companyIds.length = 0;
    } finally {
      for (const id of companyIds) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', id);
      }
    }
  });
});
