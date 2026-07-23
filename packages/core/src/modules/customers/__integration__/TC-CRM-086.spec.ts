import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-086: DataTable interactive column resize + width persistence (#1835).
 *
 * A column header exposes a right-edge drag handle. Dragging it widens the
 * column, the new width survives a full page reload (persisted in the local
 * perspective snapshot), and double-clicking the handle resets the column back
 * to its auto width.
 *
 * Self-contained: creates two companies so the grid has rows, drives the real
 * DataTable on `/backend/customers/companies`, and deletes the fixtures in
 * teardown.
 */
test.describe('TC-CRM-086: DataTable column resize + persistence', () => {
  test('drag-resizes a column, persists the width across reload, and resets on double-click', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    const companyIds: string[] = [];
    const prefix = `QA TC-CRM-086 ${Date.now()}`;

    // Width of the resize handle's own column header (the `<th>` it lives in).
    const handleColumnWidth = (handle: import('@playwright/test').Locator) =>
      handle.evaluate((el) => Math.round((el.closest('th') as HTMLElement).getBoundingClientRect().width));

    const waitForTableReady = async () => {
      await page.getByText('Loading table', { exact: false })
        .waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });
    };

    // The resize handles are rendered on every data column header; target the
    // second one so we never land on a (potentially sticky) first column.
    const handleAt = () => page.locator('thead [role="separator"][aria-orientation="vertical"]').nth(1);

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
      await waitForTableReady();

      const handle = handleAt();
      await expect(handle).toBeAttached();
      const before = await handleColumnWidth(handle);

      // -- Drag the handle right by ~130px → the column widens --------------------
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 130, cy, { steps: 10 });
      await page.mouse.up();

      const after = await handleColumnWidth(handle);
      expect(after, 'dragging the handle should widen the column').toBeGreaterThan(before + 80);

      // -- The width survives a full reload (persisted, not saved as a view) -----
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      const afterReload = await handleColumnWidth(handleAt());
      expect(afterReload, 'the resized width should survive a page reload').toBeGreaterThan(before + 80);

      // -- Double-click resets the column back to its auto width ------------------
      await handleAt().dblclick();
      await expect
        .poll(async () => handleColumnWidth(handleAt()), { timeout: 5_000 })
        .toBeLessThan(afterReload - 60);
    } finally {
      for (const id of companyIds) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', id);
      }
    }
  });

  test('does not render resize handles on a table without perspectives', async ({ page }) => {
    // Column resize is gated on the perspective config (#1835): tables that opt
    // out of perspectives (settings, sub-tables, portal, audit logs) must not get
    // a handle, so widths never silently reset on reload for them. The audit-log
    // grid is a stable no-perspective backoffice table.
    await login(page, 'admin');
    await page.goto('/backend/logs', { waitUntil: 'domcontentloaded' });
    await page.locator('thead th').first().waitFor({ state: 'visible', timeout: 10_000 });

    await expect(page.getByRole('button', { name: /Perspektywy|Perspectives/i })).toHaveCount(0);
    await expect(page.locator('thead [role="separator"][aria-orientation="vertical"]')).toHaveCount(0);
  });
});
