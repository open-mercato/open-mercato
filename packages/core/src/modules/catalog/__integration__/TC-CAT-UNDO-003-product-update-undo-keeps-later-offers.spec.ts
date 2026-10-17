import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

type Item = Record<string, unknown>

async function createChannel(request: APIRequestContext, token: string, code: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/channels', {
    token,
    data: { name: `QA ${code}`, code },
  })
  const body = await readJsonSafe<{ id?: string; channelId?: string }>(response)
  expect(response.ok(), `Failed to create channel: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return expectId(body?.channelId ?? body?.id, 'channel id')
}

async function createOffer(
  request: APIRequestContext,
  token: string,
  data: { productId: string; channelId: string; title: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/offers', { token, data })
  const body = await readJsonSafe<Item>(response)
  expect(response.ok(), `Failed to create offer: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return expectId(body?.id, 'offer id')
}

async function listOffers(request: APIRequestContext, token: string, productId: string): Promise<Item[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/offers?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
    { token },
  )
  expect(response.ok(), `Failed to list offers: ${response.status()}`).toBeTruthy()
  const items = (await readJsonSafe<{ items?: Item[] }>(response))?.items ?? []
  return items.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

async function readProductTitle(request: APIRequestContext, token: string, productId: string): Promise<unknown> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.ok(), `Failed to read product: ${response.status()}`).toBeTruthy()
  return (await readJsonSafe<{ items?: Item[] }>(response))?.items?.[0]?.title
}

async function updateProduct(request: APIRequestContext, token: string, data: Item) {
  const response = await apiRequest(request, 'PUT', '/api/catalog/products', { token, data })
  expect(response.ok(), `Failed to update product: ${response.status()}`).toBeTruthy()
  return expectOperation(response, 'catalog.products.update')
}

/**
 * TC-CAT-UNDO-003 (#ISSUE): undoing a product update reverts only what that update changed.
 * Offers created afterwards through the offers API must survive the undo, while an offer the
 * update itself created is still removed.
 */
test.describe('TC-CAT-UNDO-003 product update undo keeps offers created later', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('an offer created after the update survives undo of the update', async ({ request }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    const channelIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      channelIds.push(await createChannel(request, token, `qa-undo-003-a-${stamp}`))
      channelIds.push(await createChannel(request, token, `qa-undo-003-b-${stamp}`))
      const originalTitle = `QA Undo 003 ${stamp}`
      productId = await createProductFixture(request, token, { title: originalTitle, sku: `QA-UNDO-003-${stamp}` })
      const existingOfferId = await createOffer(request, token, {
        productId,
        channelId: channelIds[0],
        title: `Existing offer ${stamp}`,
      })

      const operation = await updateProduct(request, token, { id: productId, title: `${originalTitle} renamed` })

      const laterOfferId = await createOffer(request, token, {
        productId,
        channelId: channelIds[1],
        title: `Later offer ${stamp}`,
      })

      await undoOk(request, token, operation.undoToken, 'catalog.products.update undo')

      expect(await readProductTitle(request, token, productId), 'undo reverts the product title').toBe(originalTitle)
      const offers = await listOffers(request, token, productId)
      expect(offers.map((offer) => offer.id), 'undo keeps both offers').toEqual(
        [existingOfferId, laterOfferId].sort(),
      )
      expect(offers.find((offer) => offer.id === laterOfferId)?.title).toBe(`Later offer ${stamp}`)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      for (const channelId of channelIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
      }
    }
  })

  test('undo still removes an offer the update created', async ({ request }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    const channelIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      channelIds.push(await createChannel(request, token, `qa-undo-003-c-${stamp}`))
      channelIds.push(await createChannel(request, token, `qa-undo-003-d-${stamp}`))
      productId = await createProductFixture(request, token, {
        title: `QA Undo 003 own ${stamp}`,
        sku: `QA-UNDO-003-OWN-${stamp}`,
      })
      const existingOfferId = await createOffer(request, token, {
        productId,
        channelId: channelIds[0],
        title: `Existing offer ${stamp}`,
      })

      const operation = await updateProduct(request, token, {
        id: productId,
        offers: [
          { channelId: channelIds[0], title: `Existing offer ${stamp}` },
          { channelId: channelIds[1], title: `Added by update ${stamp}` },
        ],
      })
      const afterUpdate = await listOffers(request, token, productId)
      expect(afterUpdate.map((offer) => offer.id), 'the update adds an offer').toHaveLength(2)

      await undoOk(request, token, operation.undoToken, 'catalog.products.update undo')

      const offers = await listOffers(request, token, productId)
      expect(offers.map((offer) => offer.id), 'undo removes the offer the update added').toEqual([existingOfferId])
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      for (const channelId of channelIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
      }
    }
  })
})
