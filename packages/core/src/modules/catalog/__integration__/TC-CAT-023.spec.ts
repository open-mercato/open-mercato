import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

const ENTITY_ID = 'catalog:catalog_product'

async function uploadImageFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  productId: string,
): Promise<string> {
  // Create a minimal 1x1 PNG image buffer
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
    0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
    0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])

  const response = await request.post('http://localhost:3000/api/attachments', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      entityId: ENTITY_ID,
      recordId: productId,
      file: { name: `qa-test-${Date.now()}.png`, mimeType: 'image/png', buffer: Buffer.from(pngBytes) },
    },
  })
  expect(response.ok(), `Failed to upload image: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { item?: { id: string }; id?: string }
  const attachmentId = body.item?.id ?? body.id
  expect(typeof attachmentId === 'string' && attachmentId.length > 0, 'Attachment id missing').toBeTruthy()
  return attachmentId as string
}

/** TC-CAT-023: Product Media Management */
test.describe('TC-CAT-023: Product Media Management', () => {
  test('should upload image and verify media appears in gallery', async ({ page, request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-023 Upload ${stamp}`,
        sku: `QA-CAT-023-UP-${stamp}`,
      })

      // Upload image via API (same as what the UI does internally)
      const attachmentId = await uploadImageFixture(request, token, productId)

      // Verify media appears via GET endpoint
      const mediaResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(ENTITY_ID)}&recordId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(mediaResponse.ok(), `Failed to list media: ${mediaResponse.status()}`).toBeTruthy()
      const body = (await mediaResponse.json()) as { items?: Array<{ id: string }> }
      const items = body.items ?? []
      const found = items.some((item) => item.id === attachmentId)
      expect(found, 'Uploaded image should appear in media list').toBeTruthy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should set image as default and verify default media id', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-023 Default ${stamp}`,
        sku: `QA-CAT-023-DEF-${stamp}`,
      })

      const attachmentId = await uploadImageFixture(request, token, productId)

      // Set as default by updating the product's defaultMediaId
      const updateResponse = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, defaultMediaId: attachmentId },
      })
      expect(updateResponse.ok(), `Failed to set default media: ${updateResponse.status()}`).toBeTruthy()

      // Verify default media id persists
      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
        { token },
      )
      expect(getResponse.ok()).toBeTruthy()
      const getBody = (await getResponse.json()) as {
        items?: Array<{ defaultMediaId?: string; default_media_id?: string }>
      }
      const product = getBody.items?.[0]
      const defaultId = product?.defaultMediaId ?? product?.default_media_id
      expect(defaultId, 'Default media id should be set').toBe(attachmentId)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should remove image and verify it is removed from gallery', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-023 Remove ${stamp}`,
        sku: `QA-CAT-023-REM-${stamp}`,
      })

      const attachmentId = await uploadImageFixture(request, token, productId)

      // Delete the attachment
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/attachments?id=${encodeURIComponent(attachmentId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Failed to delete media: ${deleteResponse.status()}`).toBeTruthy()

      // Verify removed from gallery
      const mediaResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(ENTITY_ID)}&recordId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(mediaResponse.ok()).toBeTruthy()
      const body = (await mediaResponse.json()) as { items?: Array<{ id: string }> }
      const items = body.items ?? []
      const found = items.some((item) => item.id === attachmentId)
      expect(found, 'Removed image should not appear in media list').toBeFalsy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should verify GET /api/catalog/product-media returns correct items', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-023 List ${stamp}`,
        sku: `QA-CAT-023-LIST-${stamp}`,
      })

      // Upload two images
      await uploadImageFixture(request, token, productId)
      await uploadImageFixture(request, token, productId)

      // Verify product-media endpoint returns correct count
      const mediaResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/product-media?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(mediaResponse.ok(), `Product media endpoint returned ${mediaResponse.status()}`).toBeTruthy()
      const body = (await mediaResponse.json()) as { items?: Array<Record<string, unknown>> }
      expect(Array.isArray(body.items), 'Response should contain items array').toBeTruthy()
      expect((body.items ?? []).length).toBeGreaterThanOrEqual(2)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
