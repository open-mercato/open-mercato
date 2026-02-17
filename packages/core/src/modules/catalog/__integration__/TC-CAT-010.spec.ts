import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from './helpers/api';

/**
 * TC-CAT-010: Create Price Kind Configuration
 * Source: .ai/qa/scenarios/TC-CAT-010-price-kind-creation.md
 */
test.describe('TC-CAT-010: Create Price Kind Configuration', () => {
  test('should create and delete a catalog price kind via API', async ({ request }) => {
    const token = await getAuthToken(request);
    const code = `qa_cat_010_${Date.now()}`;
    const title = `QA TC-CAT-010 ${Date.now()}`;

    const createResponse = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
      token,
      data: {
        code,
        title,
        displayMode: 'excluding-tax',
      },
    });
    expect(createResponse.ok()).toBeTruthy();

    const createBody = (await createResponse.json()) as { id?: string };
    expect(typeof createBody.id === 'string' && createBody.id.length > 0).toBeTruthy();

    const deleteResponse = await apiRequest(
      request,
      'DELETE',
      `/api/catalog/price-kinds?id=${encodeURIComponent(createBody.id as string)}`,
      { token },
    );
    expect(deleteResponse.ok()).toBeTruthy();
  });
});

