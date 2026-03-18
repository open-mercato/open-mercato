import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteStaffEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures';

/**
 * TC-STAFF-002: Staff Team CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/staff/teams
 */
test.describe('TC-STAFF-002: Staff Team CRUD via API', () => {
  test('should create, update, read, and delete a staff team', async ({ request }) => {
    let token: string | null = null;
    let teamId: string | null = null;
    const teamName = `QA TC-STAFF-002 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/staff/teams', {
        token,
        data: { name: teamName },
      });
      expect(createResponse.status(), 'POST /api/staff/teams should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      teamId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/staff/teams', {
        token,
        data: { id: teamId, description: 'QA updated description' },
      });
      expect(updateResponse.status(), 'PUT /api/staff/teams should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/teams?ids=${encodeURIComponent(teamId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/staff/teams should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const team = getBody.items![0];
      expect(team.description, 'description should be updated').toBe('QA updated description');

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/teams?id=${encodeURIComponent(teamId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/staff/teams should return 200').toBe(200);
      teamId = null;
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/teams', teamId);
    }
  });
});
