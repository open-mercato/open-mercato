import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  PROGRESS_ACTIVE_PATH,
  PROGRESS_JOBS_PATH,
  cancelProgressJob,
  createProgressJob,
  createProgressUserWithFeatures,
  deleteProgressUser,
  progressJobPath,
  type RestrictedProgressUser,
} from './helpers/progress'

/**
 * TC-PROG-004: Read-access RBAC contract for the progress GET endpoints.
 *
 * The issue proposed that a missing `progress.view` feature blocks list/detail
 * access. That does NOT match the implementation: `GET /api/progress/jobs`,
 * `/api/progress/active`, and `/api/progress/jobs/:id` declare `requireAuth`
 * only (no `requireFeatures`) — reads are gated by authentication, not by a
 * feature. The write endpoints ARE feature-gated; that is covered by
 * TC-PROG-005/006/007. This spec locks in the real read contract so a future
 * change to read gating is a deliberate, visible decision.
 */
async function getUnauthenticated(request: APIRequestContext, path: string) {
  return request.fetch(path, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
}

test.describe('TC-PROG-004: Progress reads are auth-gated, not feature-gated', () => {
  test('rejects unauthenticated reads with 401', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, token)

      expect((await getUnauthenticated(request, PROGRESS_JOBS_PATH)).status()).toBe(401)
      expect((await getUnauthenticated(request, PROGRESS_ACTIVE_PATH)).status()).toBe(401)
      expect((await getUnauthenticated(request, progressJobPath(jobId))).status()).toBe(401)
    } finally {
      await cancelProgressJob(request, token, jobId)
    }
  })

  test('allows an authenticated user without progress features to read list, active, and detail', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let restricted: RestrictedProgressUser | null = null
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, adminToken)
      restricted = await createProgressUserWithFeatures(request, adminToken, [], 'reader')

      const listRes = await apiRequest(request, 'GET', PROGRESS_JOBS_PATH, { token: restricted.token })
      expect(listRes.status(), 'list is readable without progress features').toBe(200)

      const activeRes = await apiRequest(request, 'GET', PROGRESS_ACTIVE_PATH, { token: restricted.token })
      expect(activeRes.status(), 'active is readable without progress features').toBe(200)

      const detailRes = await apiRequest(request, 'GET', progressJobPath(jobId), { token: restricted.token })
      expect(detailRes.status(), 'detail is readable without progress features').toBe(200)
    } finally {
      await cancelProgressJob(request, adminToken, jobId)
      await deleteProgressUser(request, adminToken, restricted)
    }
  })
})
