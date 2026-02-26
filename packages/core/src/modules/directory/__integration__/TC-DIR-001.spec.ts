import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  deleteGeneralEntityIfExists,
  getTokenContext,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DIR-001: Organization CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/directory/organizations
 */
test.describe('TC-DIR-001: Organization CRUD via API', () => {
  test('should create, update, read, and delete an organization', async ({ request }) => {
    let token: string | null = null;
    let orgId: string | null = null;
    const orgName = `QA TC-DIR-001 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);

      const createResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token,
        data: { name: orgName, tenantId },
      });
      expect(createResponse.status(), 'POST /api/directory/organizations should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      orgId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: orgId, name: `${orgName} Updated` },
      });
      expect(updateResponse.status(), 'PUT /api/directory/organizations should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=options&ids=${encodeURIComponent(orgId!)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/directory/organizations should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const org = getBody.items![0];
      expect(org.name, 'name should be updated').toBe(`${orgName} Updated`);

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(orgId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/directory/organizations should return 200').toBe(200);
      orgId = null;
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', orgId);
    }
  });
});
