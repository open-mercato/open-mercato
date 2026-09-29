import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { selectBestPrice, type PriceRow, type PricingContext } from '@open-mercato/core/modules/catalog/lib/pricing';

/**
 * TC-CAT-PRICES-001: Price-rule admin UI reaches the customer-group +
 * quantity-tier dimensions the API already supported (Pricing Engine spec,
 * `.ai/specs/2026-08-21-pricing-engine.md`, Phase 1 Implementation Plan
 * step 5).
 *
 * Creates a customer-group-scoped, quantity-tiered price row through the new
 * `/backend/catalog/prices/create` admin page (not the API directly — this
 * is the surface being tested), confirms every field the form exposes
 * round-trips through the real HTTP response, then feeds both the new row
 * and a plain baseline row into the real `selectBestPrice` resolver to prove
 * the more specific row wins for a matching context — exactly the outcome an
 * operator relies on once they've used this UI.
 *
 * Self-contained: creates its own product, price kind, and currency
 * fixtures and deletes them (and both price rows) in `finally`.
 */
const PRICES_PATH = '/api/catalog/prices';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

function uniqueStamp(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: { code: `qa_pr_${stamp}`, title: `QA Price Rule Kind ${stamp}` },
  });
  expect(response.status(), `price-kind fixture create should be 201`).toBe(201);
  return expectId(
    (await readJsonSafe<{ id?: string }>(response))?.id,
    'price-kind fixture should return an id',
  );
}

