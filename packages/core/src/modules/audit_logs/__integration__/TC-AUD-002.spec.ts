import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AUD-002: Access Log read
 * Covers: GET /api/audit_logs/audit-logs/access
 */
test.describe('TC-AUD-002: Access Log Read', () => {
  test('should return access log entries with expected structure', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    await apiRequest(request, 'GET', '/api/dictionaries', { token });

    const response = await apiRequest(request, 'GET', '/api/audit_logs/audit-logs/access', { token });
    expect(response.status(), 'GET /api/audit_logs/audit-logs/access should return 200').toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(Array.isArray(body.items), 'Response should contain items array').toBeTruthy();
    expect('canViewTenant' in body, 'Response should contain canViewTenant field').toBeTruthy();
    expect(typeof body.page === 'number', 'Response should contain page').toBeTruthy();
    expect(typeof body.pageSize === 'number', 'Response should contain pageSize').toBeTruthy();
    expect(typeof body.total === 'number', 'Response should contain total').toBeTruthy();
  });
});
