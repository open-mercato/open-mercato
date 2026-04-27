import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

type Variant = { id: string; name: string }

const EMPTY_SETTINGS = { groupOrder: [], groupLabels: {}, itemLabels: {}, hiddenItems: [], itemOrder: {} }

/**
 * TC-AUTH-036: Recreating a soft-deleted sidebar variant under the same name succeeds.
 * Regression guard for the partial unique index migration (Migration20260427124900) —
 * the original full unique constraint considered tombstoned rows and blocked re-creation.
 */
test.describe('TC-AUTH-036: Sidebar variant soft-delete + recreate same name', () => {
  test('recreates a deleted variant with the same name without unique violation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `qa-soft-recreate-${Date.now()}`
    const createdIds: string[] = []
    try {
      // Create.
      const first = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: { name, settings: EMPTY_SETTINGS, isActive: false },
      })
      expect(first.ok()).toBeTruthy()
      const firstBody = (await first.json()) as { variant?: Variant }
      expect(firstBody.variant?.id).toBeTruthy()
      const firstId = firstBody.variant!.id
      createdIds.push(firstId)

      // Soft-delete.
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(firstId)}`, { token })
      expect(deleteResponse.ok()).toBeTruthy()

      // Recreate with the same name — should succeed (partial unique index ignores tombstoned rows).
      const second = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: { name, settings: EMPTY_SETTINGS, isActive: false },
      })
      expect(second.status()).toBe(200)
      const secondBody = (await second.json()) as { variant?: Variant }
      expect(secondBody.variant?.id).toBeTruthy()
      expect(secondBody.variant!.id).not.toBe(firstId)
      expect(secondBody.variant!.name).toBe(name)
      createdIds.push(secondBody.variant!.id)
    } finally {
      for (const id of createdIds) {
        await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(id)}`, { token }).catch(() => {})
      }
    }
  })
})
