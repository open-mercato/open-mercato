import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures';

type CreateResponse = { id?: string };
type ErrorResponse = { error?: string };
type ListResponse = { items?: Array<Record<string, unknown>> };

const BASE_URL = process.env.BASE_URL?.trim() || null;

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path;
}

async function createTenant(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  });
  const body = await readJsonSafe<CreateResponse>(response);
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  return expectId(body?.id, 'Tenant creation response should include id');
}

async function scopedRequest(
  request: APIRequestContext,
  token: string,
  scope: { tenantId: string; organizationId: string },
  method: string,
  path: string,
  data?: unknown,
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Cookie: [
        `om_selected_tenant=${encodeURIComponent(scope.tenantId)}`,
        `om_selected_org=${encodeURIComponent(scope.organizationId)}`,
      ].join('; '),
    },
    data,
  });
}

async function deleteScopedEntityIfExists(
  request: APIRequestContext,
  token: string,
  scope: { tenantId: string; organizationId: string } | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!scope || !id) return;
  await scopedRequest(
    request,
    token,
    scope,
    'DELETE',
    `${path}?id=${encodeURIComponent(id)}`,
  ).catch(() => undefined);
}

test.describe('TC-CUR-014: command CRUD tenant scope (#3804)', () => {
  test('blocks a tenant admin from creating, updating, or deleting foreign currency data', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const stamp = randomUUID();

    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;
    let exchangeRateId: string | null = null;
    let leakedCurrencyId: string | null = null;
    let leakedExchangeRateId: string | null = null;

    try {
      tenantId = await createTenant(
        request,
        superadminToken,
        `QA TC-CUR-014 Tenant ${stamp}`,
      );
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-CUR-014 Organization ${stamp}`,
        tenantId,
      });
      const scope = { tenantId, organizationId };
      const fromCode = generateUniqueCurrencyCode();
      const toCode = generateUniqueCurrencyCode();

      const fromCurrencyResponse = await scopedRequest(
        request,
        superadminToken,
        scope,
        'POST',
        '/api/currencies/currencies',
        {
          organizationId,
          tenantId,
          code: fromCode,
          name: 'QA TC-CUR-014 From Currency',
        },
      );
      const fromCurrencyBody = await readJsonSafe<CreateResponse>(fromCurrencyResponse);
      expect(fromCurrencyResponse.status(), 'Superadmin should create the source currency').toBe(
        201,
      );
      fromCurrencyId = expectId(fromCurrencyBody?.id, 'Source currency response should include id');

      const toCurrencyResponse = await scopedRequest(
        request,
        superadminToken,
        scope,
        'POST',
        '/api/currencies/currencies',
        {
          organizationId,
          tenantId,
          code: toCode,
          name: 'QA TC-CUR-014 To Currency',
        },
      );
      const toCurrencyBody = await readJsonSafe<CreateResponse>(toCurrencyResponse);
      expect(toCurrencyResponse.status(), 'Superadmin should create the target currency').toBe(201);
      toCurrencyId = expectId(toCurrencyBody?.id, 'Target currency response should include id');

      const exchangeRateResponse = await scopedRequest(
        request,
        superadminToken,
        scope,
        'POST',
        '/api/currencies/exchange-rates',
        {
          organizationId,
          tenantId,
          fromCurrencyCode: fromCode,
          toCurrencyCode: toCode,
          rate: '0.90000000',
          date: '2026-01-01T00:00:00.000Z',
          source: `qa-${stamp}`,
        },
      );
      const exchangeRateBody = await readJsonSafe<CreateResponse>(exchangeRateResponse);
      expect(exchangeRateResponse.status(), 'Superadmin should create the exchange rate').toBe(201);
      exchangeRateId = expectId(exchangeRateBody?.id, 'Exchange-rate response should include id');

      const blockedCurrencyCreate = await apiRequest(
        request,
        'POST',
        '/api/currencies/currencies',
        {
          token: adminToken,
          data: {
            organizationId,
            tenantId,
            code: generateUniqueCurrencyCode(),
            name: 'Blocked cross-tenant currency',
          },
        },
      );
      leakedCurrencyId = (await readJsonSafe<CreateResponse>(blockedCurrencyCreate))?.id ?? null;
      expect(blockedCurrencyCreate.status(), 'Foreign-tenant currency creation should be forbidden').toBe(
        403,
      );

      const blockedCurrencyUpdate = await apiRequest(
        request,
        'PUT',
        '/api/currencies/currencies',
        {
          token: adminToken,
          data: { id: fromCurrencyId, name: 'Blocked cross-tenant update' },
        },
      );
      const blockedCurrencyUpdateBody = await readJsonSafe<ErrorResponse>(blockedCurrencyUpdate);
      expect(blockedCurrencyUpdate.status(), 'Foreign-tenant currency update should be hidden').toBe(
        404,
      );
      expect(blockedCurrencyUpdateBody?.error).toBe('Currency not found');

      const blockedCurrencyDelete = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/currencies?id=${encodeURIComponent(fromCurrencyId)}`,
        { token: adminToken },
      );
      const blockedCurrencyDeleteBody = await readJsonSafe<ErrorResponse>(blockedCurrencyDelete);
      expect(blockedCurrencyDelete.status(), 'Foreign-tenant currency delete should be hidden').toBe(
        404,
      );
      expect(blockedCurrencyDeleteBody?.error).toBe('Currency not found');

      const blockedRateCreate = await apiRequest(
        request,
        'POST',
        '/api/currencies/exchange-rates',
        {
          token: adminToken,
          data: {
            organizationId,
            tenantId,
            fromCurrencyCode: fromCode,
            toCurrencyCode: toCode,
            rate: '0.95000000',
            date: '2026-01-02T00:00:00.000Z',
            source: `blocked-${stamp}`,
          },
        },
      );
      leakedExchangeRateId = (await readJsonSafe<CreateResponse>(blockedRateCreate))?.id ?? null;
      expect(blockedRateCreate.status(), 'Foreign-tenant exchange-rate creation should be forbidden').toBe(
        403,
      );

      const blockedRateUpdate = await apiRequest(
        request,
        'PUT',
        '/api/currencies/exchange-rates',
        {
          token: adminToken,
          data: { id: exchangeRateId, rate: '0.80000000' },
        },
      );
      const blockedRateUpdateBody = await readJsonSafe<ErrorResponse>(blockedRateUpdate);
      expect(blockedRateUpdate.status(), 'Foreign-tenant exchange-rate update should be hidden').toBe(
        404,
      );
      expect(blockedRateUpdateBody?.error).toBe('Exchange rate not found');

      const blockedRateDelete = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(exchangeRateId)}`,
        { token: adminToken },
      );
      const blockedRateDeleteBody = await readJsonSafe<ErrorResponse>(blockedRateDelete);
      expect(blockedRateDelete.status(), 'Foreign-tenant exchange-rate delete should be hidden').toBe(
        404,
      );
      expect(blockedRateDeleteBody?.error).toBe('Exchange rate not found');

      const currencyRead = await scopedRequest(
        request,
        superadminToken,
        scope,
        'GET',
        `/api/currencies/currencies?id=${encodeURIComponent(fromCurrencyId)}`,
      );
      const currencyList = await readJsonSafe<ListResponse>(currencyRead);
      expect(currencyRead.status(), 'Superadmin should still read the source currency').toBe(200);
      expect(currencyList?.items?.[0]?.name, 'Blocked update must not change the currency').toBe(
        'QA TC-CUR-014 From Currency',
      );

      const rateRead = await scopedRequest(
        request,
        superadminToken,
        scope,
        'GET',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(exchangeRateId)}`,
      );
      const rateList = await readJsonSafe<ListResponse>(rateRead);
      expect(rateRead.status(), 'Superadmin should still read the exchange rate').toBe(200);
      expect(rateList?.items?.[0]?.rate, 'Blocked update must not change the exchange rate').toBe(
        '0.90000000',
      );
    } finally {
      const scope =
        tenantId && organizationId ? { tenantId, organizationId } : null;
      await deleteScopedEntityIfExists(
        request,
        superadminToken,
        scope,
        '/api/currencies/exchange-rates',
        leakedExchangeRateId,
      );
      await deleteScopedEntityIfExists(
        request,
        superadminToken,
        scope,
        '/api/currencies/exchange-rates',
        exchangeRateId,
      );
      await deleteScopedEntityIfExists(
        request,
        superadminToken,
        scope,
        '/api/currencies/currencies',
        leakedCurrencyId,
      );
      await deleteScopedEntityIfExists(
        request,
        superadminToken,
        scope,
        '/api/currencies/currencies',
        fromCurrencyId,
      );
      await deleteScopedEntityIfExists(
        request,
        superadminToken,
        scope,
        '/api/currencies/currencies',
        toCurrencyId,
      );
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/tenants',
        tenantId,
      );
    }
  });
});
