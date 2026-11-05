import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-DIR-003: Organization Switcher read
 * Covers: GET /api/directory/organization-switcher
 */
test.describe('TC-DIR-003: Organization Switcher', () => {
  test('should return organization switcher payload with expected fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const response = await apiRequest(request, 'GET', '/api/directory/organization-switcher', { token });
    expect(response.status(), 'GET /api/directory/organization-switcher should return 200').toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(Array.isArray(body.items), 'Response should contain items array').toBeTruthy();
    expect('selectedId' in body, 'Response should contain selectedId field').toBeTruthy();
    expect('canManage' in body, 'Response should contain canManage field').toBeTruthy();
  });
});
