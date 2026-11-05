import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-007: Exchange-rate validation — self-reference and invalid rate values
 * are rejected with 400.
 * Source: issue #2490 (currencies integration coverage).
 *
 * The create command parses `exchangeRateCreateSchema`, which enforces:
 *   - from/to currency codes must differ (`.refine`)
 *   - rate matches /^\d+(\.\d{1,8})?$/ (rejects negatives, non-numeric, > 8 decimals)
 *   - parseFloat(rate) > 0 (rejects zero)
 * A Zod failure surfaces through `makeCrudRoute` as HTTP 400.
 */
test.describe('TC-CUR-007: exchange-rate validation boundaries', () => {
  test('rejects self-reference and invalid rate values, accepts a valid rate', async ({ request }) => {
    let token: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;
    let validRateId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const fromCurrency = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-007 From' });
      const toCurrency = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-007 To' });
      fromCurrencyId = fromCurrency.id;
      toCurrencyId = toCurrency.id;

      const baseRatePayload = {
        organizationId,
        tenantId,
        date: new Date().toISOString(),
        source: 'QA-Manual',
      };

      const postRate = (data: Record<string, unknown>) =>
        apiRequest(request, 'POST', '/api/currencies/exchange-rates', { token: token!, data });

      const selfReference = await postRate({ ...baseRatePayload, fromCurrencyCode: fromCurrency.code, toCurrencyCode: fromCurrency.code, rate: '1.5' });
      expect(selfReference.status(), 'self-referencing rate (from === to) must be 400').toBe(400);

      const negative = await postRate({ ...baseRatePayload, fromCurrencyCode: fromCurrency.code, toCurrencyCode: toCurrency.code, rate: '-1.50' });
      expect(negative.status(), 'negative rate must be 400').toBe(400);

      const zero = await postRate({ ...baseRatePayload, fromCurrencyCode: fromCurrency.code, toCurrencyCode: toCurrency.code, rate: '0' });
      expect(zero.status(), 'zero rate must be 400').toBe(400);

      const nonNumeric = await postRate({ ...baseRatePayload, fromCurrencyCode: fromCurrency.code, toCurrencyCode: toCurrency.code, rate: 'abc' });
      expect(nonNumeric.status(), 'non-numeric rate must be 400').toBe(400);

      const tooPrecise = await postRate({ ...baseRatePayload, fromCurrencyCode: fromCurrency.code, toCurrencyCode: toCurrency.code, rate: '1.123456789' });
      expect(tooPrecise.status(), 'rate exceeding 8 decimal places must be 400').toBe(400);

      const valid = await postRate({ ...baseRatePayload, fromCurrencyCode: fromCurrency.code, toCurrencyCode: toCurrency.code, rate: '1.5' });
      expect(valid.status(), 'valid distinct-currency positive rate must be 201').toBe(201);
      validRateId = (await readJsonSafe<{ id?: string }>(valid))?.id ?? null;
      expect(validRateId, 'valid rate response should contain an id').toBeTruthy();
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', validRateId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromCurrencyId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toCurrencyId);
    }
  });
});
