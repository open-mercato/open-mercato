import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-STAFF-012: Time Projects + Employee Assignment via API
 * Covers: POST /api/staff/timesheets/time-projects, POST /api/staff/timesheets/time-projects/{id}/employees, GET employees
 */
test.describe('TC-STAFF-012: Time Projects + Employee Assignment via API', () => {
  test('should create a time project, assign an employee, and list the assignment', async ({ request }) => {
    const stamp = Date.now();
    const projectName = `QA Project ${stamp}`;
    const projectCode = `QA-${stamp}`;

    let token: string | null = null;
    let staffMemberId: string | null = null;
    let projectId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      // Get the admin's own staff member ID
      const selfResponse = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token });
      expect(selfResponse.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy();
      const selfBody = (await selfResponse.json()) as { member?: { id?: string } };
      staffMemberId = selfBody.member?.id ?? null;
      expect(staffMemberId, 'Staff member id should be present in self response').toBeTruthy();

      // Step 1: Create a time project
      const createProjectResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
        token,
        data: { name: projectName, code: projectCode, projectType: 'internal', status: 'active' },
      });
      expect(createProjectResponse.ok(), 'POST /api/staff/timesheets/time-projects should succeed').toBeTruthy();
      const createProjectBody = (await createProjectResponse.json()) as { id?: string | null };

      // Response may return { id: null } — use list to find by name
      if (typeof createProjectBody.id === 'string' && createProjectBody.id.length > 0) {
        projectId = createProjectBody.id;
      } else {
        const listResponse = await apiRequest(request, 'GET', `/api/staff/timesheets/time-projects?pageSize=100`, { token });
        expect(listResponse.ok(), 'GET /api/staff/timesheets/time-projects should succeed').toBeTruthy();
        const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
        const match = listBody.items?.find((item) => item.name === projectName);
        expect(match, 'Created project should appear in list').toBeTruthy();
        projectId = match!.id as string;
      }
      expect(projectId, 'Project id should be resolved').toBeTruthy();

      // Step 2: Assign employee to project
      const assignResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
        token,
        data: { staffMemberId, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
      });
      expect(assignResponse.ok(), 'POST employees assignment should succeed').toBeTruthy();

      // Step 3: List employees on the project and verify assignment
      const employeesResponse = await apiRequest(request, 'GET', `/api/staff/timesheets/time-projects/${projectId}/employees`, { token });
      expect(employeesResponse.ok(), 'GET employees should succeed').toBeTruthy();
      const employeesBody = (await employeesResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(employeesBody.items) && employeesBody.items.length > 0, 'Should have at least one assigned employee').toBeTruthy();
      const assignment = employeesBody.items!.find((item) => item.staff_member_id === staffMemberId);
      expect(assignment, 'Assigned staff member should appear in employees list').toBeTruthy();
    } finally {
      if (token && projectId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-projects?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {});
      }
    }
  });
});
