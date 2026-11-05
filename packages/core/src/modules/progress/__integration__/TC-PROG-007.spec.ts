import { test, expect } from '@playwright/test'
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

/**
 * TC-PROG-007: `progress.cancel` gates job cancellation.
 * A user with `progress.view` but not `progress.cancel` is denied DELETE (403),
 * the job stays pending, and an admin can still cancel (status -> cancelled).
 */
test.describe('TC-PROG-007: progress.cancel gates job cancellation', () => {
  test('denies DELETE without progress.cancel and leaves the job cancellable', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let restricted: RestrictedProgressUser | null = null
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, adminToken, { cancellable: true })
      restricted = await createProgressUserWithFeatures(request, adminToken, [PROGRESS_FEATURES.view], 'no-cancel')

      const deniedRes = await apiRequest(request, 'DELETE', progressJobPath(jobId), { token: restricted.token })
      expect(deniedRes.status(), 'DELETE without progress.cancel is forbidden').toBe(403)
      const deniedBody = await readJsonSafe<{ requiredFeatures?: string[] }>(deniedRes)
      expect(deniedBody?.requiredFeatures ?? []).toContain(PROGRESS_FEATURES.cancel)

      // The job was not cancelled by the forbidden request.
      const afterDenied = await apiRequest(request, 'GET', progressJobPath(jobId), { token: adminToken })
      const afterDeniedBody = await readJsonSafe<{ status?: string }>(afterDenied)
      expect(afterDeniedBody?.status).toBe('pending')

      // Admin retains cancel access; a pending cancellable job cancels immediately.
      const allowedRes = await apiRequest(request, 'DELETE', progressJobPath(jobId), { token: adminToken })
      expect(allowedRes.status()).toBe(200)
      const allowedBody = await readJsonSafe<{ ok?: boolean }>(allowedRes)
      expect(allowedBody?.ok).toBe(true)

      const afterCancel = await apiRequest(request, 'GET', progressJobPath(jobId), { token: adminToken })
      const afterCancelBody = await readJsonSafe<{ status?: string }>(afterCancel)
      expect(afterCancelBody?.status).toBe('cancelled')
    } finally {
      await cancelProgressJob(request, adminToken, jobId)
      await deleteProgressUser(request, adminToken, restricted)
    }
  })
})
