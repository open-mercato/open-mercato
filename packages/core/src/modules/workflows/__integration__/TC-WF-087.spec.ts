import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-WF-087: GET /api/workflows/tasks/[id] answers a malformed id with the same
 * 404 body as a well-formed id that matches no task, instead of letting the
 * uuid column reject it as a 500.
 */
test.describe('TC-WF-087: user task detail with a malformed id', () => {
  test('a non-uuid id gets the missing-task 404, identical to an unknown uuid', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const unknown = await apiRequest(request, 'GET', `/api/workflows/tasks/${randomUUID()}`, { token })
    const malformed = await apiRequest(request, 'GET', '/api/workflows/tasks/not-a-uuid', { token })

    expect(unknown.status()).toBe(404)
    expect(malformed.status()).toBe(404)
    expect(await readJsonSafe(malformed)).toEqual(await readJsonSafe(unknown))
  })
})
