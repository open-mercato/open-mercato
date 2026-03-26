import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

async function getOrCreateChannel(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<string> {
  const listResponse = await apiRequest(request, 'GET', '/api/sales/channels?page=1&pageSize=1', { token })
  expect(listResponse.ok(), `Failed to list channels: ${listResponse.status()}`).toBeTruthy()
  const listBody = (await listResponse.json()) as { items?: Array<{ id: string }> }
  const existing = Array.isArray(listBody.items) ? listBody.items[0] : null
  if (existing?.id) return existing.id

  const stamp = Date.now()
  const createResponse = await apiRequest(request, 'POST', '/api/sales/channels', {
    token,
    data: { name: `QA Channel ${stamp}`, code: `qa-channel-${stamp}` },
  })
  expect(createResponse.ok(), `Failed to create channel fixture: ${createResponse.status()}`).toBeTruthy()
  const body = (await createResponse.json()) as { id?: string; channelId?: string }
  const channelId = body.channelId ?? body.id
  expect(typeof channelId === 'string' && channelId.length > 0, 'Channel id missing').toBeTruthy()
  return channelId as string
}

/** TC-CAT-017: Offer CRUD Lifecycle */
test.describe('TC-CAT-017: Offer CRUD Lifecycle', () => {
  test('should create an offer for a product and verify it appears in the list', async ({ request }) => {
    const stamp = Date.now()
    const title = `QA TC-CAT-017 Offer ${stamp}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      const channelId = await getOrCreateChannel(request, token)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-017 Product ${stamp}`,
        sku: `QA-CAT-017-${stamp}`,
      })

      const createResponse = await apiRequest(request, 'POST', '/api/catalog/offers', {
        token,
        data: { title, productId, channelId },
      })
      expect(createResponse.ok(), `Failed to create offer: ${createResponse.status()}`).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string }
      expect(typeof createBody.id === 'string' && createBody.id.length > 0, 'Offer id missing').toBeTruthy()

      const listResponse = await apiRequest(request, 'GET', '/api/catalog/offers?page=1&pageSize=50', { token })
      expect(listResponse.ok(), `Failed to list offers: ${listResponse.status()}`).toBeTruthy()
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.some((item) => item.id === createBody.id)
      expect(found, 'Created offer should appear in the list').toBeTruthy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should update offer title and verify changes persist', async ({ request }) => {
    const stamp = Date.now()
    const title = `QA TC-CAT-017 Update ${stamp}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      const channelId = await getOrCreateChannel(request, token)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-017 UpdProd ${stamp}`,
        sku: `QA-CAT-017-UPD-${stamp}`,
      })

      const createResponse = await apiRequest(request, 'POST', '/api/catalog/offers', {
        token,
        data: { title, productId, channelId },
      })
      expect(createResponse.ok(), `Failed to create offer fixture: ${createResponse.status()}`).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string }
      const offerId = createBody.id as string

      const updatedTitle = `QA TC-CAT-017 Updated ${stamp}`
      const updatedDescription = `QA TC-CAT-017 Desc ${stamp}`
      const updateResponse = await apiRequest(request, 'PUT', '/api/catalog/offers', {
        token,
        data: { id: offerId, title: updatedTitle, description: updatedDescription, isActive: false },
      })
      expect(updateResponse.ok(), `Failed to update offer: ${updateResponse.status()}`).toBeTruthy()

      const listResponse = await apiRequest(request, 'GET', '/api/catalog/offers?page=1&pageSize=50', { token })
      expect(listResponse.ok(), `Failed to list offers after update: ${listResponse.status()}`).toBeTruthy()
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const updated = items.find((item) => item.id === offerId)
      expect(updated, 'Updated offer should appear in the list').toBeTruthy()
      expect(updated?.title, 'Title should be updated').toBe(updatedTitle)
      expect(updated?.description, 'Description should be updated').toBe(updatedDescription)
      expect(updated?.isActive ?? updated?.is_active, 'isActive should be false').toBe(false)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  // NOTE: Spec says "Create offer with invalid date range → verify validation error"
  // but the offer API has no date fields (startDate/endDate). Testing empty title validation instead.
  test('should reject offer creation with invalid data', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      const channelId = await getOrCreateChannel(request, token)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-017 ValProd ${stamp}`,
        sku: `QA-CAT-017-VAL-${stamp}`,
      })

      const createResponse = await apiRequest(request, 'POST', '/api/catalog/offers', {
        token,
        data: { title: '', productId, channelId },
      })
      expect(
        [400, 422].includes(createResponse.status()),
        `Expected validation error for empty title, got ${createResponse.status()}`,
      ).toBeTruthy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should delete an offer and verify it is removed from the list', async ({ request }) => {
    const stamp = Date.now()
    const title = `QA TC-CAT-017 Delete ${stamp}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      const channelId = await getOrCreateChannel(request, token)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-017 DelProd ${stamp}`,
        sku: `QA-CAT-017-DEL-${stamp}`,
      })

      const createResponse = await apiRequest(request, 'POST', '/api/catalog/offers', {
        token,
        data: { title, productId, channelId },
      })
      expect(createResponse.ok(), `Failed to create offer fixture: ${createResponse.status()}`).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string }
      const offerId = createBody.id as string

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/offers?id=${encodeURIComponent(offerId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Failed to delete offer: ${deleteResponse.status()}`).toBeTruthy()

      const listResponse = await apiRequest(request, 'GET', '/api/catalog/offers?page=1&pageSize=50', { token })
      expect(listResponse.ok(), `Failed to list offers after delete: ${listResponse.status()}`).toBeTruthy()
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.some((item) => item.id === offerId)
      expect(found, 'Deleted offer should not appear in the list').toBeFalsy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
