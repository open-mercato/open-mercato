import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
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

/**
 * TC-CUR-015: NBP average-rate contract.
 *
 * The test seeds the persisted average rate directly after the supported manual API
 * creates its otherwise-identical row. Provenance is deliberately provider-owned,
 * so using a deterministic local fixture proves the read/UI contract without calling
 * the live NBP service.
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

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/currencies/exchange-rates?id=${encodeURIComponent(rateId as string)}&type=average`,
        { token },
      );
      expect(listResponse.status(), 'average-rate list response').toBe(200);
      const listBody = (await listResponse.json()) as {
        items?: Array<{ source?: string; type?: string | null; externalReference?: string | null }>;
      };
      expect(listBody.items).toEqual([expect.objectContaining({
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
});
