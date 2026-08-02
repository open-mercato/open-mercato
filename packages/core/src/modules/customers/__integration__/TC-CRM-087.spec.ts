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
 * leaked to whoever logged in next (a different tenant in the report). The fix
 * purges every perspective snapshot when a new identity signs in through the
 * login form, so a fresh login always starts from the default, auto-computed
 * widths.
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

    const waitForTableReady = async () => {
      await page.getByText('Loading table', { exact: false })
        .waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });
    };

    const targetHeader = () =>
      page.locator('thead th:has([role="separator"][aria-orientation="vertical"])').first();
    const handleAt = () => targetHeader().getByRole('separator');
    const targetColumnWidth = () =>
      targetHeader().evaluate((element) => Math.round((element as HTMLElement).getBoundingClientRect().width));

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

      const handle = handleAt();
      await expect(handle).toBeAttached();
      const defaultWidth = await targetColumnWidth();

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
      await page.evaluate(({ x, y }) => {
        document.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: x + 130,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }));
        document.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: x + 130,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }));
      }, origin);

      const widened = await targetColumnWidth();
      expect(widened, 'dragging the handle should widen the column').toBeGreaterThan(defaultWidth + 80);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      expect(
        await targetColumnWidth(),
        'the resized width should survive a reload for the account that set it',
      ).toBeGreaterThan(defaultWidth + 80);

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
      await page.locator('form[data-auth-ready="1"]').evaluate((form) =>
        (form as HTMLFormElement).requestSubmit());
      await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout: 15_000 });

      // -- 3) the employee gets the default width — no carry-over ----------------
      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      expect(
        await targetColumnWidth(),
        'a different account must not inherit the previous account\'s unsaved column width',
      ).toBeLessThan(defaultWidth + 60);
    } finally {
      for (const id of companyIds) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', id);
      }
    }
  });
});
