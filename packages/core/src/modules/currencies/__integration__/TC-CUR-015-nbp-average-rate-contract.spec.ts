import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim();
const APP_ROOT = TEST_APP_ROOT
  ? path.resolve(TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato');

if (!TEST_APP_ROOT) loadEnv({ path: path.resolve(APP_ROOT, '.env') });

async function setPublicationReference(rateId: string, reference: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed NBP publication provenance');
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      'update exchange_rates set external_reference = $1 where id = $2',
      [reference, rateId],
    );
  } finally {
    await client.end();
  }
}

async function readExternalReferenceColumn(): Promise<{ dataType: string; isNullable: string } | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to inspect the exchange_rates schema');
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'exchange_rates'
          and column_name = 'external_reference'`,
    );
    const row = result.rows[0];
    return row ? { dataType: row.data_type, isNullable: row.is_nullable } : null;
  } finally {
    await client.end();
  }
}

/**
 * TC-CUR-015: NBP average-rate contract.
 *
 * The suite seeds the persisted average rate directly after the supported manual API
 * creates its otherwise-identical row. Provenance is deliberately provider-owned, so
 * using a deterministic local fixture proves the read/UI contract without calling the
 * live NBP service. Provider selection, the explicit/default split at the service
 * boundary and the provider->persistence write path are pinned by the module's unit
 * tests; a live HTTP provider fetch is intentionally not exercised here.
 */
test.describe('TC-CUR-015: NBP average-rate contract', () => {
  test('shows separate NBP providers and an average row with its publication reference', async ({ page, request }) => {
    test.setTimeout(60_000);

    let token: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;
    let rateId: string | null = null;
    const reference = '163/A/NBP/2026';

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const from = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-015 From' });
      const to = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-015 To' });
      fromCurrencyId = from.id;
      toCurrencyId = to.id;

      const createResponse = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: from.code,
          toCurrencyCode: to.code,
          rate: '4.1234',
          date: '2999-12-31T00:00:00.000Z',
          source: 'nbp_average',
          type: 'average',
        },
      });
      expect(createResponse.status(), 'average-rate fixture create').toBe(201);
      rateId = ((await createResponse.json()) as { id?: string }).id ?? null;
      expect(rateId).toBeTruthy();
      await setPublicationReference(rateId as string, reference);

      const selectedResponse = await apiRequest(
        request,
        'GET',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId as string)}&source=nbp_average&type=average`,
        { token },
      );
      expect(selectedResponse.status(), 'selected provider lookup').toBe(200);
      const selectedBody = (await selectedResponse.json()) as {
        items?: Array<{ source?: string; type?: string | null; externalReference?: string | null }>;
      };
      expect(selectedBody.items).toEqual([expect.objectContaining({
        source: 'nbp_average',
        type: 'average',
        externalReference: reference,
      })]);

      await login(page, 'admin');
      await page.goto('/backend/config/currency-fetching');
      await expect(page.getByRole('heading', { name: /National Bank of Poland/ })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'NBP average rates' })).toBeVisible({ timeout: 15_000 });

      await page.goto('/backend/exchange-rates');
      const averageRow = page.getByRole('row').filter({ hasText: reference });
      await expect(averageRow).toBeVisible({ timeout: 15_000 });
      await expect(averageRow).toContainText('Average');
      await expect(averageRow).toContainText('nbp_average');
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId).catch(() => {});
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromCurrencyId).catch(() => {});
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toCurrencyId).catch(() => {});
    }
  });

  test('rejects a fetch without the fetch-manage feature before calling a provider', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee');

    for (const body of [
      { providers: ['nbp_average'] },
      { date: '2026-08-24', providers: [] },
      { providers: ['nbp_average'], unexpected: true },
    ]) {
      const response = await apiRequest(request, 'POST', '/api/currencies/fetch-rates', {
        token: employeeToken,
        data: body,
      });
      expect(response.status(), `employee fetch-rates ${JSON.stringify(body)}`).toBe(403);
    }
  });

  test('keeps average rates isolated to the organization that stored them', async ({ request }) => {
    test.setTimeout(60_000);

    let token: string | null = null;
    let otherOrgId: string | null = null;
    let fromCurrencyId: string | null = null;
    let toCurrencyId: string | null = null;
    let rateId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { tenantId } = getTokenContext(token);
      otherOrgId = await createOrganizationFixture(request, token, {
        name: `QA TC-CUR-015 Org ${Date.now()}`,
        tenantId,
      });

      const fromCode = generateUniqueCurrencyCode();
      const toCode = generateUniqueCurrencyCode();
      const fromCurrency = await apiRequestWithSelectedOrg(
        request,
        'POST',
        '/api/currencies/currencies',
        {
          token,
          selectedOrgId: otherOrgId,
          data: { organizationId: otherOrgId, tenantId, code: fromCode, name: 'QA TC-CUR-015 Org From', symbol: null },
        },
      );
      expect(fromCurrency.status(), 'cross-organization from-currency create').toBe(201);
      fromCurrencyId = ((await fromCurrency.json()) as { id?: string }).id ?? null;
      expect(fromCurrencyId).toBeTruthy();

      const toCurrency = await apiRequestWithSelectedOrg(
        request,
        'POST',
        '/api/currencies/currencies',
        {
          token,
          selectedOrgId: otherOrgId,
          data: { organizationId: otherOrgId, tenantId, code: toCode, name: 'QA TC-CUR-015 Org To', symbol: null },
        },
      );
      expect(toCurrency.status(), 'cross-organization to-currency create').toBe(201);
      toCurrencyId = ((await toCurrency.json()) as { id?: string }).id ?? null;
      expect(toCurrencyId).toBeTruthy();

      const createResponse = await apiRequestWithSelectedOrg(
        request,
        'POST',
        '/api/currencies/exchange-rates',
        {
          token,
          selectedOrgId: otherOrgId,
          data: {
            organizationId: otherOrgId,
            tenantId,
            fromCurrencyCode: fromCode,
            toCurrencyCode: toCode,
            rate: '4.4321',
            date: '2999-12-30T00:00:00.000Z',
            source: 'nbp_average',
            type: 'average',
          },
        },
      );
      expect(createResponse.status(), 'cross-organization average-rate create').toBe(201);
      rateId = ((await createResponse.json()) as { id?: string }).id ?? null;
      expect(rateId).toBeTruthy();

      const homeRead = await apiRequest(
        request,
        'GET',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId as string)}`,
        { token },
      );
      expect(homeRead.status(), 'home-organization read').toBe(200);
      expect(((await homeRead.json()) as { items?: unknown[] }).items).toEqual([]);

      const otherOrgRead = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId as string)}`,
        { token, selectedOrgId: otherOrgId },
      );
      expect(otherOrgRead.status(), 'other-organization read').toBe(200);
      expect(((await otherOrgRead.json()) as { items?: unknown[] }).items).toHaveLength(1);
    } finally {
      if (rateId && token && otherOrgId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', '/api/currencies/exchange-rates', {
          token,
          selectedOrgId: otherOrgId,
          data: { id: rateId },
        }).catch(() => {});
      }
      if (token && otherOrgId) {
        for (const id of [fromCurrencyId, toCurrencyId]) {
          if (!id) continue;
          await apiRequestWithSelectedOrg(request, 'DELETE', '/api/currencies/currencies', {
            token,
            selectedOrgId: otherOrgId,
            data: { id },
          }).catch(() => {});
        }
      }
      await deleteOrganizationIfExists(request, token, otherOrgId);
    }
  });

  test('ships the additive nullable publication-reference column', async () => {
    await expect(readExternalReferenceColumn()).resolves.toEqual({
      dataType: 'text',
      isNullable: 'YES',
    });
  });
});
