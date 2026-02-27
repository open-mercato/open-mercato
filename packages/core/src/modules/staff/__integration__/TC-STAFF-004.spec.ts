import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures';

/**
 * TC-STAFF-004: Leave Request Lifecycle via API
 * Covers: POST /api/staff/leave-requests, POST /api/staff/leave-requests/accept, GET /api/staff/leave-requests
 */
test.describe('TC-STAFF-004: Leave Request Lifecycle via API', () => {
  test('should create a leave request and approve it', async ({ request }) => {
    let token: string | null = null;
    let memberId: string | null = null;
    let leaveRequestId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-004 ${Date.now()}`,
      });

      const startDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString();

      const createResponse = await apiRequest(request, 'POST', '/api/staff/leave-requests', {
        token,
        data: {
          memberId,
          startDate,
          endDate,
          timezone: 'UTC',
        },
      });
      expect(createResponse.status(), 'POST /api/staff/leave-requests should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      leaveRequestId = createBody.id ?? null;

      const acceptResponse = await apiRequest(request, 'POST', '/api/staff/leave-requests/accept', {
        token,
        data: { id: leaveRequestId, decisionComment: 'Approved by QA automation' },
      });
      expect(acceptResponse.status(), 'POST /api/staff/leave-requests/accept should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/leave-requests?ids=${encodeURIComponent(leaveRequestId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/staff/leave-requests should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const leaveRequest = getBody.items![0];
      expect(leaveRequest.status, 'status should be approved after acceptance').toBe('approved');
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/leave-requests', leaveRequestId);
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId);
    }
  });
});
