import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { PROGRESS_JOBS_PATH, cancelProgressJob, uniqueJobName, uniqueJobType } from './helpers/progress'

type CreateError = { error?: string; details?: { fieldErrors?: Record<string, string[]> } }

/**
 * TC-PROG-008: Invalid create requests return 400 with field-level details,
 * unknown fields are stripped (still 201), and valid requests create a job.
 */
test.describe('TC-PROG-008: progress job creation input validation', () => {
  test('rejects invalid payloads and accepts valid ones', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const createdIds: string[] = []
    try {
      const post = (data: unknown) => apiRequest(request, 'POST', PROGRESS_JOBS_PATH, { token, data })

      // Missing jobType -> 400 with a flattened field error.
      const missingType = await post({ name: uniqueJobName('QA Missing Type') })
      expect(missingType.status()).toBe(400)
      const missingTypeBody = await readJsonSafe<CreateError>(missingType)
      expect(missingTypeBody?.error).toBe('Invalid input')
      expect(missingTypeBody?.details?.fieldErrors?.jobType?.length ?? 0).toBeGreaterThan(0)

      // jobType longer than 100 chars -> 400.
      const longType = await post({ jobType: 'a'.repeat(101), name: uniqueJobName('QA Long Type') })
      expect(longType.status()).toBe(400)
      expect((await readJsonSafe<CreateError>(longType))?.details?.fieldErrors?.jobType?.length ?? 0).toBeGreaterThan(0)

      // Missing name -> 400.
      const missingName = await post({ jobType: uniqueJobType('qa-prog-008') })
      expect(missingName.status()).toBe(400)
      expect((await readJsonSafe<CreateError>(missingName))?.details?.fieldErrors?.name?.length ?? 0).toBeGreaterThan(0)

      // Negative totalCount -> 400 (schema requires a positive integer).
      const negativeTotal = await post({
        jobType: uniqueJobType('qa-prog-008'),
        name: uniqueJobName('QA Negative Total'),
        totalCount: -5,
      })
      expect(negativeTotal.status()).toBe(400)
      expect((await readJsonSafe<CreateError>(negativeTotal))?.details?.fieldErrors?.totalCount?.length ?? 0).toBeGreaterThan(0)

      // Valid payload with an unknown field -> 201, unknown field ignored.
      const extraField = await post({
        jobType: uniqueJobType('qa-prog-008'),
        name: uniqueJobName('QA Extra Field'),
        cancellable: true,
        bogusUnknownField: 'ignored',
      })
      expect(extraField.status()).toBe(201)
      const extraId = (await readJsonSafe<{ id?: string }>(extraField))?.id
      expect(typeof extraId).toBe('string')
      if (extraId) createdIds.push(extraId)

      // Plain valid payload -> 201.
      const valid = await post({
        jobType: uniqueJobType('qa-prog-008'),
        name: uniqueJobName('QA Valid'),
        cancellable: true,
      })
      expect(valid.status()).toBe(201)
      const validId = (await readJsonSafe<{ id?: string }>(valid))?.id
      expect(typeof validId).toBe('string')
      if (validId) createdIds.push(validId)
    } finally {
      for (const id of createdIds) await cancelProgressJob(request, token, id)
    }
  })
})
