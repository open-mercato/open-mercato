import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  PROGRESS_FEATURES,
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
 * `GET /api/progress/jobs`, `/api/progress/active`, and
 * `/api/progress/jobs/:id` require authentication plus `progress.view`.
 * Action endpoints remain gated by their action-specific features; that is
 * covered by TC-PROG-005/006/007.
 */
async function getUnauthenticated(request: APIRequestContext, path: string) {
  return request.fetch(path, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
}

async function expectProgressViewForbidden(response: APIResponse, label: string) {
  expect(response.status(), label).toBe(403)
  const body = await readJsonSafe<{ requiredFeatures?: string[] }>(response)
  expect(body?.requiredFeatures ?? []).toContain(PROGRESS_FEATURES.view)
}

test.describe('TC-PROG-004: Progress reads require progress.view', () => {
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

  test('rejects authenticated users without progress.view for list, active, and detail', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let restricted: RestrictedProgressUser | null = null
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, adminToken)
      restricted = await createProgressUserWithFeatures(request, adminToken, [], 'no-view')

      const listRes = await apiRequest(request, 'GET', PROGRESS_JOBS_PATH, { token: restricted.token })
      await expectProgressViewForbidden(listRes, 'list requires progress.view')

      const activeRes = await apiRequest(request, 'GET', PROGRESS_ACTIVE_PATH, { token: restricted.token })
      await expectProgressViewForbidden(activeRes, 'active requires progress.view')

      const detailRes = await apiRequest(request, 'GET', progressJobPath(jobId), { token: restricted.token })
      await expectProgressViewForbidden(detailRes, 'detail requires progress.view')
    } finally {
      await cancelProgressJob(request, adminToken, jobId)
      await deleteProgressUser(request, adminToken, restricted)
    }
  })

  test('allows authenticated users with progress.view to read list, active, and detail', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let reader: RestrictedProgressUser | null = null
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, adminToken)
      reader = await createProgressUserWithFeatures(request, adminToken, [PROGRESS_FEATURES.view], 'reader')

      const listRes = await apiRequest(request, 'GET', PROGRESS_JOBS_PATH, { token: reader.token })
      expect(listRes.status(), 'list is readable with progress.view').toBe(200)

      const activeRes = await apiRequest(request, 'GET', PROGRESS_ACTIVE_PATH, { token: reader.token })
      expect(activeRes.status(), 'active is readable with progress.view').toBe(200)

      const detailRes = await apiRequest(request, 'GET', progressJobPath(jobId), { token: reader.token })
      expect(detailRes.status(), 'detail is readable with progress.view').toBe(200)
    } finally {
      await cancelProgressJob(request, adminToken, jobId)
      await deleteProgressUser(request, adminToken, reader)
    }
  })
})
