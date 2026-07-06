import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-STAFF-011: Timer Start/Stop + Segments via API
 * Covers: POST timer-start, POST timer-stop, POST segments, PATCH segments/{segmentId}
 */
test.describe('TC-STAFF-011: Timer Start/Stop + Segments via API', () => {
  test('should start timer, create segment, patch segment, stop timer, and verify result', async ({ request }) => {
    const stamp = Date.now()
    const projectName = `QA Timer Project ${stamp}`
    const projectCode = `QAT-${stamp}`

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

      // Step 1: Create a time entry with duration 0 and source "timer"
      const createEntryResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
        token,
        data: {
          staffMemberId,
          timeProjectId: projectId,
          date: '2026-04-15',
          durationMinutes: 0,
          source: 'timer',
        },
      })
      expect(createEntryResponse.status(), 'POST /api/staff/timesheets/time-entries should return 201').toBe(201)
      const createEntryBody = (await createEntryResponse.json()) as { id?: string }
      expect(createEntryBody.id, 'Response should contain an id').toBeTruthy()
      entryId = createEntryBody.id ?? null

      // Step 2: Start timer
      const timerStartResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-entries/${entryId}/timer-start`, {
        token,
      })
      expect(timerStartResponse.ok(), 'POST timer-start should succeed').toBeTruthy()
      const timerStartBody = (await timerStartResponse.json()) as { ok?: boolean }
      expect(timerStartBody.ok, 'Timer start response should return ok: true').toBe(true)

      // Step 3: Create a manual segment
      const segmentStartedAt = new Date().toISOString()
      const createSegmentResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-entries/${entryId}/segments`, {
        token,
        data: { startedAt: segmentStartedAt, segmentType: 'work' },
      })
      expect(createSegmentResponse.status(), 'POST segments should return 201').toBe(201)
      const segmentBody = (await createSegmentResponse.json()) as {
        id?: string
        timeEntryId?: string
        startedAt?: string
        endedAt?: string | null
        segmentType?: string
        createdAt?: string
      }
      expect(segmentBody.id, 'Segment response should contain id').toBeTruthy()
      expect(segmentBody.timeEntryId, 'Segment response should contain timeEntryId').toBe(entryId)
      expect(segmentBody.startedAt, 'Segment response should contain startedAt').toBeTruthy()
      expect(segmentBody.endedAt, 'Segment endedAt should be null').toBeNull()
      expect(segmentBody.segmentType, 'Segment segmentType should be work').toBe('work')
      expect(segmentBody.createdAt, 'Segment response should contain createdAt').toBeTruthy()
      const segmentId = segmentBody.id!

      // Step 4: Patch the segment to set endedAt
      const segmentEndedAt = new Date(Date.now() + 60000).toISOString()
      const patchSegmentResponse = await apiRequest(
        request,
        'PATCH',
        `/api/staff/timesheets/time-entries/${entryId}/segments/${segmentId}`,
        {
          token,
          data: { endedAt: segmentEndedAt },
        },
      )
      expect(patchSegmentResponse.ok(), 'PATCH segment should succeed').toBeTruthy()
      const patchBody = (await patchSegmentResponse.json()) as {
        ok?: boolean
        item?: Record<string, unknown>
      }
      expect(patchBody.ok, 'Patch response should return ok: true').toBe(true)
      expect(patchBody.item, 'Patch response should contain item').toBeTruthy()
      expect(patchBody.item!.id).toBe(segmentId)
      expect(patchBody.item!.endedAt).toBeTruthy()

      // Step 5: Stop timer
      const timerStopResponse = await apiRequest(request, 'POST', `/api/staff/timesheets/time-entries/${entryId}/timer-stop`, {
        token,
      })
      expect(timerStopResponse.ok(), 'POST timer-stop should succeed').toBeTruthy()
      const timerStopBody = (await timerStopResponse.json()) as { ok?: boolean; durationMinutes?: number }
      expect(timerStopBody.ok, 'Timer stop response should return ok: true').toBe(true)
      expect(typeof timerStopBody.durationMinutes, 'Timer stop should return durationMinutes as number').toBe('number')

      // Step 6: Verify the stopped entry has started_at and ended_at set
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
      const stoppedEntry = listEntriesBody.items!.find((item) => item.id === entryId)
      expect(stoppedEntry, 'Stopped entry should appear in list').toBeTruthy()
      expect(stoppedEntry!.started_at, 'Stopped entry should have started_at set').toBeTruthy()
      expect(stoppedEntry!.ended_at, 'Stopped entry should have ended_at set').toBeTruthy()
      expect(stoppedEntry!.source).toBe('timer')
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
