import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures';
import { deleteEntityByPathIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-AUD-001: Action Log read
 * Covers: GET /api/audit_logs/audit-logs/actions
 */
test.describe('TC-AUD-001: Action Log Read', () => {
  test('should return action log entries with expected structure after an auditable action', async ({ request }) => {
    let token: string | null = null;
    let dictionaryId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_aud_001_${Date.now()}`,
        name: 'QA TC-AUD-001 Dictionary',
      });

      const response = await apiRequest(request, 'GET', '/api/audit_logs/audit-logs/actions', { token });
      expect(response.status(), 'GET /api/audit_logs/audit-logs/actions should return 200').toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      expect(Array.isArray(body.items), 'Response should contain items array').toBeTruthy();
      expect((body.items as unknown[]).length, 'Should have at least one action log entry').toBeGreaterThan(0);
      expect('canViewTenant' in body, 'Response should contain canViewTenant field').toBeTruthy();
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      );
    }
  });
});
