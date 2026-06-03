import { expect, test } from '@playwright/test';
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-004: Set Base Currency from UI
 * Covers: PUT /api/currencies/currencies (set isBase via list row action)
 *
 * Regression test for a bug where handleSetBase called PUT /api/currencies
 * (missing /currencies suffix), resulting in a 404.
 */
test.describe('TC-CUR-004: Set Base Currency from UI', () => {
  test('should set a non-base currency as base from the currencies list view', async ({ page, request }) => {
    // Login + list navigation + three sequential <=10s waits + fixture
    // setup/teardown does not fit the 30s budget under parallel CI shard load,
    // so the run was torn down mid-request ("Target page, context or browser
    // has been closed"). 60s matches the login+navigation convention used by
    // the other UI integration specs (TC-AI-001, TC-CRM-007, ...).
    test.setTimeout(60_000);

    let token: string | null = null;
    let currencyId: string | null = null;
    let originalBaseId: string | null = null;

    try {
      const authToken = await getAuthToken(request, 'admin');
      token = authToken;
      const { organizationId, tenantId } = getTokenContext(authToken);

      // Create a fixture currency
      const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const code = `B${randLetter()}${randLetter()}`;
      currencyId = await createCurrencyFixture(request, authToken, {
        code,
        name: 'QA TC-CUR-004 Target Currency',
      });

      // Record the current base currency so we can restore it
      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/currencies/currencies?isBase=true&pageSize=1',
        { token: authToken },
      );
      const listBody = (await listResponse.json()) as { items?: Array<{ id: string }> };
      originalBaseId = listBody.items?.[0]?.id ?? null;

      // Navigate to currencies list page
      await login(page, 'admin');
      await page.goto('/backend/currencies');

      // Wait for the table to load and find our fixture row. Match the
      // code cell exactly — substring matching on the whole row collides
      // when a random code (e.g. "BRI") appears inside a seeded currency
      // name (e.g. "British Pound").
      const row = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: code, exact: true }),
      });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Open row actions menu (focus + Enter, same pattern as TC-ADMIN-002).
      const actionsButton = row.getByRole('button', { name: 'Open actions' });
      await expect(actionsButton).toBeEnabled({ timeout: 10_000 });
      await actionsButton.focus();
      await actionsButton.press('Enter');

      // The "Set as base" menu item is portalled to document.body. If the
      // trigger swallows the Enter keypress before hydration finishes, the
      // menu never opens and clicking the item would auto-wait until the test
      // timeout. Wait for the item with a bounded budget and fall back to a
      // pointer click to open the menu, so a missed keypress can't hang the run.
      const setBaseItem = page.getByRole('menuitem').filter({ hasText: /Set as Base/ }).first();
      await expect(setBaseItem)
        .toBeVisible({ timeout: 5_000 })
        .catch(async () => {
          await actionsButton.click();
          await expect(setBaseItem).toBeVisible({ timeout: 5_000 });
        });
      await setBaseItem.click();

      await expect(page.getByText('Base currency updated successfully').first()).toBeVisible({
        timeout: 10_000,
      });

      await expect
        .poll(
          async () => {
            const response = await apiRequest(
              request,
              'GET',
              `/api/currencies/currencies?isBase=true&code=${encodeURIComponent(code)}&pageSize=10`,
              { token: authToken },
            );
            const body = (await response.json()) as { items?: Array<{ id: string }> };
            return body.items?.some((item) => item.id === currencyId) ?? false;
          },
          { timeout: 10_000 }
        )
        .toBe(true);
    } finally {
      // Best-effort teardown: if the test body already failed/timed out the
      // request context may be closing, so swallow teardown errors instead of
      // masking the real failure with "Target page, context or browser has
      // been closed".
      if (token && originalBaseId) {
        await apiRequest(request, 'PUT', '/api/currencies/currencies', {
          token,
          data: { id: originalBaseId, isBase: true },
        }).catch(() => {});
      }
      await deleteCurrenciesEntityIfExists(
        request,
        token,
        '/api/currencies/currencies',
        currencyId,
      ).catch(() => {});
    }
  });
});
