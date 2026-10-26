import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CAT-PRICES-003: A partial price-kind update keeps the stored display mode.
 *
 * `PUT /api/catalog/price-kinds` without `displayMode` (a rename, or toggling
 * `isActive`) must leave an `including-tax` price kind as it is instead of
 * resetting it to the create-time default `excluding-tax`. An explicit
 * `displayMode` is still applied.
 *
 * Self-contained: creates its own price kind and deletes it in `finally`.
 */
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

type PriceKindRow = Record<string, unknown> & { id?: string };

async function readPriceKind(request: APIRequestContext, token: string, id: string): Promise<PriceKindRow> {
  const response = await apiRequest(request, 'GET', `${PRICE_KINDS_PATH}?ids=${encodeURIComponent(id)}`, { token });
  expect(response.status(), 'price kinds should be readable').toBe(200);
  const items = (await readJsonSafe<{ items?: PriceKindRow[] }>(response))?.items ?? [];
  const row = items.find((item) => item.id === id);
  expect(row, `price kind ${id} should be listed`).toBeTruthy();
  return row as PriceKindRow;
}

function displayModeOf(row: PriceKindRow): unknown {
  return row.display_mode ?? row.displayMode;
}

async function updatePriceKind(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', PRICE_KINDS_PATH, { token, data });
  expect(response.status(), `price kind update ${JSON.stringify(data)} should succeed`).toBe(200);
}

test.describe('TC-CAT-PRICES-003: partial price-kind update keeps displayMode', () => {
  test('omitting displayMode on PUT leaves an including-tax price kind unchanged', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const code = `qa-cat-prices-003-${stamp}`;
    const title = `QA Gross ${stamp}`;
    let priceKindId: string | null = null;

    try {
      const created = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
        token,
        data: { code, title, displayMode: 'including-tax', currencyCode: 'USD', isPromotion: false },
      });
      expect(created.status(), 'price kind fixture should be created').toBe(201);
      priceKindId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'price kind should return an id');

      const initial = await readPriceKind(request, token, priceKindId);
      expect(displayModeOf(initial)).toBe('including-tax');

      await updatePriceKind(request, token, { id: priceKindId, title: `${title} renamed` });
      const renamed = await readPriceKind(request, token, priceKindId);
      expect(renamed.title).toBe(`${title} renamed`);
      expect(displayModeOf(renamed), 'rename must not reset displayMode').toBe('including-tax');
      expect(renamed.currency_code ?? renamed.currencyCode).toBe('USD');
      expect(renamed.is_promotion ?? renamed.isPromotion).toBe(false);

      await updatePriceKind(request, token, { id: priceKindId, isActive: false });
      const deactivated = await readPriceKind(request, token, priceKindId);
      expect(deactivated.is_active ?? deactivated.isActive).toBe(false);
      expect(displayModeOf(deactivated), 'isActive toggle must not reset displayMode').toBe('including-tax');

      await updatePriceKind(request, token, { id: priceKindId, displayMode: 'excluding-tax' });
      const switched = await readPriceKind(request, token, priceKindId);
      expect(displayModeOf(switched), 'explicit displayMode is applied').toBe('excluding-tax');
      expect(switched.title).toBe(`${title} renamed`);
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
    }
  });
});
