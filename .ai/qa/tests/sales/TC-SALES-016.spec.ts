import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-016: Tax Rate Configuration
 * Source: .ai/qa/scenarios/TC-SALES-016-tax-rate-configuration.md
 */
test.describe('TC-SALES-016: Tax Rate Configuration', () => {
  test('should create, update and delete tax rate', async ({ request }) => {
    let token: string | null = null;
    let taxRateId: string | null = null;
    const code = `qa-tax-${Date.now()}`;

    try {
      token = await getAuthToken(request);

      const createResponse = await apiRequest(request, 'POST', '/api/sales/tax-rates', {
        token,
        data: {
          name: `QA Tax Rate ${Date.now()}`,
          code,
          rate: 23,
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      taxRateId = createBody.id ?? null;
      expect(taxRateId).toBeTruthy();

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/tax-rates', {
        token,
        data: {
          id: taxRateId,
          rate: 8,
        },
      });
      expect(updateResponse.ok()).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/tax-rates', taxRateId);
    }
  });
});

