import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { progressJobPath } from './helpers/progress'

/**
 * TC-PROG-009: Accessing a nonexistent job returns clean client errors, never
 * a 500 with a leaked stack.
 *   - GET    -> 404 { error: 'Not found' }
 *   - PUT    -> 404 { error: 'Not found' }            (service not-found is mapped, not surfaced as 500)
 *   - DELETE -> 400 { error: 'Cannot cancel this job' } (cancel guard rejects unknown jobs)
 */
test.describe('TC-PROG-009: nonexistent progress job returns clean not-found errors', () => {
  test('GET / PUT / DELETE on an unknown job id are 4xx with no stack leak', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const missingId = randomUUID()
    const path = progressJobPath(missingId)

    const getRes = await apiRequest(request, 'GET', path, { token })
    expect(getRes.status()).toBe(404)
    const getBody = await readJsonSafe<{ error?: string; stack?: unknown }>(getRes)
    expect(getBody?.error).toBe('Not found')
    expect(getBody).not.toHaveProperty('stack')

    const putRes = await apiRequest(request, 'PUT', path, { token, data: { processedCount: 1 } })
    expect(putRes.status(), 'PUT on a missing job must not 500').toBe(404)
    const putBody = await readJsonSafe<{ error?: string; stack?: unknown }>(putRes)
    expect(putBody?.error).toBe('Not found')
    expect(putBody).not.toHaveProperty('stack')

    const deleteRes = await apiRequest(request, 'DELETE', path, { token })
    expect(deleteRes.status()).toBe(400)
    const deleteBody = await readJsonSafe<{ error?: string; stack?: unknown }>(deleteRes)
    expect(deleteBody?.error).toBe('Cannot cancel this job')
    expect(deleteBody).not.toHaveProperty('stack')
  })
})
