import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteCurrenciesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-001: Currency CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/currencies/currencies
 */
test.describe('TC-CUR-001: Currency CRUD via API', () => {
  test('should create, update, read, and delete a currency', async ({ request }) => {
    let token: string | null = null;
    let currencyId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const code = `Q${randLetter()}${randLetter()}`;
      const createResponse = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code, name: 'QA Test Currency' },
      });
      expect(createResponse.status(), 'POST /api/currencies/currencies should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      currencyId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token,
        data: { id: currencyId, symbol: 'QX' },
      });
      expect(updateResponse.status(), 'PUT /api/currencies/currencies should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/currencies/currencies?id=${encodeURIComponent(currencyId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/currencies/currencies should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const currency = getBody.items![0];
      expect(currency.symbol, 'symbol should be updated').toBe('QX');

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/currencies?id=${encodeURIComponent(currencyId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/currencies/currencies should return 200').toBe(200);
      currencyId = null;
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
    }
  });

  test('deletes a currency when the id is sent in the request body, as the backend UI does (#3566)', async ({ request }) => {
    let token: string | null = null;
    let currencyId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const code = `Q${randLetter()}${randLetter()}`;
      const createResponse = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token,
        data: { organizationId, tenantId, code, name: 'QA Body-Delete Currency' },
      });
      expect(createResponse.status(), 'POST /api/currencies/currencies should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      currencyId = createBody.id ?? null;
      expect(currencyId, 'Response should contain an id').toBeTruthy();

      // The backend UI sends the id in the DELETE body, not as a ?id= query param
      // (packages/core/src/modules/currencies/backend/currencies/page.tsx). The route
      // previously read only the query param, so this shape returned 400 and never deleted.
      const deleteResponse = await apiRequest(request, 'DELETE', '/api/currencies/currencies', {
        token,
        data: { id: currencyId, organizationId, tenantId },
      });
      expect(deleteResponse.status(), 'DELETE with id in the body should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/currencies/currencies?id=${encodeURIComponent(currencyId!)}`,
        { token },
      );
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(getBody.items ?? [], 'Deleted currency should no longer be returned').toHaveLength(0);
      currencyId = null;
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
    }
  });
});
