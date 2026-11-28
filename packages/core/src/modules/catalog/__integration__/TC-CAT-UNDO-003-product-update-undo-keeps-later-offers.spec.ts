import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
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

async function updateOffer(request: APIRequestContext, token: string, data: Item) {
  const response = await apiRequest(request, 'PUT', '/api/catalog/offers', { token, data })
  expect(response.ok(), `Failed to update offer: ${response.status()}`).toBeTruthy()
  return expectOperation(response, 'catalog.offers.update')
}

async function listOffers(productId: string): Promise<Item[]> {
  return withClient(async (client) => {
    const result = await client.query<Item>(
      'select id, title from catalog_product_offers where product_id = $1 order by id',
      [productId],
    )
    return result.rows
  })
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
 * TC-CAT-UNDO-003 (#7679): undoing a product update reverts only what that update changed.
 * Offers created afterwards through the offers API must survive the undo, while an offer the
 * update itself created is still removed. An offer the update removed is not overwritten when an
 * offer undo has already restored it, on the same product or on another one.
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
      const offers = await listOffers(productId)
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
      const afterUpdate = await listOffers(productId)
      expect(afterUpdate.map((offer) => offer.id), 'the update adds an offer').toHaveLength(2)

      await undoOk(request, token, operation.undoToken, 'catalog.products.update undo')

      const offers = await listOffers(productId)
      expect(offers.map((offer) => offer.id), 'undo removes the offer the update added').toEqual([existingOfferId])
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      for (const channelId of channelIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
      }
    }
  })

  test('undo keeps an offer the update removed when an offer undo already restored it', async ({ request }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    const channelIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      channelIds.push(await createChannel(request, token, `qa-undo-003-e-${stamp}`))
      productId = await createProductFixture(request, token, {
        title: `QA Undo 003 restored ${stamp}`,
        sku: `QA-UNDO-003-RES-${stamp}`,
      })
      const originalTitle = `Original offer ${stamp}`
      const offerId = await createOffer(request, token, { productId, channelId: channelIds[0], title: originalTitle })

      const offerOperation = await updateOffer(request, token, { id: offerId, title: `Edited offer ${stamp}` })
      const productOperation = await updateProduct(request, token, { id: productId, offers: [] })
      expect(await listOffers(productId), 'the update removes the offer').toEqual([])

      await undoOk(request, token, offerOperation.undoToken, 'catalog.offers.update undo')
      expect(await listOffers(productId), 'offer undo recreates the offer').toEqual([{ id: offerId, title: originalTitle }])

      await undoOk(request, token, productOperation.undoToken, 'catalog.products.update undo')

      expect(await listOffers(productId), 'product undo keeps the restored offer').toEqual([
        { id: offerId, title: originalTitle },
      ])
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      for (const channelId of channelIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
      }
    }
  })

  test('undo keeps an offer the update removed when an offer undo restored it under another product', async ({ request }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    const productIds: string[] = []
    const channelIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      channelIds.push(await createChannel(request, token, `qa-undo-003-f-${stamp}`))
      const sourceProductId = await createProductFixture(request, token, {
        title: `QA Undo 003 source ${stamp}`,
        sku: `QA-UNDO-003-SRC-${stamp}`,
      })
      productIds.push(sourceProductId)
      const targetTitle = `QA Undo 003 target ${stamp}`
      const targetProductId = await createProductFixture(request, token, {
        title: targetTitle,
        sku: `QA-UNDO-003-TGT-${stamp}`,
      })
      productIds.push(targetProductId)
      const offerTitle = `Moved offer ${stamp}`
      const offerId = await createOffer(request, token, {
        productId: sourceProductId,
        channelId: channelIds[0],
        title: offerTitle,
      })

      const moveOperation = await updateOffer(request, token, { id: offerId, productId: targetProductId })
      expect(await listOffers(targetProductId), 'the move attaches the offer to the target').toEqual([
        { id: offerId, title: offerTitle },
      ])
      const productOperation = await updateProduct(request, token, {
        id: targetProductId,
        title: `${targetTitle} renamed`,
        offers: [],
      })
      expect(await listOffers(targetProductId), 'the update removes the offer').toEqual([])

      await undoOk(request, token, moveOperation.undoToken, 'catalog.offers.update undo')
      expect(await listOffers(sourceProductId), 'offer undo restores the offer on the source').toEqual([
        { id: offerId, title: offerTitle },
      ])

      await undoOk(request, token, productOperation.undoToken, 'catalog.products.update undo')

      expect(await readProductTitle(request, token, targetProductId), 'undo reverts the target title').toBe(targetTitle)
      expect(await listOffers(sourceProductId), 'the restored offer stays on the source').toEqual([
        { id: offerId, title: offerTitle },
      ])
      expect(await listOffers(targetProductId), 'the target does not get a duplicate').toEqual([])
    } finally {
      for (const productId of productIds) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
      for (const channelId of channelIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
      }
    }
  })
})
