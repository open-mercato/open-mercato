import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures';

const WIDGET_LOAD_TIMEOUT = 10_000;

/**
 * TC-SALES-020: Document History Widget
 * Verifies the History tab renders all 3 entry kinds (action, status, comment)
 * and that each Filters dropdown option correctly scopes visible entries.
 *
 * Fixtures created via API (no reliance on seeded demo data):
 *   - Order creation  → 'action' entry (sales.orders.create command log)
 *   - Note creation   → 'comment' entry (SalesNote, source: note)
 *   - Status update   → 'status' entry (command bus before/after snapshot diff)
 */
test.describe('TC-SALES-020: Document History Widget', () => {
  test('should show action, status, and comment entries and filter each kind correctly', async ({ page }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(page.request, 'admin');
    let orderId: string | null = null;

    try {
      // 1. Create order → logs an 'action' entry via sales.orders.create command
      orderId = await createSalesOrderFixture(page.request, token);

      // 2. Create a note → produces a 'comment' entry (SalesNote, source: 'note')
      await apiRequest(page.request, 'POST', '/api/sales/notes', {
        token,
        data: { contextType: 'order', contextId: orderId, body: 'QA test history comment' },
      });

      // 3. Update order status → produces a 'status' entry via command-bus before/after snapshots
      const statusListRes = await apiRequest(page.request, 'GET', '/api/sales/order-statuses?pageSize=5', { token });
      expect(statusListRes.ok(), 'Failed to load order statuses').toBeTruthy();
      const statusList = (await statusListRes.json()) as { items?: Array<{ id: string }> };
      const statusId = statusList.items?.[0]?.id;
      expect(statusId, 'No order statuses are seeded — cannot produce a status history entry').toBeTruthy();
      await apiRequest(page.request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, statusEntryId: statusId },
      });

      // --- Navigate to order detail page ---
      await login(page, 'admin');
      await page.goto(`/backend/sales/documents/${orderId}?kind=order`);
      await page.waitForLoadState('domcontentloaded');

      // Open History tab
      const historyButton = page.getByRole('button', { name: 'History', exact: true });
      await expect(historyButton).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT });
      await historyButton.scrollIntoViewIfNeeded();
      await historyButton.click();

      const filterButton = page.getByRole('button', { name: /Filters/i });
      await expect(filterButton).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT });

      // Wait for at least one timeline entry to be visible
      await expect(page.locator('.relative.flex.gap-3').first()).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT });
      await expect(page.getByText(/No history entries yet/i)).toHaveCount(0);

      // --- Verify all 4 filter options are present ---
      await filterButton.click();
      const filterMenu = page.getByRole('listbox', { name: /Filters/i });
      await expect(filterMenu).toBeVisible();
      await expect(filterMenu.getByRole('option', { name: /^All$/i })).toBeVisible();
      await expect(filterMenu.getByRole('option', { name: /Status changes/i })).toBeVisible();
      await expect(filterMenu.getByRole('option', { name: /^Actions$/i })).toBeVisible();
      await expect(filterMenu.getByRole('option', { name: /^Comments$/i })).toBeVisible();
      await filterMenu.getByRole('option', { name: /^All$/i }).click();
      await expect(filterMenu).toBeHidden();

      // Helper: apply a filter and assert at least one entry is visible
      const assertKindHasEntries = async (optionName: string | RegExp, label: string) => {
        await page.getByRole('button', { name: /Filters/i }).click();
        const menu = page.getByRole('listbox', { name: /Filters/i });
        await expect(menu).toBeVisible();
        await menu.getByRole('option', { name: optionName }).click();
        await expect(menu).toBeHidden();
        await expect(
          page.getByText(/No history entries yet/i),
          `"${label}" filter shows empty state — expected at least one entry`,
        ).toHaveCount(0, { timeout: WIDGET_LOAD_TIMEOUT });
        await expect(
          page.locator('.relative.flex.gap-3').first(),
          `"${label}" filter shows no timeline items`,
        ).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT });
      };

      // Each of the 3 entry kinds must be present as real data
      await assertKindHasEntries(/^Actions$/i, 'Actions');
      await assertKindHasEntries(/Status changes/i, 'Status changes');
      await assertKindHasEntries(/^Comments$/i, 'Comments');

      // --- Reset to All and verify label clears ---
      await page.getByRole('button', { name: /Filters/i }).click();
      const resetMenu = page.getByRole('listbox', { name: /Filters/i });
      await expect(resetMenu).toBeVisible();
      await resetMenu.getByRole('option', { name: /^All$/i }).click();
      await expect(resetMenu).toBeHidden();
      await expect(page.getByRole('button', { name: /^Filters$/i })).toBeVisible();
    } finally {
      await deleteSalesEntityIfExists(page.request, token, '/api/sales/orders', orderId);
    }
  });
});
