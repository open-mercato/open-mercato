import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-012: Currency & exchange-rate list Delete routes through the guarded mutation
 * Covers: the DELETE write paths refactored in PR #3438 (fixes #3191) — the currencies
 * (`backend/currencies/page.tsx`) and exchange-rates (`backend/exchange-rates/page.tsx`)
 * row-action deletes now run through `useGuardedMutation(...).runMutation(...)`.
 *
 * This is the committed follow-up requested by the `om-auto-verify-pr-ui` run on #3438,
 * which exercised these flows with a throwaway spec.
 *
 * Asserted behavior: both delete row-actions route through the guard, the page shows its
 * success flash, and the record is gone from the list API. These asserts used to expect the
 * error flash because the UI sends the record `id` in the request body while the routes read
 * it only from `?id=`; #3566 made both routes read the id from the body as well.
 */

// The currencies/exchange-rates lists re-render their rows as data settles
// (optimistic-lock headers, scope version), which can detach the portalled row
// actions menu mid-click. Bound each click and retry across a few attempts so a
// swallowed keypress or a detached element can't hang the run. Mirrors the
// resilience pattern in TC-CUR-004 / TC-ADMIN-002.
async function clickRowDelete(page: Page, openMenu: () => Promise<void>): Promise<void> {
  const deleteItem = page.getByRole('menuitem').filter({ hasText: /^Delete$/ }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const alreadyOpen = await deleteItem.isVisible().catch(() => false);
    if (!alreadyOpen) await openMenu();
    const opened = await deleteItem
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) continue;
    if (await deleteItem.click({ timeout: 5_000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('Could not click the Delete menu item for the target row.');
}

function makeMenuOpener(row: Locator): () => Promise<void> {
  const actionsButton = row.getByRole('button', { name: 'Open actions' });
  return async () => {
    await actionsButton.click({ timeout: 5_000 }).catch(async () => {
      await actionsButton.focus();
      await actionsButton.press('Enter');
    });
  };
}

test.describe('TC-CUR-012: Currency & exchange-rate Delete routes through the guarded mutation', () => {
  test('currency list Delete routes through the guard and surfaces the success flash', async ({ page, request }) => {
    // Login + list navigation + portalled-menu retries do not fit the default 30s
    // budget under parallel CI shard load; 60s matches the other UI specs (TC-CUR-004).
    test.setTimeout(60_000);

    let token: string | null = null;
    let currencyId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-CUR-012 Currency',
      });
      currencyId = currency.id;

      await login(page, 'admin');
      await page.goto('/backend/currencies');

      // Match the code cell exactly — substring matching on the whole row collides
      // when a random code appears inside a seeded currency name (see TC-CUR-004).
      const row = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: currency.code, exact: true }),
      });
      await expect(row).toBeVisible({ timeout: 10_000 });

      await clickRowDelete(page, makeMenuOpener(row));

      const confirmButton = page.getByRole('button', { name: 'Confirm' });
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();

      await expect(page.getByText('Currency deleted successfully').first()).toBeVisible({
        timeout: 10_000,
      });

      // The delete went through: the currency is gone from the list API.
      await expect
        .poll(
          async () => {
            const response = await apiRequest(
              request,
              'GET',
              `/api/currencies/currencies?code=${encodeURIComponent(currency.code)}&pageSize=10`,
              { token: token as string },
            );
            const body = (await response.json()) as { items?: Array<{ id: string }> };
            return body.items?.some((item) => item.id === currencyId) ?? false;
          },
          { timeout: 10_000 },
        )
        .toBe(false);
    } finally {
      // Best-effort teardown in case the UI delete did not go through.
      await deleteCurrenciesEntityIfExists(
        request,
        token,
        '/api/currencies/currencies',
        currencyId,
      ).catch(() => {});
    }
  });

  test('exchange-rate list Delete routes through the guard and surfaces the success flash', async ({ page, request }) => {
    test.setTimeout(60_000);

    let token: string | null = null;
    let fromId: string | null = null;
    let toId: string | null = null;
    let rateId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const from = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-012 From' });
      fromId = from.id;
      const to = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-012 To' });
      toId = to.id;

      // A unique source so we can locate the row deterministically, and a far-future
      // date so it sorts to the top of page 1 (the list defaults to date DESC) — neither
      // the random pair nor the seeded rows can shadow it.
      const source = `QA-TC-CUR-012-${from.code}${to.code}`;
      const createResponse = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: from.code,
          toCurrencyCode: to.code,
          rate: '1.2345',
          date: '2999-12-31T12:00:00.000Z',
          source,
        },
      });
      expect(createResponse.status(), 'exchange-rate fixture create').toBe(201);
      rateId = ((await createResponse.json()) as { id?: string }).id ?? null;
      expect(rateId).toBeTruthy();

      await login(page, 'admin');
      await page.goto('/backend/exchange-rates');

      // The pair cell renders "FROM → TO"; identify the row by the unique source string.
      const row = page.getByRole('row').filter({ hasText: source });
      await expect(row).toBeVisible({ timeout: 10_000 });

      await clickRowDelete(page, makeMenuOpener(row));

      const confirmButton = page.getByRole('button', { name: 'Confirm' });
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();

      await expect(page.getByText('Exchange rate deleted successfully').first()).toBeVisible({
        timeout: 10_000,
      });

      // The delete went through: the rate is gone from the list API.
      await expect
        .poll(
          async () => {
            const response = await apiRequest(
              request,
              'GET',
              `/api/currencies/exchange-rates?source=${encodeURIComponent(source)}&pageSize=10`,
              { token: token as string },
            );
            const body = (await response.json()) as { items?: Array<{ id: string }> };
            return body.items?.some((item) => item.id === rateId) ?? false;
          },
          { timeout: 10_000 },
        )
        .toBe(false);
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId).catch(() => {});
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromId).catch(() => {});
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toId).catch(() => {});
    }
  });
});
