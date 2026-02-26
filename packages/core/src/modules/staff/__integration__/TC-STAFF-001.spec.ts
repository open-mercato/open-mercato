import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteStaffEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures';

/**
 * TC-STAFF-001: Staff Team Member CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/staff/team-members
 */
test.describe('TC-STAFF-001: Staff Team Member CRUD via API', () => {
  test('should create, update, read, and delete a staff team member', async ({ request }) => {
    let token: string | null = null;
    let memberId: string | null = null;
    const displayName = `QA TC-STAFF-001 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { displayName },
      });
      expect(createResponse.status(), 'POST /api/staff/team-members should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      memberId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/staff/team-members', {
        token,
        data: { id: memberId, description: 'QA member description' },
      });
      expect(updateResponse.status(), 'PUT /api/staff/team-members should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/team-members?ids=${encodeURIComponent(memberId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/staff/team-members should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const member = getBody.items![0];
      expect(member.description, 'description should be updated').toBe('QA member description');

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/team-members?id=${encodeURIComponent(memberId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/staff/team-members should return 200').toBe(200);
      memberId = null;
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId);
    }
  });
});
