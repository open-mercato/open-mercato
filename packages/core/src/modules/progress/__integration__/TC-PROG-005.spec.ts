import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  PROGRESS_FEATURES,
  PROGRESS_JOBS_PATH,
  cancelProgressJob,
  createProgressJob,
  createProgressUserWithFeatures,
  deleteProgressUser,
  listProgressJobs,
  uniqueJobType,
  type RestrictedProgressUser,
} from './helpers/progress'

/**
 * TC-PROG-005: `progress.create` gates job creation.
 * A user with `progress.view` but not `progress.create` is denied POST (403),
 * no job is persisted, and an admin (progress.*) can still create.
 */
test.describe('TC-PROG-005: progress.create gates job creation', () => {
  test('denies POST without progress.create and creates nothing', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let restricted: RestrictedProgressUser | null = null
    let adminJobId: string | null = null
    const deniedJobType = uniqueJobType('qa-prog-005-denied')
    try {
      restricted = await createProgressUserWithFeatures(request, adminToken, [PROGRESS_FEATURES.view], 'no-create')

      const deniedRes = await apiRequest(request, 'POST', PROGRESS_JOBS_PATH, {
        token: restricted.token,
        data: { jobType: deniedJobType, name: 'should not be created', cancellable: true },
      })
      expect(deniedRes.status(), 'POST without progress.create is forbidden').toBe(403)
      const deniedBody = await readJsonSafe<{ requiredFeatures?: string[] }>(deniedRes)
      expect(deniedBody?.requiredFeatures ?? []).toContain(PROGRESS_FEATURES.create)

      // Nothing was persisted for the denied attempt.
      const persisted = await listProgressJobs(request, adminToken, { jobType: deniedJobType, status: 'pending,cancelled', pageSize: 100 })
      expect(persisted.items).toHaveLength(0)

      // Admin retains create access.
      adminJobId = await createProgressJob(request, adminToken, { jobType: uniqueJobType('qa-prog-005-allowed') })
      expect(adminJobId).toBeTruthy()
    } finally {
      await cancelProgressJob(request, adminToken, adminJobId)
      await deleteProgressUser(request, adminToken, restricted)
    }
  })
})
