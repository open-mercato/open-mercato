import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-STAFF-013: Bulk Save via API
 * Covers: POST /api/staff/timesheets/time-entries/bulk — create, update, soft-delete, and >200 validation
 */
test.describe('TC-STAFF-013: Bulk Save via API', () => {
  test('should bulk create, update, soft-delete entries and reject >200 entries', async ({ request }) => {
    const stamp = Date.now();
    const projectName = `QA BulkProj ${stamp}`;
    const projectCode = `QAB-${stamp}`;

    let token: string | null = null;
    let staffMemberId: string | null = null;
    let projectId: string | null = null;
    const createdEntryIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');

      // Get the admin's own staff member ID
      const selfResponse = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token });
      expect(selfResponse.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy();
      const selfBody = (await selfResponse.json()) as { member?: { id?: string } };
      staffMemberId = selfBody.member?.id ?? null;
      expect(staffMemberId, 'Staff member id should be present').toBeTruthy();

      // Create a time project
      const createProjectResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
        token,
        data: { name: projectName, code: projectCode, projectType: 'internal', status: 'active' },
      });
      expect(createProjectResponse.ok(), 'POST time-projects should succeed').toBeTruthy();
      const createProjectBody = (await createProjectResponse.json()) as { id?: string | null };

      if (typeof createProjectBody.id === 'string' && createProjectBody.id.length > 0) {
        projectId = createProjectBody.id;
      } else {
        const listResponse = await apiRequest(request, 'GET', `/api/staff/timesheets/time-projects?pageSize=100`, { token });
        expect(listResponse.ok(), 'GET time-projects list should succeed').toBeTruthy();
        const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
        const match = listBody.items?.find((item) => item.name === projectName);
        expect(match, 'Created project should appear in list').toBeTruthy();
        projectId = match!.id as string;
      }
      expect(projectId, 'Project id should be resolved').toBeTruthy();

      // Assign employee to project
      const assignResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
        token,
        data: { staffMemberId, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
      });
      expect(assignResponse.ok(), 'Employee assignment should succeed').toBeTruthy();

      // Step 1: Bulk create 2 entries
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      const bulkCreateResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/bulk', {
        token,
        data: {
          entries: [
            { date: today, timeProjectId: projectId, durationMinutes: 120, notes: 'QA entry A' },
            { date: yesterday, timeProjectId: projectId, durationMinutes: 60, notes: 'QA entry B' },
          ],
        },
      });
      expect(bulkCreateResponse.ok(), 'Bulk create should succeed').toBeTruthy();
      const bulkCreateBody = (await bulkCreateResponse.json()) as { ok?: boolean; created?: number; updated?: number; deleted?: number };
      expect(bulkCreateBody.ok, 'Bulk create response ok should be true').toBe(true);
      expect(bulkCreateBody.created, 'Should have created 2 entries').toBe(2);

      // Fetch the created entries to get their IDs
      const listEntriesResponse = await apiRequest(request, 'GET', `/api/staff/timesheets/time-entries?staffMemberId=${staffMemberId}&projectId=${projectId}`, { token });
      expect(listEntriesResponse.ok(), 'GET time-entries should succeed').toBeTruthy();
      const listEntriesBody = (await listEntriesResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(listEntriesBody.items) && listEntriesBody.items.length >= 2, 'Should have at least 2 entries').toBeTruthy();

      for (const item of listEntriesBody.items!) {
        if (typeof item.id === 'string') createdEntryIds.push(item.id);
      }

      const entryA = listEntriesBody.items!.find((item) => item.notes === 'QA entry A');
      const entryB = listEntriesBody.items!.find((item) => item.notes === 'QA entry B');
      expect(entryA, 'Entry A should exist').toBeTruthy();
      expect(entryB, 'Entry B should exist').toBeTruthy();

      // Step 2: Bulk update one (change duration) + soft-delete another (duration=0)
      const bulkUpdateResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/bulk', {
        token,
        data: {
          entries: [
            { id: entryA!.id as string, date: today, timeProjectId: projectId, durationMinutes: 180, notes: 'QA entry A updated' },
            { id: entryB!.id as string, date: yesterday, timeProjectId: projectId, durationMinutes: 0 },
          ],
        },
      });
      expect(bulkUpdateResponse.ok(), 'Bulk update should succeed').toBeTruthy();
      const bulkUpdateBody = (await bulkUpdateResponse.json()) as { ok?: boolean; created?: number; updated?: number; deleted?: number };
      expect(bulkUpdateBody.ok, 'Bulk update response ok should be true').toBe(true);
      expect(bulkUpdateBody.updated, 'Should have updated 1 entry').toBe(1);
      expect(bulkUpdateBody.deleted, 'Should have soft-deleted 1 entry').toBe(1);

      // Step 3: Reject >200 entries
      const oversizedEntries = Array.from({ length: 201 }, (_, index) => ({
        date: today,
        timeProjectId: projectId,
        durationMinutes: 30,
        notes: `overflow-${index}`,
      }));

      const bulkOverflowResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/bulk', {
        token,
        data: { entries: oversizedEntries },
      });
      expect(bulkOverflowResponse.status(), 'Bulk with >200 entries should return 422').toBe(422);
    } finally {
      // Clean up remaining entries
      if (token && createdEntryIds.length > 0) {
        for (const entryId of createdEntryIds) {
          await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`, { token }).catch(() => {});
        }
      }
      // Clean up project
      if (token && projectId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-projects?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {});
      }
    }
  });
});