async function fetchPriceById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `${PRICES_PATH}?ids=${encodeURIComponent(id)}&pageSize=1`, { token });
  expect(response.status(), `read-back price ${id} failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response);
  const item = (body?.items ?? [])[0];
  expect(item, `price ${id} should be readable`).toBeTruthy();
  return item as Record<string, unknown>;
}

function toPriceRow(raw: Record<string, unknown>): PriceRow {
  const str = (camel: string, snake: string): string | undefined => {
    const value = raw[camel] ?? raw[snake];
    return typeof value === 'string' && value.length ? value : undefined;
  };
  const num = (camel: string, snake: string, fallback: number): number => {
    const value = raw[camel] ?? raw[snake];
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    id: str('id', 'id') ?? '',
    kind: str('kind', 'kind') ?? 'regular',
    minQuantity: num('minQuantity', 'min_quantity', 1),
    maxQuantity: raw.max_quantity != null || raw.maxQuantity != null ? num('maxQuantity', 'max_quantity', 1) : undefined,
    customerId: str('customerId', 'customer_id'),
    customerGroupId: str('customerGroupId', 'customer_group_id'),
    channelId: str('channelId', 'channel_id'),
    userId: str('userId', 'user_id'),
    userGroupId: str('userGroupId', 'user_group_id'),
  } as unknown as PriceRow;
}

/** Type a search term into a ComboboxInput field and click the rendered
 * option matching `optionName`. Every fixture in this suite is named with
 * its unique stamp, so searching by stamp always yields exactly one visible,
 * clickable suggestion — deterministic, and exercises the same search+click
 * path a real operator uses (unlike pasting a raw id: the component's
 * suggestion list is filtered against the option's *label*, so a pasted id
 * never renders as a visible match to click, even once fetched by exact-id
 * lookup — a real but separate finding, not exercised by this test). */
async function pickComboboxByText(page: Page, fieldId: string, query: string, optionName: string | RegExp): Promise<void> {
  const field = page.locator(`[data-crud-field-id="${fieldId}"]`);
  const input = field.getByRole('combobox');
  await input.click();
  await input.fill(query);
  // The suggestion popover is portaled out of the field's DOM subtree (DS
  // `Popover`, so it escapes clipping scroll ancestors) — the option is a
  // page-level element, not a descendant of `field`.
  await page.getByRole('option', { name: optionName }).first().click();
}

async function fillText(page: Page, fieldId: string, value: string): Promise<void> {
  await page.locator(`[data-crud-field-id="${fieldId}"] input`).fill(value);
}

test.describe('TC-CAT-PRICES-001: customer-group + quantity-tier price via the admin UI', () => {
  test('the created row outranks a plain price for a matching context', async ({ page, request }) => {
    // The admin default (20s) is tight for a dev-mode route Next.js has not
    // compiled yet, on top of five sequential combobox round-trips.
    test.setTimeout(90_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    // Search terms use only the numeric prefix: the full stamp contains an
    // underscore, and word-tokenized search matches a query as a prefix of a
    // single token — a query spanning the underscore boundary matches
    // nothing even though it is a real substring of the title.
    const searchStamp = stamp.split('_')[0];
    const customerGroupId = randomUUID();

    let productId: string | null = null;
    let priceKindId: string | null = null;
    let currencyId: string | null = null;
    let currencyCode: string | null = null;
    let baselinePriceId: string | null = null;
    let tierPriceId: string | null = null;

    try {
      productId = await createProductFixture(request, token, {
        title: `QA Price Rule Product ${stamp}`,
        sku: `QA-PR-${stamp}`,
      });
      priceKindId = await createPriceKindFixture(request, token, stamp);
      const currency = await createRandomCurrencyFixture(request, token, { name: `QA Price Rule Currency ${stamp}` });
      currencyId = currency.id;
      currencyCode = currency.code;

      // Baseline: a plain price for the same product/currency/price-kind, no
      // scope, no quantity tier — the row the new admin-UI row must outrank.
      const baselineResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: { productId, priceKindId, currencyCode, minQuantity: 1, unitPriceNet: 20 },
      });
      expect(baselineResponse.status(), `baseline price create failed: ${baselineResponse.status()}`).toBe(201);
      baselinePriceId = expectId(
        (await readJsonSafe<{ id?: string }>(baselineResponse))?.id,
        'baseline price should return an id',
      );

      await login(page, 'admin');
      await page.goto('/backend/catalog/prices/create');

      await pickComboboxByText(page, 'productId', searchStamp, new RegExp(`QA Price Rule Product ${stamp}`));
      // Unlike products' search (token-based, matches a mid-string segment),
      // /api/catalog/price-kinds' search only matches a query that is a
      // *prefix* of the title/code despite building a %term% ILIKE filter —
      // a pre-existing behavior in that route, not something this change
      // touches. Search by the fixture's real title prefix instead of the
      // stamp; the exact-stamp regex below still targets the right option
      // among any same-prefix matches.
      await pickComboboxByText(page, 'priceKindId', 'QA', new RegExp(`QA Price Rule Kind ${stamp}`));
      await pickComboboxByText(page, 'currencyCode', currencyCode, new RegExp(`^${currencyCode}`));
      await fillText(page, 'unitPriceNet', '15');
      await fillText(page, 'minQuantity', '10');
      await fillText(page, 'customerGroupId', customerGroupId);

      await page.getByRole('button', { name: 'Save' }).last().click();
      await page.waitForURL(/\/backend\/catalog\/prices(\?.*)?$/);

      // Find the row the UI created (baseline has no customer-group scope).
      const listResponse = await apiRequest(
        request,
        'GET',
        `${PRICES_PATH}?productId=${encodeURIComponent(productId)}&pageSize=100`,
        { token },
      );
      expect(listResponse.status()).toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse);
      const created = (listBody?.items ?? []).find((item) => {
        const cg = (item.customerGroupId ?? item.customer_group_id) as string | undefined;
        return cg === customerGroupId;
      });
      expect(created, 'the UI-created price row should be findable via the API').toBeTruthy();
      tierPriceId = expectId(created?.id, 'created price row should have an id');

      // Every dimension the form exposed reached the persisted row.
      const tierRaw = await fetchPriceById(request, token, tierPriceId);
      expect(tierRaw.customer_group_id ?? tierRaw.customerGroupId).toBe(customerGroupId);
      expect(Number(tierRaw.min_quantity ?? tierRaw.minQuantity)).toBe(10);
      expect(tierRaw.currency_code ?? tierRaw.currencyCode).toBe(currencyCode);
      expect(Number(tierRaw.unit_price_net ?? tierRaw.unitPriceNet)).toBe(15);
      expect(tierRaw.product_id ?? tierRaw.productId).toBe(productId);

      // The row the UI created must outrank the plain baseline for a
      // matching context — the same resolver a real storefront/sales caller
      // would run through `catalogPricingService`.
      const baselineRaw = await fetchPriceById(request, token, baselinePriceId);
      const rows: PriceRow[] = [toPriceRow(baselineRaw), toPriceRow(tierRaw)];
      const ctx: PricingContext = { customerGroupId, quantity: 10, date: new Date() };
      const winner = selectBestPrice(rows, ctx);
      expect(winner?.id).toBe(tierPriceId);
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, tierPriceId);
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, baselinePriceId);
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
