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

    const waitForTableReady = async () => {
      await page.getByText('Loading table', { exact: false })
        .waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });
    };

    const targetHeader = () =>
      page.locator('thead th:has([role="separator"][aria-orientation="vertical"])').first();
    const resizeHandle = () => targetHeader().getByRole('separator');
    const targetColumnWidth = () =>
      targetHeader().evaluate((el) => Math.round((el as HTMLElement).getBoundingClientRect().width));

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

      const handle = resizeHandle();
      await expect(handle).toBeAttached();
      const before = await targetColumnWidth();

      // -- Drag the handle right by ~130px → the column widens --------------------
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 130, cy, { steps: 10 });
      await page.mouse.up();

      const after = await targetColumnWidth();
      expect(after, 'dragging the handle should widen the column').toBeGreaterThan(before + 80);

      // -- The width survives a full reload (persisted, not saved as a view) -----
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      const afterReload = await targetColumnWidth();
      expect(afterReload, 'the resized width should survive a page reload').toBeGreaterThan(before + 80);

      // -- Double-click resets the column back to its auto width ------------------
      await resizeHandle().dblclick();
      await expect
        .poll(targetColumnWidth, { timeout: 5_000 })
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
