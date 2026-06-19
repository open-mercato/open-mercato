import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createStaffTeamFixture, deleteStaffEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures';

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

  test('should reject deletion of a team that has assigned members (409)', async ({ request }) => {
    let token: string | null = null;
    let teamId: string | null = null;
    let memberId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      teamId = await createStaffTeamFixture(request, token);

      const memberResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { teamId, displayName: `QA TC-STAFF-002-409 ${Date.now()}` },
      });
      expect(memberResponse.status(), 'POST /api/staff/team-members should return 201').toBe(201);
      const memberBody = (await memberResponse.json()) as { id?: string };
      memberId = memberBody.id ?? null;

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/teams?id=${encodeURIComponent(teamId)}`,
        { token },
      );
      expect(
        deleteResponse.status(),
        'DELETE /api/staff/teams with assigned members should return 409',
      ).toBe(409);
      const deleteBody = (await deleteResponse.json()) as { error?: string };
      expect(deleteBody.error, 'Error body should mention assigned members').toMatch(/assigned member/i);
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId);
      await deleteStaffEntityIfExists(request, token, '/api/staff/teams', teamId);
    }
  });
});
