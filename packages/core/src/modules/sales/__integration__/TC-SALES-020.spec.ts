import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { createSalesDocument } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

const WIDGET_LOAD_TIMEOUT = 10_000;

/**
 * TC-SALES-020: Document History Widget on Order
 * Verifies the History tab is present on an order detail page, that the
 * widget renders history entries, and that the Filters dropdown controls
 * which entry kinds are visible.
 */
test.describe('TC-SALES-020: Document History Widget', () => {

  test('should render history tab and allow filtering entries on an order', async ({ page }) => {
    await login(page, 'admin');
    const orderId = await createSalesDocument(page, { kind: 'order' });

    // Navigate explicitly to ensure a full server-side page load so injection widgets initialise
    await page.goto(`/backend/sales/documents/${orderId}?kind=order`);

    // The document-history widget is injected as a "History" tab on order detail pages
    const historyButton = page.getByRole('button', { name: 'History', exact: true });
    await historyButton.scrollIntoViewIfNeeded();
    await expect(historyButton).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT });
    await historyButton.click();  
    await page.waitForTimeout(500);
    // The filter dropdown button should always be present once the widget mounts
    const filterButton = page.getByRole('button', { name: /Filters/i });
    await expect(filterButton).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT });

    // Wait for the loading spinner to disappear before asserting content
    await expect(page.getByText(/No history entries yet/i).or(
      page.locator('.relative.flex.gap-3').first()
    )).toBeVisible({ timeout: WIDGET_LOAD_TIMEOUT }).catch(() => {});

    // History entries should be visible — order creation logs at least one action entry
    await expect(page.getByText(/No history entries yet/i)).toHaveCount(0, { timeout: WIDGET_LOAD_TIMEOUT });

    // --- Filter dropdown interactions ---

    // Open the Filters dropdown
    await filterButton.click();
    const filterMenu = page.getByRole('listbox', { name: /Filters/i });
    await expect(filterMenu).toBeVisible();

    // All four filter options should be present
    await expect(filterMenu.getByRole('option', { name: /^All$/i })).toBeVisible();
    await expect(filterMenu.getByRole('option', { name: /Status changes/i })).toBeVisible();
    await expect(filterMenu.getByRole('option', { name: /^Actions$/i })).toBeVisible();
    await expect(filterMenu.getByRole('option', { name: /^Comments$/i })).toBeVisible();

    // "All" should be the default selected option
    await expect(filterMenu.getByRole('option', { name: /^All$/i })).toHaveAttribute('aria-selected', 'true');

    // Select "Actions" — the dropdown should close
    await filterMenu.getByRole('option', { name: /^Actions$/i }).click();
    await expect(filterMenu).toBeHidden();

    // The filter button label should reflect the active filter
    await expect(page.getByRole('button', { name: /Filters/i }).filter({ hasText: /Actions/i })).toBeVisible();

    // Re-open and reset to "All"
    await page.getByRole('button', { name: /Filters/i }).click();
    const filterMenuReopened = page.getByRole('listbox', { name: /Filters/i });
    await expect(filterMenuReopened).toBeVisible();

    // "Actions" should now be selected
    await expect(filterMenuReopened.getByRole('option', { name: /^Actions$/i })).toHaveAttribute('aria-selected', 'true');

    await filterMenuReopened.getByRole('option', { name: /^All$/i }).click();
    await expect(filterMenuReopened).toBeHidden();

    // The active filter suffix should be gone — button shows just "Filters"
    await expect(page.getByRole('button', { name: /^Filters$/i })).toBeVisible();
  });
});
