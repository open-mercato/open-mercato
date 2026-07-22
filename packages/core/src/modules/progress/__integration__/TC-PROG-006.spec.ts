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
 * TC-PROG-006: `progress.update` gates progress updates.
 * A user with `progress.view` but not `progress.update` is denied PUT (403),
 * the job is left untouched, and an admin can still update.
 */
test.describe('TC-PROG-006: progress.update gates progress updates', () => {
  test('denies PUT without progress.update and leaves the job unchanged', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let restricted: RestrictedProgressUser | null = null
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, adminToken, { totalCount: 10 })
      restricted = await createProgressUserWithFeatures(request, adminToken, [PROGRESS_FEATURES.view], 'no-update')

      const deniedRes = await apiRequest(request, 'PUT', progressJobPath(jobId), {
        token: restricted.token,
        data: { processedCount: 5, totalCount: 10 },
      })
      expect(deniedRes.status(), 'PUT without progress.update is forbidden').toBe(403)
      const deniedBody = await readJsonSafe<{ requiredFeatures?: string[] }>(deniedRes)
      expect(deniedBody?.requiredFeatures ?? []).toContain(PROGRESS_FEATURES.update)

      // The job was not advanced by the forbidden request.
      const afterDenied = await apiRequest(request, 'GET', progressJobPath(jobId), { token: adminToken })
      const afterDeniedBody = await readJsonSafe<{ processedCount?: number; progressPercent?: number }>(afterDenied)
      expect(afterDeniedBody?.processedCount).toBe(0)
      expect(afterDeniedBody?.progressPercent).toBe(0)

      // Admin retains update access.
      const allowedRes = await apiRequest(request, 'PUT', progressJobPath(jobId), {
        token: adminToken,
        data: { processedCount: 5, totalCount: 10 },
      })
      expect(allowedRes.status()).toBe(200)
      const allowedBody = await readJsonSafe<{ ok?: boolean; progressPercent?: number }>(allowedRes)
      expect(allowedBody?.ok).toBe(true)
      expect(allowedBody?.progressPercent).toBe(50)
    } finally {
      await cancelProgressJob(request, adminToken, jobId)
      await deleteProgressUser(request, adminToken, restricted)
    }
  })
})
