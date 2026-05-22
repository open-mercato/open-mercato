import { expect, test } from '@playwright/test'
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
}

/**
 * TC-AUTH-037: itemOrder is persisted and round-trips through GET/POST/PUT.
 * Validates the cross-locale shape: variant settings include `itemOrder` keyed
 * by group key, with arrays of item keys preserving the user-defined ordering.
 */
test.describe('TC-AUTH-037: Sidebar variant itemOrder persistence', () => {
  test('persists itemOrder on POST and PUT and returns it on GET', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `qa-itemorder-${Date.now()}`
    const initialItemOrder = {
      catalog: ['catalog-products', 'catalog-categories'],
      customers: ['customers-people', 'customers-companies'],
    }
    const updatedItemOrder = {
      catalog: ['catalog-categories', 'catalog-products'],
      customers: ['customers-companies', 'customers-people'],
    }
    let createdId: string | null = null
    try {
      // POST with non-trivial itemOrder.
      const createResponse = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: {
          name,
          settings: {
            groupOrder: ['catalog', 'customers'],
            groupLabels: {},
            itemLabels: {},
            hiddenItems: [],
            itemOrder: initialItemOrder,
          },
          isActive: false,
        },
      })
      expect(createResponse.ok()).toBeTruthy()
      const createdBody = (await createResponse.json()) as { variant?: Variant }
      const created = createdBody.variant
      expect(created).toBeTruthy()
      createdId = created!.id
      expect(created!.settings.itemOrder).toEqual(initialItemOrder)

      // GET list should round-trip itemOrder.
      const listResponse = await apiRequest(request, 'GET', '/api/auth/sidebar/variants', { token })
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as { variants?: Variant[] }
      const fetched = (listBody.variants ?? []).find((v) => v.id === createdId)
      expect(fetched?.settings.itemOrder).toEqual(initialItemOrder)

      // PUT to update itemOrder.
      const updateResponse = await apiRequest(request, 'PUT', `/api/auth/sidebar/variants/${encodeURIComponent(createdId!)}`, {
        token,
        data: {
          name,
          settings: {
            groupOrder: ['catalog', 'customers'],
            groupLabels: {},
            itemLabels: {},
            hiddenItems: [],
            itemOrder: updatedItemOrder,
          },
          isActive: false,
        },
      })
      expect(updateResponse.ok()).toBeTruthy()
      const updatedBody = (await updateResponse.json()) as { variant?: Variant }
      expect(updatedBody.variant?.settings.itemOrder).toEqual(updatedItemOrder)
    } finally {
      if (createdId) {
        await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(createdId)}`, { token }).catch(() => {})
      }
    }
  })
})
