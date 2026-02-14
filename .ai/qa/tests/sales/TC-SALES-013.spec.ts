import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-013: Sales Channel Config
 * Source: .ai/qa/scenarios/TC-SALES-013-sales-channel-config.md
 */
test.describe('TC-SALES-013: Sales Channel Config', () => {
  test('should create, update and delete sales channel', async ({ request }) => {
    let token: string | null = null;
    let channelId: string | null = null;
    const code = `qa-channel-${Date.now()}`;

    try {
      token = await getAuthToken(request);

      const createResponse = await apiRequest(request, 'POST', '/api/sales/channels', {
        token,
        data: {
          name: `QA Channel ${Date.now()}`,
          code,
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      channelId = createBody.id ?? null;
      expect(channelId).toBeTruthy();

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/channels', {
        token,
        data: {
          id: channelId,
          code,
          name: `QA Channel Updated ${Date.now()}`,
        },
      });
      expect(updateResponse.ok()).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/channels', channelId);
    }
  });
});

