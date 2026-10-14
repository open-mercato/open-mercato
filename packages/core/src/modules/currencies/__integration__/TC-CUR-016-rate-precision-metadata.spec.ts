import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

type ExchangeRateListResponse = {
  items?: Array<{ id: string; rate: string; metadata: Record<string, unknown> | null }>
};

/**
 * TC-CUR-016: Exchange rates keep arbitrary precision and free-form metadata.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */
test.describe('TC-CUR-016: exchange-rate precision and metadata', () => {
  test('stores a 30-decimal rate exactly and round-trips metadata', async ({ request }) => {
    let token: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;
    let rateId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const fromCurrency = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-016 From' });
      const toCurrency = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-016 To' });
      fromCurrencyId = fromCurrency.id;
      toCurrencyId = toCurrency.id;

      const preciseRate = '0.000056123456789012345678901234';
      const created = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: fromCurrency.code,
          toCurrencyCode: toCurrency.code,
          rate: preciseRate,
          date: new Date().toISOString(),
          source: 'QA-Manual',
          metadata: { tableNo: '195/C/NBP/2026', note: 'QA TC-CUR-016' },
        },
      });
      expect(created.status(), 'create should return 201').toBe(201);
      rateId = (await readJsonSafe<{ id?: string }>(created))?.id ?? null;
      expect(rateId, 'create should return an id').toBeTruthy();

      const readRate = async () => {
        const response = await apiRequest(request, 'GET', `/api/currencies/exchange-rates?id=${rateId}`, { token: token! });
        expect(response.status()).toBe(200);
        const body = await readJsonSafe<ExchangeRateListResponse>(response);
        return body?.items?.[0] ?? null;
      };

      const afterCreate = await readRate();
      expect(afterCreate?.rate, 'rate must keep all 30 decimals').toBe(preciseRate);
      expect(afterCreate?.metadata).toEqual({ tableNo: '195/C/NBP/2026', note: 'QA TC-CUR-016' });

      const largeRate = '123456789012345678.123456789';
      const updated = await apiRequest(request, 'PUT', '/api/currencies/exchange-rates', {
        token,
        data: { id: rateId, rate: largeRate, metadata: { note: 'updated' } },
      });
      expect(updated.status(), 'update should return 200').toBe(200);

      const afterUpdate = await readRate();
      expect(afterUpdate?.rate, 'rate beyond 10 integer digits must be stored exactly').toBe(largeRate);
      expect(afterUpdate?.metadata).toEqual({ note: 'updated' });

      const cleared = await apiRequest(request, 'PUT', '/api/currencies/exchange-rates', {
        token,
        data: { id: rateId, metadata: null },
      });
      expect(cleared.status()).toBe(200);
      expect((await readRate())?.metadata).toBeNull();
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromCurrencyId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toCurrencyId);
    }
  });
});
