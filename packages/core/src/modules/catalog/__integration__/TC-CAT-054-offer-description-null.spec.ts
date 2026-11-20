import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-054: an offer description accepts an explicit null
 *
 * `GET /api/catalog/offers` returns `description: null` for an offer with no
 * stored description, but the write schema rejected that same value with a
 * 400, so a client could not send an offer back the way it read it. A null
 * description now takes the same path as an empty string: the offer falls back
 * to the product description.
 */
async function createRecord(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `POST ${path} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `POST ${path} should return an id`)
}

async function readOfferDescription(
  request: APIRequestContext,
  token: string,
  offerId: string,
): Promise<string | null | undefined> {
  const response = await apiRequest(request, 'GET', `/api/catalog/offers?id=${encodeURIComponent(offerId)}`, { token })
  expect(response.ok(), `GET offer should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string; description?: string | null }> }>(response)
  const offer = (body?.items ?? []).find((item) => item.id === offerId)
  expect(offer, 'the offer should be listed').toBeTruthy()
  return offer?.description
}

test.describe('TC-CAT-054: offer description accepts an explicit null', () => {
  test('PUT /api/catalog/offers and a nested product offer accept description null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const productDescription = `QA TC-CAT-054 product description ${stamp}`

    let channelId: string | null = null
    let productId: string | null = null
    let offerId: string | null = null

    try {
      channelId = await createRecord(request, token, '/api/sales/channels', {
        name: `QA TC-CAT-054 Channel ${stamp}`,
        code: `qa-tc-cat-054-${stamp}`,
      })
      productId = await createRecord(request, token, '/api/catalog/products', {
        title: `QA TC-CAT-054 Product ${stamp}`,
        sku: `QA-CAT-054-${stamp}`,
        description: productDescription,
      })
      offerId = await createRecord(request, token, '/api/catalog/offers', {
        productId,
        channelId,
        title: `QA TC-CAT-054 Offer ${stamp}`,
        description: `QA TC-CAT-054 offer description ${stamp}`,
      })

      const offerUpdate = await apiRequest(request, 'PUT', '/api/catalog/offers', {
        token,
        data: { id: offerId, description: null },
      })
      expect(offerUpdate.status(), 'PUT /api/catalog/offers with description null should succeed').toBe(200)
      expect(await readOfferDescription(request, token, offerId)).toBe(productDescription)

      const offerDescription = `QA TC-CAT-054 offer description again ${stamp}`
      const offerReset = await apiRequest(request, 'PUT', '/api/catalog/offers', {
        token,
        data: { id: offerId, description: offerDescription },
      })
      expect(offerReset.status(), 'PUT /api/catalog/offers with a new description should succeed').toBe(200)
      expect(await readOfferDescription(request, token, offerId)).toBe(offerDescription)

      const productUpdate = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: {
          id: productId,
          offers: [{ channelId, title: `QA TC-CAT-054 Offer ${stamp}`, description: null }],
        },
      })
      expect(productUpdate.status(), 'PUT /api/catalog/products with a nested offer description null should succeed').toBe(200)
      expect(await readOfferDescription(request, token, offerId)).toBe(productDescription)
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/catalog/offers', offerId)
      await deleteGeneralEntityIfExists(request, token, '/api/catalog/products', productId)
      await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
    }
  })
})
