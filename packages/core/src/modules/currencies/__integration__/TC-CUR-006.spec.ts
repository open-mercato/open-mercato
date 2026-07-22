import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-006: RBAC — `currencies.rates.manage` gates exchange-rate mutations.
 * Source: issue #2490 (currencies integration coverage).
 *
 * A user that holds `currencies.rates.view` (and `currencies.view`, its
 * dependency) may LIST exchange rates (200) but is forbidden (403) from
 * POST/PUT/DELETE on /api/currencies/exchange-rates, which the route guards with
 * `currencies.rates.manage`.
 */
test.describe('TC-CUR-006: currencies.rates.manage RBAC gate', () => {
  test('rates-view user lists exchange rates but cannot create, update, or delete', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const viewerEmail = `tc-cur-006-viewer-${stamp}@example.com`;

    let adminToken: string | null = null;
    let viewerToken: string | null = null;
    let roleId: string | null = null;
    let viewerUserId: string | null = null;
    let rateId: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(adminToken);

      const fromCurrency = await createRandomCurrencyFixture(request, adminToken, { name: 'QA TC-CUR-006 From' });
      const toCurrency = await createRandomCurrencyFixture(request, adminToken, { name: 'QA TC-CUR-006 To' });
      fromCurrencyId = fromCurrency.id;
      toCurrencyId = toCurrency.id;

      const rateCreate = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token: adminToken,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: fromCurrency.code,
          toCurrencyCode: toCurrency.code,
          rate: '1.25',
          date: new Date().toISOString(),
          source: 'QA-Manual',
        },
      });
      expect(rateCreate.status(), 'admin should create the exchange-rate fixture (201)').toBe(201);
      rateId = (await readJsonSafe<{ id?: string }>(rateCreate))?.id ?? null;

      roleId = await createRoleFixture(request, adminToken, { name: `TC-CUR-006 Viewer ${stamp}` });
      viewerUserId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: viewerUserId,
        features: ['currencies.view', 'currencies.rates.view'],
        organizations: null,
      });
      viewerToken = await getAuthToken(request, viewerEmail, password);

      const createAttempt = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token: viewerToken,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: fromCurrency.code,
          toCurrencyCode: toCurrency.code,
          rate: '1.5',
          date: new Date().toISOString(),
          source: 'QA-Manual',
        },
      });
      expect(createAttempt.status(), 'POST without currencies.rates.manage must return 403').toBe(403);

      const updateAttempt = await apiRequest(request, 'PUT', '/api/currencies/exchange-rates', {
        token: viewerToken,
        data: { id: rateId, rate: '1.75' },
      });
      expect(updateAttempt.status(), 'PUT without currencies.rates.manage must return 403').toBe(403);

      const deleteAttempt = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId ?? '')}`,
        { token: viewerToken },
      );
      expect(deleteAttempt.status(), 'DELETE without currencies.rates.manage must return 403').toBe(403);

      const listResponse = await apiRequest(request, 'GET', '/api/currencies/exchange-rates?pageSize=1', {
        token: viewerToken,
      });
      expect(listResponse.status(), 'GET with currencies.rates.view must return 200').toBe(200);
    } finally {
      await deleteCurrenciesEntityIfExists(request, adminToken, '/api/currencies/exchange-rates', rateId);
      await deleteCurrenciesEntityIfExists(request, adminToken, '/api/currencies/currencies', fromCurrencyId);
      await deleteCurrenciesEntityIfExists(request, adminToken, '/api/currencies/currencies', toCurrencyId);
      await deleteUserIfExists(request, adminToken, viewerUserId);
      await deleteUserAclInDb(viewerUserId ?? '').catch(() => undefined);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
