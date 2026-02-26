import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DIR-002: Tenant CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/directory/tenants
 */
test.describe('TC-DIR-002: Tenant CRUD via API', () => {
  test('should create, update, read, and delete a tenant', async ({ request }) => {
    let token: string | null = null;
    let tenantId: string | null = null;
    const tenantName = `QA TC-DIR-002 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'superadmin');

      const createResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token,
        data: { name: tenantName },
      });
      expect(createResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      tenantId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/directory/tenants', {
        token,
        data: { id: tenantId, name: `${tenantName} Updated` },
      });
      expect(updateResponse.status(), 'PUT /api/directory/tenants should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/directory/tenants?id=${encodeURIComponent(tenantId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/directory/tenants should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const tenant = getBody.items![0];
      expect(tenant.name, 'name should be updated').toBe(`${tenantName} Updated`);

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/directory/tenants?id=${encodeURIComponent(tenantId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/directory/tenants should return 200').toBe(200);
      tenantId = null;
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId);
    }
  });
});
