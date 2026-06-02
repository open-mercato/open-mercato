import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-STAFF-014: Dashboard Widget Data + Self-scope via API
 * Covers: POST /api/dashboards/widgets/data with admin vs employee tokens, self-scope enforcement
 */
test.describe('TC-STAFF-014: Dashboard Widget Data + Self-scope via API', () => {
  test('should return grouped hours for admin and enforce self-scope for employee', async ({ request }) => {
    const stamp = Date.now();
    const projectName = `QA Widget ${stamp}`;
    const projectCode = `QAW-${stamp}`;

    let adminToken: string | null = null;
    let employeeToken: string | null = null;
    let adminStaffMemberId: string | null = null;
    let employeeStaffMemberId: string | null = null;
    let projectId: string | null = null;
    const createdEntryIds: string[] = [];

    try {
      adminToken = await getAuthToken(request, 'admin');
      employeeToken = await getAuthToken(request, 'employee');

      // Get admin staff member ID
      const adminSelfResponse = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: adminToken });
      expect(adminSelfResponse.ok(), 'Admin GET /api/staff/team-members/self should succeed').toBeTruthy();
      const adminSelfBody = (await adminSelfResponse.json()) as { member?: { id?: string } };
      adminStaffMemberId = adminSelfBody.member?.id ?? null;
      expect(adminStaffMemberId, 'Admin staff member id should be present').toBeTruthy();

      // Get employee staff member ID
      const employeeSelfResponse = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken });
      expect(employeeSelfResponse.ok(), 'Employee GET /api/staff/team-members/self should succeed').toBeTruthy();
      const employeeSelfBody = (await employeeSelfResponse.json()) as { member?: { id?: string } };
      employeeStaffMemberId = employeeSelfBody.member?.id ?? null;
      expect(employeeStaffMemberId, 'Employee staff member id should be present').toBeTruthy();

      // Create a time project
      const createProjectResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
        token: adminToken,
        data: { name: projectName, code: projectCode, projectType: 'internal', status: 'active' },
      });
      expect(createProjectResponse.ok(), 'POST time-projects should succeed').toBeTruthy();
      const createProjectBody = (await createProjectResponse.json()) as { id?: string | null };

      if (typeof createProjectBody.id === 'string' && createProjectBody.id.length > 0) {
        projectId = createProjectBody.id;
      } else {
        const listResponse = await apiRequest(request, 'GET', `/api/staff/timesheets/time-projects?pageSize=100`, { token: adminToken });
        expect(listResponse.ok(), 'GET time-projects list should succeed').toBeTruthy();
        const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
        const match = listBody.items?.find((item) => item.name === projectName);
        expect(match, 'Created project should appear in list').toBeTruthy();
        projectId = match!.id as string;
      }
      expect(projectId, 'Project id should be resolved').toBeTruthy();

      // Assign both admin and employee to the project
      const assignAdminResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
        token: adminToken,
        data: { staffMemberId: adminStaffMemberId, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
      });
      expect(assignAdminResponse.ok(), 'Admin assignment should succeed').toBeTruthy();

      const assignEmployeeResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
        token: adminToken,
        data: { staffMemberId: employeeStaffMemberId, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
      });
      expect(assignEmployeeResponse.ok(), 'Employee assignment should succeed').toBeTruthy();

      // Create entries for both — use dates in the current month
      const now = new Date();
      const currentMonthDay1 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const currentMonthDay2 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;

      // Admin entry
      const adminEntryResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
        token: adminToken,
        data: {
          staffMemberId: adminStaffMemberId,
          timeProjectId: projectId,
          date: currentMonthDay1,
          durationMinutes: 240,
          source: 'manual',
        },
      });
      expect(adminEntryResponse.ok(), 'Admin entry creation should succeed').toBeTruthy();
      const adminEntryBody = (await adminEntryResponse.json()) as { id?: string | null };
      if (typeof adminEntryBody.id === 'string') createdEntryIds.push(adminEntryBody.id);

      // Employee entry
      const employeeEntryResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
        token: adminToken,
        data: {
          staffMemberId: employeeStaffMemberId,
          timeProjectId: projectId,
          date: currentMonthDay2,
          durationMinutes: 90,
          source: 'manual',
        },
      });
      expect(employeeEntryResponse.ok(), 'Employee entry creation should succeed').toBeTruthy();
      const employeeEntryBody = (await employeeEntryResponse.json()) as { id?: string | null };
      if (typeof employeeEntryBody.id === 'string') createdEntryIds.push(employeeEntryBody.id);

      const widgetPayload = {
        entityType: 'staff:staff_time_entries',
        metric: { field: 'durationMinutes', aggregate: 'sum' },
        groupBy: { field: 'timeProjectId', limit: 20, resolveLabels: true },
        dateRange: { field: 'date', preset: 'this_year' },
      };

      // Step 1: Admin widget data — should see all entries
      const adminWidgetResponse = await apiRequest(request, 'POST', '/api/dashboards/widgets/data', {
        token: adminToken,
        data: widgetPayload,
      });
      expect(adminWidgetResponse.ok(), 'Admin widget data should succeed').toBeTruthy();
      const adminWidgetBody = (await adminWidgetResponse.json()) as {
        value?: number | null;
        data?: Array<{ groupKey?: unknown; groupLabel?: string; value?: number | null }>;
        metadata?: { fetchedAt?: string; recordCount?: number };
      };
      expect(typeof adminWidgetBody.value === 'number', 'Admin widget should return a numeric value').toBeTruthy();
      expect(Array.isArray(adminWidgetBody.data), 'Admin widget should return data array').toBeTruthy();
      expect(adminWidgetBody.metadata?.fetchedAt, 'Admin widget should include fetchedAt').toBeTruthy();
      expect(typeof adminWidgetBody.metadata?.recordCount === 'number', 'Admin widget should include recordCount').toBeTruthy();

      // Admin should see at least the total of both entries (240 + 90 = 330)
      const adminProjectGroup = adminWidgetBody.data?.find((group) => group.groupKey === projectId);
      expect(adminProjectGroup, 'Admin should see the test project in grouped data').toBeTruthy();
      expect(
        typeof adminProjectGroup!.value === 'number' && adminProjectGroup!.value >= 330,
        'Admin project group value should include both entries (>= 330 minutes)',
      ).toBeTruthy();

      // Step 2: Employee widget data — should only see own entries (self-scope)
      const employeeWidgetResponse = await apiRequest(request, 'POST', '/api/dashboards/widgets/data', {
        token: employeeToken,
        data: widgetPayload,
      });
      expect(employeeWidgetResponse.ok(), 'Employee widget data should succeed').toBeTruthy();
      const employeeWidgetBody = (await employeeWidgetResponse.json()) as {
        value?: number | null;
        data?: Array<{ groupKey?: unknown; groupLabel?: string; value?: number | null }>;
        metadata?: { fetchedAt?: string; recordCount?: number };
      };
      expect(typeof employeeWidgetBody.value === 'number', 'Employee widget should return a numeric value').toBeTruthy();
      expect(Array.isArray(employeeWidgetBody.data), 'Employee widget should return data array').toBeTruthy();

      // Employee should only see their own entry (90 minutes), NOT admin's (240)
      const employeeProjectGroup = employeeWidgetBody.data?.find((group) => group.groupKey === projectId);
      if (employeeProjectGroup) {
        expect(
          typeof employeeProjectGroup.value === 'number' && employeeProjectGroup.value <= 90,
          'Employee project group value should only include own entries (<= 90 minutes)',
        ).toBeTruthy();
      }
      // The total value across all groups for employee should not include admin's 240 minutes
      expect(
        typeof employeeWidgetBody.value === 'number' && employeeWidgetBody.value < (adminWidgetBody.value ?? 0),
        'Employee total should be less than admin total (self-scope enforcement)',
      ).toBeTruthy();
    } finally {
      // Clean up entries
      if (adminToken && createdEntryIds.length > 0) {
        for (const entryId of createdEntryIds) {
          await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`, { token: adminToken }).catch(() => {});
        }
      }
      // Clean up project
      if (adminToken && projectId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-projects?id=${encodeURIComponent(projectId)}`, { token: adminToken }).catch(() => {});
      }
    }
  });
});
