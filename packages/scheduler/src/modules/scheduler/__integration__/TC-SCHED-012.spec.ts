import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_JOBS_PATH } from './helpers/scheduler'

/**
 * TC-SCHED-012: the execution-history route rejects a malformed schedule id with
 * a translated 400 before it reaches the database, instead of answering 500 with
 * the raw Postgres error text.
 */
test.describe('TC-SCHED-012: execution history rejects a malformed schedule id', () => {
  test('GET /jobs/not-a-uuid/executions answers 400 without the database error text', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', `${SCHEDULER_JOBS_PATH}/not-a-uuid/executions`, { token })
    const body = await readJsonSafe<{ error?: string }>(response)

    expect(response.status()).toBe(400)
    expect(typeof body?.error).toBe('string')
    expect(body?.error).not.toMatch(/invalid input syntax|uuid/i)
  })

  test('GET /jobs/<unknown well-formed id>/executions still answers 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const unknownId = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'

    const response = await apiRequest(request, 'GET', `${SCHEDULER_JOBS_PATH}/${unknownId}/executions`, { token })

    expect(response.status()).toBe(404)
  })
})
