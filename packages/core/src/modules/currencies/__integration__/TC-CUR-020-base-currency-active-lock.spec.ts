import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CUR-020: the edit form keeps the base currency active.
 *
 * Endpoints: GET/POST/DELETE /api/currencies/currencies; page /backend/currencies/[id].
 *
 * The existing base currency is only read, never changed. When the organization has no base
 * currency, the base fixture created here stays: a base currency cannot be un-flagged or deleted.
 */
test.describe('TC-CUR-020: base currency Active checkbox is locked', () => {
  test('disables Active on the base currency and keeps it editable on other currencies', async ({ page, request }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request, 'admin');
    const scope = getTokenContext(token);
    let fixtureId: string | null = null;

    try {
      const baseRes = await apiRequest(request, 'GET', '/api/currencies/currencies?isBase=true&pageSize=1', { token });
      expect(baseRes.status()).toBe(200);
      let baseId = ((await baseRes.json()) as { items?: Array<{ id: string }> }).items?.[0]?.id ?? null;
      if (!baseId) {
        const code = generateUniqueCurrencyCode();
        const created = await apiRequest(request, 'POST', '/api/currencies/currencies', {
          token,
          data: { ...scope, code, name: `QA TC-CUR-020 ${code}`, isBase: true },
        });
        expect(created.status()).toBe(201);
        baseId = ((await created.json()) as { id: string }).id;
      }

      const fixture = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-020 Non-base' });
      fixtureId = fixture.id;

      await login(page, 'admin');
      await page.goto(`/backend/currencies/${baseId}`);
      const baseActive = page.getByRole('checkbox', { name: 'Active', exact: true });
      await expect(baseActive).toBeVisible({ timeout: 15_000 });
      await expect(baseActive).toBeChecked();
      await expect(baseActive).toBeDisabled();
      await expect(page.getByText('The base currency must stay active.', { exact: false })).toBeVisible();

      await page.goto(`/backend/currencies/${fixtureId}`);
      const fixtureActive = page.getByRole('checkbox', { name: 'Active', exact: true });
      await expect(fixtureActive).toBeVisible({ timeout: 15_000 });
      await expect(fixtureActive).toBeEnabled();
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fixtureId).catch(() => {});
    }
  });
});
