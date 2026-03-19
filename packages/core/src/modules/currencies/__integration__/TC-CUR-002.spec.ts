import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-002: Exchange Rate CRUD via API
 * Covers: POST/GET/DELETE /api/currencies/exchange-rates
 */
test.describe('TC-CUR-002: Exchange Rate CRUD via API', () => {
  test('should create, read, and delete an exchange rate', async ({ request }) => {
    let token: string | null = null;
    let rateId: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const fromCode = `F${randLetter()}${randLetter()}`;
      const toCode = `T${randLetter()}${randLetter()}`;
      fromCurrencyId = await createCurrencyFixture(request, token, { code: fromCode, name: 'QA TC-CUR-002 From' });
      toCurrencyId = await createCurrencyFixture(request, token, { code: toCode, name: 'QA TC-CUR-002 To' });

      const createResponse = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: fromCode,
          toCurrencyCode: toCode,
          rate: '1.10',
          date: new Date().toISOString(),
          source: 'QA-Manual',
        },
      });
      expect(createResponse.status(), 'POST /api/currencies/exchange-rates should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      rateId = createBody.id ?? null;

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/currencies/exchange-rates should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/currencies/exchange-rates should return 200').toBe(200);
      rateId = null;
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromCurrencyId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toCurrencyId);
    }
  });
});
