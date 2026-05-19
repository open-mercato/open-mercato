import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

type Variant = {
  id: string
  name: string
  isActive: boolean
  settings: {
    version: number
    groupOrder: string[]
    groupLabels: Record<string, string>
    itemLabels: Record<string, string>
    hiddenItems: string[]
    itemOrder: Record<string, string[]>
  }
  createdAt: string
  updatedAt: string | null
}

async function listVariants(request: APIRequestContext, token: string): Promise<Variant[]> {
  const response = await apiRequest(request, 'GET', '/api/auth/sidebar/variants', { token })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { variants?: Variant[] }
  return Array.isArray(body.variants) ? body.variants : []
}

async function deleteVariant(request: APIRequestContext, token: string, id: string): Promise<void> {
  await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(id)}`, { token }).catch(() => {})
}

/**
 * TC-AUTH-034: Sidebar variant API — full CRUD lifecycle
 * Validates POST (auto-name), GET list, PUT rename + active toggle, DELETE.
 */
test.describe('TC-AUTH-034: Sidebar variant API CRUD', () => {
  test('creates with auto-name, lists, renames, toggles active, deletes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const createdIds: string[] = []
    try {
      // POST without name → server auto-names ("My preferences", "My preferences 2", …)
      const createResponse = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: {
          settings: { groupOrder: [], groupLabels: {}, itemLabels: {}, hiddenItems: [], itemOrder: {} },
          isActive: true,
        },
      })
      expect(createResponse.ok()).toBeTruthy()
      const createdBody = (await createResponse.json()) as { variant?: Variant }
      const created = createdBody.variant
      expect(created).toBeTruthy()
      expect(created!.id).toMatch(/^[0-9a-f-]{36}$/i)
      expect(created!.name).toMatch(/^My preferences(?:\s+\d+)?$/)
      expect(created!.isActive).toBe(true)
      createdIds.push(created!.id)

      // GET should include the new variant.
      const listed = await listVariants(request, token)
      const found = listed.find((v) => v.id === created!.id)
      expect(found).toBeTruthy()
      expect(found!.name).toBe(created!.name)

      // PUT rename + flip active off.
      const renamed = `qa-renamed-${Date.now()}`
      const updateResponse = await apiRequest(request, 'PUT', `/api/auth/sidebar/variants/${encodeURIComponent(created!.id)}`, {
        token,
        data: { name: renamed, isActive: false },
      })
      expect(updateResponse.ok()).toBeTruthy()
      const updatedBody = (await updateResponse.json()) as { variant?: Variant }
      expect(updatedBody.variant?.name).toBe(renamed)
      expect(updatedBody.variant?.isActive).toBe(false)

      // DELETE removes it from the listing.
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(created!.id)}`, {
        token,
      })
      expect(deleteResponse.ok()).toBeTruthy()
      const finalList = await listVariants(request, token)
      expect(finalList.find((v) => v.id === created!.id)).toBeFalsy()
      // Successful delete → don't try to delete again in finally.
      createdIds.length = 0
    } finally {
      for (const id of createdIds) {
        await deleteVariant(request, token, id)
      }
    }
  })
})
