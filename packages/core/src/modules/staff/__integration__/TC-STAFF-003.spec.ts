import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteStaffEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures';

/**
 * TC-STAFF-003: Staff Team Role CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/staff/team-roles
 */
test.describe('TC-STAFF-003: Staff Team Role CRUD via API', () => {
  test('should create, update, read, and delete a staff team role', async ({ request }) => {
    let token: string | null = null;
    let roleId: string | null = null;
    const roleName = `QA TC-STAFF-003 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/staff/team-roles', {
        token,
        data: { name: roleName },
      });
      expect(createResponse.status(), 'POST /api/staff/team-roles should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      roleId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/staff/team-roles', {
        token,
        data: { id: roleId, description: 'QA role description' },
      });
      expect(updateResponse.status(), 'PUT /api/staff/team-roles should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/team-roles?ids=${encodeURIComponent(roleId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/staff/team-roles should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const role = getBody.items![0];
      expect(role.description, 'description should be updated').toBe('QA role description');

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/team-roles?id=${encodeURIComponent(roleId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/staff/team-roles should return 200').toBe(200);
      roleId = null;
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-roles', roleId);
    }
  });
});
