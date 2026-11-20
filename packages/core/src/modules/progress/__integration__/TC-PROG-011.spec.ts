import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  PROGRESS_FEATURES,
  cancelProgressJob,
  createProgressJob,
  createProgressUserWithFeatures,
  deleteProgressUser,
  progressJobPath,
  type RestrictedProgressUser,
} from './helpers/progress'

type JobDetail = { status?: string; processedCount?: number; startedByUserId?: string | null }

async function readJob(request: APIRequestContext, token: string, id: string): Promise<JobDetail | null> {
  const response = await apiRequest(request, 'GET', progressJobPath(id), { token })
  expect(response.status()).toBe(200)
  return readJsonSafe<JobDetail>(response)
}

/**
 * TC-PROG-011: `progress.update` / `progress.cancel` only reach jobs the caller started.
 * Another same-organization user holding both features but not `progress.manage` gets
 * PUT -> 404 and DELETE -> 400 and leaves the job untouched; the owner, a user granted
 * `progress.manage` explicitly and the admin (`progress.*`) keep update and cancel access.
 */
test.describe('TC-PROG-011: progress update/cancel are scoped to the job owner', () => {
  test('rejects a non-owner without progress.manage and keeps owner and manager access', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let owner: RestrictedProgressUser | null = null
    let intruder: RestrictedProgressUser | null = null
    let manager: RestrictedProgressUser | null = null
    let ownerJobId: string | null = null
    let managedJobId: string | null = null
    try {
      owner = await createProgressUserWithFeatures(request, adminToken, [
        PROGRESS_FEATURES.view,
        PROGRESS_FEATURES.create,
        PROGRESS_FEATURES.update,
        PROGRESS_FEATURES.cancel,
      ], 'owner')
      intruder = await createProgressUserWithFeatures(request, adminToken, [
        PROGRESS_FEATURES.view,
        PROGRESS_FEATURES.update,
        PROGRESS_FEATURES.cancel,
      ], 'intruder')
      manager = await createProgressUserWithFeatures(request, adminToken, [
        PROGRESS_FEATURES.view,
        PROGRESS_FEATURES.update,
        PROGRESS_FEATURES.cancel,
        PROGRESS_FEATURES.manage,
      ], 'manager')

      ownerJobId = await createProgressJob(request, owner.token, { cancellable: true, totalCount: 10 })
      managedJobId = await createProgressJob(request, owner.token, { cancellable: true, totalCount: 10 })
      expect((await readJob(request, owner.token, ownerJobId))?.startedByUserId).toBe(owner.userId)

      const intruderPut = await apiRequest(request, 'PUT', progressJobPath(ownerJobId), {
        token: intruder.token,
        data: { processedCount: 9 },
      })
      expect(intruderPut.status(), 'non-owner PUT without progress.manage is hidden').toBe(404)
      expect((await readJsonSafe<{ error?: string }>(intruderPut))?.error).toBe('Not found')

      const intruderDelete = await apiRequest(request, 'DELETE', progressJobPath(ownerJobId), { token: intruder.token })
      expect(intruderDelete.status(), 'non-owner DELETE without progress.manage is rejected').toBe(400)
      expect((await readJsonSafe<{ error?: string }>(intruderDelete))?.error).toBe('Cannot cancel this job')

      const untouched = await readJob(request, owner.token, ownerJobId)
      expect(untouched?.status).toBe('pending')
      expect(untouched?.processedCount).toBe(0)

      const ownerPut = await apiRequest(request, 'PUT', progressJobPath(ownerJobId), {
        token: owner.token,
        data: { processedCount: 3 },
      })
      expect(ownerPut.status(), 'owner keeps update access').toBe(200)

      const managerPut = await apiRequest(request, 'PUT', progressJobPath(ownerJobId), {
        token: manager.token,
        data: { processedCount: 4 },
      })
      expect(managerPut.status(), 'progress.manage reaches another user\'s job').toBe(200)
      expect((await readJob(request, owner.token, ownerJobId))?.processedCount).toBe(4)

      const adminPut = await apiRequest(request, 'PUT', progressJobPath(ownerJobId), {
        token: adminToken,
        data: { processedCount: 5 },
      })
      expect(adminPut.status(), 'admin progress.* reaches another user\'s job').toBe(200)
      expect((await readJob(request, owner.token, ownerJobId))?.processedCount).toBe(5)

      const ownerDelete = await apiRequest(request, 'DELETE', progressJobPath(ownerJobId), { token: owner.token })
      expect(ownerDelete.status(), 'owner keeps cancel access').toBe(200)
      expect((await readJob(request, owner.token, ownerJobId))?.status).toBe('cancelled')

      const managerDelete = await apiRequest(request, 'DELETE', progressJobPath(managedJobId), { token: manager.token })
      expect(managerDelete.status(), 'progress.manage can cancel another user\'s job').toBe(200)
      expect((await readJob(request, owner.token, managedJobId))?.status).toBe('cancelled')
    } finally {
      await cancelProgressJob(request, adminToken, ownerJobId)
      await cancelProgressJob(request, adminToken, managedJobId)
      await deleteProgressUser(request, adminToken, manager)
      await deleteProgressUser(request, adminToken, intruder)
      await deleteProgressUser(request, adminToken, owner)
    }
  })
})
