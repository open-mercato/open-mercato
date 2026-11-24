import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { cancelProgressJob, createProgressJob, progressJobPath } from './helpers/progress'

/**
 * TC-PROG-013: GET and PUT on /api/progress/jobs/[id] answer a malformed id with the same
 * non-disclosing 404 as a missing job instead of a 500, while a real job id, in any letter case,
 * still resolves.
 */
test.describe('TC-PROG-013: malformed progress job id is a not-found answer', () => {
  test('answers GET and PUT for a non-uuid id with 404 and keeps real ids reachable', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let jobId: string | null = null
    try {
      for (const malformedId of ['not-a-uuid', '12345']) {
        const getResponse = await apiRequest(request, 'GET', progressJobPath(malformedId), { token: adminToken })
        expect(getResponse.status(), `GET ${malformedId} is not found`).toBe(404)
        expect((await readJsonSafe<{ error?: string }>(getResponse))?.error).toBe('Not found')

        const putResponse = await apiRequest(request, 'PUT', progressJobPath(malformedId), {
          token: adminToken,
          data: { processedCount: 1 },
        })
        expect(putResponse.status(), `PUT ${malformedId} is not found`).toBe(404)
        expect((await readJsonSafe<{ error?: string }>(putResponse))?.error).toBe('Not found')
      }

      const unknownId = '00000000-0000-4000-8000-000000000000'
      const unknownResponse = await apiRequest(request, 'GET', progressJobPath(unknownId), { token: adminToken })
      expect(unknownResponse.status(), 'unknown well-formed id keeps the same 404').toBe(404)
      expect((await readJsonSafe<{ error?: string }>(unknownResponse))?.error).toBe('Not found')

      jobId = await createProgressJob(request, adminToken, { totalCount: 10 })

      const upperGet = await apiRequest(request, 'GET', progressJobPath(jobId.toUpperCase()), { token: adminToken })
      expect(upperGet.status(), 'uppercase spelling of a real id still resolves').toBe(200)
      expect((await readJsonSafe<{ id?: string }>(upperGet))?.id).toBe(jobId)

      const realPut = await apiRequest(request, 'PUT', progressJobPath(jobId), {
        token: adminToken,
        data: { processedCount: 3 },
      })
      expect(realPut.status(), 'a real id still accepts updates').toBe(200)
    } finally {
      await cancelProgressJob(request, adminToken, jobId)
    }
  })
})
