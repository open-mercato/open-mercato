import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_JOBS_PATH, createScheduleJob, deleteScheduleJob, getScheduleJobById } from './helpers/scheduler'

type ForbiddenBody = { error?: string; requiredFeatures?: string[] }

/**
 * TC-SCHED-006: PUT and DELETE on /api/scheduler/jobs are gated by
 * `scheduler.jobs.manage`. A user holding only `scheduler.jobs.view` can read
 * schedules but is denied with 403 on both mutating verbs, and a failed attempt
 * leaves the schedule untouched.
 */
test.describe('TC-SCHED-006: scheduler.jobs.manage gate on PUT/DELETE', () => {
  test('view-only user gets 403 on PUT and DELETE; schedule stays intact', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId.length, 'admin token should carry an organization id').toBeGreaterThan(0)

    const stamp = `${Date.now()}`
    let roleId: string | null = null
    let userId: string | null = null
    let scheduleId: string | null = null

    try {
      // A role that can view schedules but not manage them.
      roleId = await createRoleFixture(request, adminToken, { name: `sched-view-only-${stamp}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['scheduler.jobs.view'] })

      const email = `sched-view-only-${stamp}@example.com`
      // Password must satisfy the default policy (min length + digit + uppercase + special).
      const password = 'Sched-View-1!'
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'Scheduler View Only',
      })
      const viewToken = await getAuthToken(request, email, password)

      scheduleId = await createScheduleJob(request, adminToken)

      // Sanity: the view-only user authenticates and CAN list (has the view feature),
      // so the 403s below are specifically about the missing manage feature.
      const listResponse = await apiRequest(request, 'GET', SCHEDULER_JOBS_PATH, { token: viewToken })
      expect(listResponse.status()).toBe(200)

      // PUT denied
      const putResponse = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token: viewToken,
        data: { id: scheduleId, name: 'Should-Not-Apply' },
      })
      expect(putResponse.status()).toBe(403)
      const putBody = await readJsonSafe<ForbiddenBody>(putResponse)
      expect(putBody?.requiredFeatures ?? []).toContain('scheduler.jobs.manage')

      // DELETE denied
      const deleteResponse = await apiRequest(request, 'DELETE', SCHEDULER_JOBS_PATH, {
        token: viewToken,
        data: { id: scheduleId },
      })
      expect(deleteResponse.status()).toBe(403)
      const deleteBody = await readJsonSafe<ForbiddenBody>(deleteResponse)
      expect(deleteBody?.requiredFeatures ?? []).toContain('scheduler.jobs.manage')

      // The schedule is unchanged and still present (admin can read it).
      const after = await getScheduleJobById(request, adminToken, scheduleId)
      expect(after).not.toBeNull()
      expect(after!.name).not.toBe('Should-Not-Apply')
    } finally {
      await deleteScheduleJob(request, adminToken, scheduleId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
