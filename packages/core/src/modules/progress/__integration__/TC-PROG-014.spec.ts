import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  PROGRESS_ACTIVE_PATH,
  PROGRESS_FEATURES,
  cancelProgressJob,
  createProgressJob,
  createProgressUserWithFeatures,
  deleteProgressUser,
  type RestrictedProgressUser,
} from './helpers/progress'

async function readActiveJobs(request: APIRequestContext, token: string) {
  const response = await apiRequest(request, 'GET', PROGRESS_ACTIVE_PATH, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ active: Array<{ id: string; cancellable: boolean; canCancel?: boolean }> }>(response)
  return body?.active ?? []
}

test('TC-PROG-014: active progress reports cancellation access per authenticated caller', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  let owner: RestrictedProgressUser | null = null
  let adminJobId: string | null = null
  let ownedJobId: string | null = null

  try {
    adminJobId = await createProgressJob(request, adminToken)
    await withCredentialIsolatedRequest(async (ownerRequest) => {
      owner = await createProgressUserWithFeatures(ownerRequest, adminToken, [
        PROGRESS_FEATURES.view,
        PROGRESS_FEATURES.create,
        PROGRESS_FEATURES.cancel,
      ], 'cancel-owned')
      ownedJobId = await createProgressJob(ownerRequest, owner.token)

      const ownerJobs = await readActiveJobs(ownerRequest, owner.token)
      const ownedJob = ownerJobs.find((job) => job.id === ownedJobId)
      const otherJob = ownerJobs.find((job) => job.id === adminJobId)
      expect(ownedJob).toMatchObject({ cancellable: true, canCancel: true })
      expect(otherJob).toMatchObject({ cancellable: true, canCancel: false })
      expect(otherJob).not.toHaveProperty('startedByUserId')
    })

    const adminJobs = await readActiveJobs(request, adminToken)
    expect(adminJobs.find((job) => job.id === ownedJobId)).toMatchObject({ canCancel: true })
  } finally {
    await cancelProgressJob(request, adminToken, ownedJobId)
    await cancelProgressJob(request, adminToken, adminJobId)
    await deleteProgressUser(request, adminToken, owner)
  }
})
