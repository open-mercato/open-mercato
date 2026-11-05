import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

type Variant = { id: string; name: string }

const EMPTY_SETTINGS = { groupOrder: [], groupLabels: {}, itemLabels: {}, hiddenItems: [], itemOrder: {} }

/**
 * TC-AUTH-035: Duplicate sidebar variant name returns 409 with friendly error.
 * Validates that the unique-constraint violation is translated to a 409 response with
 * `code: 'duplicate_name'` instead of leaking a 500 with the raw Postgres error.
 */
test.describe('TC-AUTH-035: Sidebar variant duplicate name guard', () => {
  test('rejects duplicate variant name with 409 and clear message', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const uniqueName = `qa-dup-${Date.now()}`
    const createdIds: string[] = []
    try {
      // First create succeeds.
      const firstResponse = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: { name: uniqueName, settings: EMPTY_SETTINGS, isActive: false },
      })
      expect(firstResponse.ok()).toBeTruthy()
      const firstBody = (await firstResponse.json()) as { variant?: Variant }
      expect(firstBody.variant?.id).toBeTruthy()
      createdIds.push(firstBody.variant!.id)

      // Second create with the same name → 409.
      const dupResponse = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: { name: uniqueName, settings: EMPTY_SETTINGS, isActive: false },
      })
      expect(dupResponse.status()).toBe(409)
      const dupBody = (await dupResponse.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null
      expect(dupBody?.code).toBe('duplicate_name')
      expect(dupBody?.error).toMatch(/already exists/i)
    } finally {
      for (const id of createdIds) {
        await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(id)}`, { token }).catch(() => {})
      }
    }
  })
})
