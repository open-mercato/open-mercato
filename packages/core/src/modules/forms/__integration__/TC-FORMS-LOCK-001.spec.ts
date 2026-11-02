import { expect, test } from '@playwright/test'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFormFixture,
  deleteFormIfExists,
} from '@open-mercato/core/helpers/integration/formsFixtures'

test.describe('TC-FORMS-LOCK-001: form metadata optimistic locking', () => {
  test('rejects a stale form edit with the unified 409 payload', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let formId: string | null = null

    try {
      const form = await createFormFixture(request, token)
      formId = form.id
      const initialResponse = await apiRequest(request, 'GET', `/api/forms/${form.id}`, { token })
      const initial = await readJsonSafe<{ updatedAt?: string }>(initialResponse)
      expect(initialResponse.status()).toBe(200)
      expect(initial?.updatedAt).toBeTruthy()

      const firstWrite = await apiRequest(request, 'PATCH', `/api/forms/${form.id}`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial!.updatedAt as string },
        data: { description: 'first writer' },
      })
      expect(firstWrite.status(), await firstWrite.text()).toBe(200)

      const staleWrite = await apiRequest(request, 'PATCH', `/api/forms/${form.id}`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial!.updatedAt as string },
        data: { description: 'stale writer' },
      })
      const conflict = await readJsonSafe<{
        code?: string
        currentUpdatedAt?: string
        expectedUpdatedAt?: string
      }>(staleWrite)
      expect(staleWrite.status(), JSON.stringify(conflict)).toBe(409)
      expect(conflict?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
      expect(conflict?.expectedUpdatedAt).toBe(initial!.updatedAt)
      expect(conflict?.currentUpdatedAt).not.toBe(initial!.updatedAt)

      const currentResponse = await apiRequest(request, 'GET', `/api/forms/${form.id}`, { token })
      const current = await readJsonSafe<{ description?: string | null }>(currentResponse)
      expect(current?.description).toBe('first writer')
    } finally {
      await deleteFormIfExists(request, token, formId)
    }
  })
})
