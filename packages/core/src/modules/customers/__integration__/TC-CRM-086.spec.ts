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

    // The header keeps reflowing after the first row paints (remaining rows land,
    // the local perspective snapshot hydrates). Grabbing the handle mid-reflow
    // makes the pointer miss the box captured a moment earlier, and a re-render
    // during the drag unmounts the handle, which cancels the drag by design — so
    // wait for the width to hold steady across two samples before measuring.
    const waitForSettledColumnWidth = async () => {
      let previous = -1;
      let settled = -1;
      await expect
        .poll(async () => {
          const current = await targetColumnWidth();
          const isStable = current === previous;
          previous = current;
          if (isStable) settled = current;
          return isStable;
        }, { timeout: 15_000, intervals: [200, 200, 300, 500] })
        .toBe(true);
      return settled;
    };

    const dragHandleRight = async (deltaX: number) => {
      const box = await resizeHandle().boundingBox();
      expect(box).not.toBeNull();
      const originX = box!.x + box!.width / 2;
      const originY = box!.y + box!.height / 2;
      await page.mouse.move(originX, originY);
      await page.mouse.down();
      await page.mouse.move(originX + deltaX, originY, { steps: 10 });
      await page.mouse.up();
    };

    const widenedBy = async (baseline: number) => {
      try {
        await expect
          .poll(targetColumnWidth, { timeout: 3_000, intervals: [100, 100, 200, 300] })
          .toBeGreaterThan(baseline + 80);
        return true;
      } catch {
        return false;
      }
    };

    // Returns the baseline the successful gesture started from, so the caller
    // asserts against the width the drag actually built on.
    const widenTargetColumn = async (deltaX: number) => {
      let baseline = await waitForSettledColumnWidth();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await dragHandleRight(deltaX);
        if (await widenedBy(baseline)) return baseline;
        if (attempt < 3) baseline = await waitForSettledColumnWidth();
      }
      return baseline;
    };

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

      await expect(resizeHandle()).toBeAttached();

      // -- Drag the handle right by ~130px → the column widens --------------------
      const before = await widenTargetColumn(130);
      await expect
        .poll(targetColumnWidth, { timeout: 5_000, message: 'dragging the handle should widen the column' })
        .toBeGreaterThan(before + 80);

      // -- The width survives a full reload (persisted, not saved as a view) -----
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      await expect
        .poll(targetColumnWidth, { timeout: 10_000, message: 'the resized width should survive a page reload' })
        .toBeGreaterThan(before + 80);
      const afterReload = await waitForSettledColumnWidth();

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
