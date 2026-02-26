import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-ADMIN-012: API Key CRUD via API
 * Covers: POST/GET/DELETE /api/api_keys/keys
 */
test.describe('TC-ADMIN-012: API Key CRUD via API', () => {
  test('should create, list, and delete an API key', async ({ request }) => {
    let token: string | null = null;
    let keyId: string | null = null;
    const keyName = `QA TC-ADMIN-012 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token,
        data: { name: keyName },
      });
      expect(createResponse.status(), 'POST /api/api_keys/keys should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string; secret?: string; keyPrefix?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      expect(typeof createBody.secret, 'secret should be a string').toBe('string');
      expect((createBody.secret as string).length, 'secret should not be empty').toBeGreaterThan(0);
      keyId = createBody.id ?? null;

      const listResponse = await apiRequest(request, 'GET', '/api/api_keys/keys', { token });
      expect(listResponse.status(), 'GET /api/api_keys/keys should return 200').toBe(200);
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(listBody.items), 'Response should contain items array').toBeTruthy();
      const found = (listBody.items ?? []).some((item) => item.id === keyId);
      expect(found, 'Created key should appear in the list').toBeTruthy();

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(keyId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/api_keys/keys should return 200').toBe(200);
      keyId = null;
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/api_keys/keys', keyId);
    }
  });
});
