import { test, expect } from '@playwright/test';
import { login, DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-087: unsaved DataTable column widths must not carry over to a different
 * account signing in on the same browser tab (#4185).
 *
 * The live/unsaved column widths are persisted in a browser-local perspective
 * snapshot keyed only by tableId, so before the fix they were shared by every
 * account that logged in on the same browser profile — one account's resize
 * leaked to whoever logged in next (a different tenant in the report). The purge
 * is anchored to the identity the backend shell actually renders for
 * (AuthSessionGuard), with the login form purging on submit as well, so a fresh
 * login always starts without the previous account's explicit widths — including when
 * the form is submitted before its client handler has hydrated, which is how
 * this test failed on loaded ephemeral shards while passing on the standalone
 * lane.
 *
 * Self-contained: creates two companies so the grid has rows, drives the real
 * DataTable on `/backend/customers/companies`, exercises the real login form for
 * the account switch, and deletes the fixtures in teardown.
 */
test.describe('TC-CRM-087: unsaved column widths cleared on login', () => {
  test('a different account logging in through the form sees default widths, not the previous account\'s resize', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    const companyIds: string[] = [];
    const prefix = `QA TC-CRM-087 ${Date.now()}`;
    const perspectiveStoragePrefix = 'om_table_perspective_snapshot:';

    const handleColumnWidth = (handle: import('@playwright/test').Locator) =>
      handle.evaluate((el) => Math.round((el.closest('th') as HTMLElement).getBoundingClientRect().width));
    const handleColumnInlineWidth = (handle: import('@playwright/test').Locator) =>
      handle.evaluate((el) => (el.closest('th') as HTMLElement).style.width);
    const perspectiveStorageKeys = () =>
      page.evaluate((storagePrefix) => Object.keys(localStorage).filter((key) => key.startsWith(storagePrefix)), perspectiveStoragePrefix);

    const waitForTableReady = async () => {
      await page.getByText('Loading table', { exact: false })
        .waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });
    };

    // Second data-column resize handle — avoids the (potentially sticky) first column.
    const handleAt = () => page.locator('thead [role="separator"][aria-orientation="vertical"]').nth(1);

    // Same gesture hardening TC-CRM-086 already carries. The header keeps
    // reflowing after the first row paints — remaining rows land, the query
    // refetches, the local perspective snapshot hydrates — and a re-render
    // during the drag unmounts the handle, which cancels the drag by design
    // (`dragCleanupRef` in DataTable). So wait for the width to hold steady
    // across two samples, and re-drag from a fresh baseline when a gesture is
    // swallowed. Without this the test fails on a loaded CI shard whenever the
    // table happens to refetch inside the drag.
    const waitForSettledColumnWidth = async () => {
      let previous = -1;
      let settled = -1;
      await expect
        .poll(async () => {
          const current = await handleColumnWidth(handleAt());
          const isStable = current === previous;
          previous = current;
          if (isStable) settled = current;
          return isStable;
        }, { timeout: 15_000, intervals: [200, 200, 300, 500] })
        .toBe(true);
      return settled;
    };

    const dragHandleRight = async (deltaX: number) => {
      const handle = handleAt();
      const origin = await handle.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await handle.dispatchEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: origin.x,
        clientY: origin.y,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
      });
      await page.evaluate(({ x, y, dx }) => {
        document.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: x + dx,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }));
        document.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: x + dx,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }));
      }, { x: origin.x, y: origin.y, dx: deltaX });
    };

    const widenedBy = async (baseline: number) => {
      try {
        await expect
          .poll(() => handleColumnWidth(handleAt()), { timeout: 3_000, intervals: [100, 100, 200, 300] })
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

      // -- 1) admin widens a column; the width persists across a reload -----------
      await login(page, 'admin');
      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });
      await waitForTableReady();

      await expect(handleAt()).toBeAttached();

      const defaultWidth = await widenTargetColumn(130);
      await expect
        .poll(() => handleColumnWidth(handleAt()), { timeout: 5_000, message: 'dragging the handle should widen the column' })
        .toBeGreaterThan(defaultWidth + 80);
      const resizedInlineWidth = await handleColumnInlineWidth(handleAt());
      expect(resizedInlineWidth).toMatch(/^\d+px$/);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      await expect
        .poll(() => handleColumnInlineWidth(handleAt()), {
          message: 'the resized width should survive a reload for the account that set it',
        })
        .toBe(resizedInlineWidth);
      await expect.poll(perspectiveStorageKeys).not.toEqual([]);

      // -- 2) log out, then sign in as a DIFFERENT account through the real form --
      // The login helper uses an API fast-path that bypasses the form; the fix
      // fires in the login form's submit handler, so the account switch must go
      // through the actual form to exercise it.
      await page.request.post('/api/auth/logout').catch(() => {});
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 10_000 }).catch(() => {});

      const employee = DEFAULT_CREDENTIALS.employee;
      await page.getByLabel('Email').fill(employee.email);
      const passwordInput = page.getByLabel('Password', { exact: true }).first();
      await passwordInput.fill(employee.password);
      await passwordInput.press('Enter');
      await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout: 15_000 });
      await expect
        .poll(perspectiveStorageKeys, {
          message: 'successful login must purge the previous account\'s browser-local perspective snapshots',
        })
        .toEqual([]);

      // -- 3) the employee table starts without the previous explicit width -------
      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      await expect
        .poll(() => handleColumnInlineWidth(handleAt()), {
          message: 'a different account must not inherit the previous account\'s unsaved column width',
        })
        .toBe('');
    } finally {
      for (const id of companyIds) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', id);
      }
    }
  });
});
