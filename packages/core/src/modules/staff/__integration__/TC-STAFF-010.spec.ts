import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-STAFF-010: Time Entry CRUD via API
 * Covers: POST/GET/PUT/DELETE /api/staff/timesheets/time-entries
 */
test.describe('TC-STAFF-010: Time Entry CRUD via API', () => {
  test('should create, list, update, and delete a time entry', async ({ request }) => {
    const stamp = Date.now()
    const projectName = `QA Entry Project ${stamp}`
    const projectCode = `QAE-${stamp}`

    let token: string | null = null
    let staffMemberId: string | null = null
    let projectId: string | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      // Get the admin's own staff member ID
      const selfResponse = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token })
      expect(selfResponse.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
      const selfBody = (await selfResponse.json()) as { member?: { id?: string } }
      staffMemberId = selfBody.member?.id ?? null
      expect(staffMemberId, 'Staff member id should be present in self response').toBeTruthy()

      // Create a time project
      const createProjectResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
        token,
        data: { name: projectName, code: projectCode, projectType: 'internal', status: 'active' },
      })
      expect(createProjectResponse.ok(), 'POST /api/staff/timesheets/time-projects should succeed').toBeTruthy()
      const createProjectBody = (await createProjectResponse.json()) as { id?: string | null }

      // Response may return { id: null } — use list to find by name
      if (typeof createProjectBody.id === 'string' && createProjectBody.id.length > 0) {
        projectId = createProjectBody.id
      } else {
        const listProjectsResponse = await apiRequest(
          request,
          'GET',
          `/api/staff/timesheets/time-projects?pageSize=100`,
          { token },
        )
        expect(listProjectsResponse.ok(), 'GET /api/staff/timesheets/time-projects should succeed').toBeTruthy()
        const listProjectsBody = (await listProjectsResponse.json()) as { items?: Array<Record<string, unknown>> }
        const match = listProjectsBody.items?.find((item) => item.name === projectName)
        expect(match, 'Created project should appear in list').toBeTruthy()
        projectId = match!.id as string
      }
      expect(projectId, 'Project id should be resolved').toBeTruthy()

      // Assign employee to project
      const assignResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
        token,
        data: { staffMemberId, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
      })
      expect(assignResponse.ok(), 'POST employees assignment should succeed').toBeTruthy()

      // Step 1: Create a time entry
      const createEntryResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
        token,
        data: {
          staffMemberId,
          timeProjectId: projectId,
          date: '2026-04-15',
          durationMinutes: 60,
          source: 'manual',
          notes: 'initial entry',
        },
      })
      expect(createEntryResponse.status(), 'POST /api/staff/timesheets/time-entries should return 201').toBe(201)
      const createEntryBody = (await createEntryResponse.json()) as { id?: string }
      expect(createEntryBody.id, 'Response should contain an id').toBeTruthy()
      entryId = createEntryBody.id ?? null

      // Step 2: List entries and verify the created entry appears
      const listEntriesResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(staffMemberId!)}&from=2026-04-01&to=2026-04-30`,
        { token },
      )
      expect(listEntriesResponse.ok(), 'GET /api/staff/timesheets/time-entries should succeed').toBeTruthy()
      const listEntriesBody = (await listEntriesResponse.json()) as {
        items?: Array<Record<string, unknown>>
        total?: number
      }
      expect(Array.isArray(listEntriesBody.items), 'Response should contain items array').toBeTruthy()
      const createdEntry = listEntriesBody.items!.find((item) => item.id === entryId)
      expect(createdEntry, 'Created entry should appear in list').toBeTruthy()
      expect(createdEntry!.staff_member_id).toBe(staffMemberId)
      expect(createdEntry!.time_project_id).toBe(projectId)
      expect(createdEntry!.duration_minutes).toBe(60)
      expect(createdEntry!.source).toBe('manual')

      // Step 3: Update the entry
      const updateResponse = await apiRequest(request, 'PUT', '/api/staff/timesheets/time-entries', {
        token,
        data: { id: entryId, durationMinutes: 120, notes: 'updated' },
      })
      expect(updateResponse.ok(), 'PUT /api/staff/timesheets/time-entries should succeed').toBeTruthy()
      const updateBody = (await updateResponse.json()) as { ok?: boolean }
      expect(updateBody.ok, 'Update response should return ok: true').toBe(true)

      // Step 4: Delete the entry
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId!)}`,
        { token },
      )
      expect(deleteResponse.ok(), 'DELETE /api/staff/timesheets/time-entries should succeed').toBeTruthy()
      const deleteBody = (await deleteResponse.json()) as { ok?: boolean }
      expect(deleteBody.ok, 'Delete response should return ok: true').toBe(true)

      // Verify entry no longer appears in list
      const listAfterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(staffMemberId!)}&from=2026-04-01&to=2026-04-30`,
        { token },
      )
      expect(listAfterDeleteResponse.ok(), 'GET after delete should succeed').toBeTruthy()
      const listAfterDeleteBody = (await listAfterDeleteResponse.json()) as {
        items?: Array<Record<string, unknown>>
      }
      const deletedEntry = listAfterDeleteBody.items?.find((item) => item.id === entryId)
      expect(deletedEntry, 'Deleted entry should not appear in list').toBeFalsy()

      // Mark as cleaned up so finally does not re-delete
      entryId = null
    } finally {
      if (token && entryId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`, { token }).catch(() => {})
      }
      if (token && projectId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-projects?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {})
      }
    }
  })
})
