import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CAT-PRICES-005: A date-only price update cannot invert the validity window.
 *
 * `PUT /api/catalog/prices` with only `endsAt` (or only `startsAt`) must be
 * checked against the other date already stored on the price, the same way a
 * body carrying both dates is. Valid date-only edits and edits that do not
 * touch the dates keep working.
 *
 * Self-contained: creates its own price kind, product and price, and deletes
 * them in `finally`.
 */
const PRICES_PATH = '/api/catalog/prices';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';
const PRODUCTS_PATH = '/api/catalog/products';
const STARTS_AT = '2031-06-01T00:00:00.000Z';
const ENDS_AT = '2031-09-01T00:00:00.000Z';

type PriceRow = Record<string, unknown> & { id?: string };

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data });
  expect(response.status(), `POST ${path} should return 201`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `POST ${path} should return an id`);
}

async function readPrice(
  request: APIRequestContext,
  token: string,
  priceId: string,
  productId: string,
): Promise<PriceRow> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRICES_PATH}?ids=${encodeURIComponent(priceId)}&productId=${encodeURIComponent(productId)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), 'prices should be readable').toBe(200);
  const items = (await readJsonSafe<{ items?: PriceRow[] }>(response))?.items ?? [];
  const row = items.find((item) => item.id === priceId);
  expect(row, `price ${priceId} should be listed`).toBeTruthy();
  return row as PriceRow;
}

function dateOf(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function windowOf(row: PriceRow): { startsAt: string | null; endsAt: string | null } {
  return {
    startsAt: dateOf(row.starts_at ?? row.startsAt),
    endsAt: dateOf(row.ends_at ?? row.endsAt),
  };
}

test.describe('TC-CAT-PRICES-005: date-only price update keeps the validity window ordered', () => {
  test('rejects a single date that would invert the stored window and keeps valid edits working', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    let priceKindId: string | null = null;
    let productId: string | null = null;
    let priceId: string | null = null;

    try {
      priceKindId = await createEntity(request, token, PRICE_KINDS_PATH, {
        code: `qa-cat-prices-005-${stamp}`,
        title: `QA Prices 005 ${stamp}`,
        displayMode: 'including-tax',
        currencyCode: 'USD',
        isPromotion: false,
      });
      productId = await createEntity(request, token, PRODUCTS_PATH, {
        title: `QA Prices 005 ${stamp}`,
        sku: `QA-PRICES-005-${stamp}`,
        description:
          'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
      });
      priceId = await createEntity(request, token, PRICES_PATH, {
        productId,
        priceKindId,
        currencyCode: 'USD',
        unitPriceGross: 25,
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      });
      expect(windowOf(await readPrice(request, token, priceId, productId))).toEqual({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      });

      const endsTooEarly = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, endsAt: '2031-01-01T00:00:00.000Z' },
      });
      expect(endsTooEarly.status(), 'endsAt before the stored startsAt must be rejected').toBe(400);
      const endsBody = await readJsonSafe<{
        fieldErrors?: Record<string, string>;
        details?: Array<{ path?: string[]; origin?: string }>;
      }>(endsTooEarly);
      expect(endsBody?.fieldErrors?.endsAt, 'the error must point at endsAt').toBeTruthy();
      expect(endsBody?.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['endsAt'], origin: 'validation' })]),
      );

      const startsTooLate = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, startsAt: '2031-12-01T00:00:00.000Z' },
      });
      expect(startsTooLate.status(), 'startsAt after the stored endsAt must be rejected').toBe(400);

      expect(windowOf(await readPrice(request, token, priceId, productId)), 'rejected edits must not change the row').toEqual({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      });

      const extended = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, endsAt: '2031-12-01T00:00:00.000Z' },
      });
      expect(extended.status(), 'a later endsAt must still be accepted').toBe(200);

      const repriced = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, unitPriceGross: 31 },
      });
      expect(repriced.status(), 'an edit that does not touch the dates must still be accepted').toBe(200);

      const saved = await readPrice(request, token, priceId, productId);
      expect(windowOf(saved)).toEqual({ startsAt: STARTS_AT, endsAt: '2031-12-01T00:00:00.000Z' });
      expect(Number(saved.unit_price_gross ?? saved.unitPriceGross)).toBe(31);
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, priceId);
      await deleteGeneralEntityIfExists(request, token, PRODUCTS_PATH, productId);
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
    }
  });
});
