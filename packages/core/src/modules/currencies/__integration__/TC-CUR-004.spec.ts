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
    test.setTimeout(30_000);

    let token: string | null = null;
    let currencyId: string | null = null;
    let originalBaseId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      // Create a fixture currency
      const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const code = `B${randLetter()}${randLetter()}`;
      currencyId = await createCurrencyFixture(request, token, {
        code,
        name: 'QA TC-CUR-004 Target Currency',
      });

      // Record the current base currency so we can restore it
      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/currencies/currencies?isBase=true&pageSize=1',
        { token },
      );
      const listBody = (await listResponse.json()) as { items?: Array<{ id: string }> };
      originalBaseId = listBody.items?.[0]?.id ?? null;

      // Navigate to currencies list page
      await login(page, 'admin');
      await page.goto('/backend/currencies');

      // Wait for the table to load and find our fixture row
      const row = page.getByRole('row').filter({ hasText: code });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Open row actions menu (focus + Enter, same pattern as TC-ADMIN-002)
      const actionsButton = row.getByRole('button', { name: 'Open actions' });
      await actionsButton.focus();
      await actionsButton.press('Enter');

      // Click the "Set as base" menu item (portalled to document.body)
      const setBaseItem = page.getByRole('menuitem').filter({ hasText: /Set as Base/ }).first();
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
              { token },
            );
            const body = (await response.json()) as { items?: Array<{ id: string }> };
            return body.items?.some((item) => item.id === currencyId) ?? false;
          },
          { timeout: 10_000 }
        )
        .toBe(true);
    } finally {
      // Restore original base currency if we changed it
      if (token && originalBaseId) {
        await apiRequest(request, 'PUT', '/api/currencies/currencies', {
          token,
          data: { id: originalBaseId, isBase: true },
        });
      }
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
    }
  });
});
