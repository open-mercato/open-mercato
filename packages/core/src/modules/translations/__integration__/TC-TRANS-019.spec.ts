import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const RESOURCE_ENTITY_TYPE = 'resources:resources_resource'
const RESOURCES_API = '/api/resources/resources'
const PRODUCT_ENTITY_TYPE = 'catalog:catalog_product'

type TranslationsBody = { translations?: Record<string, Record<string, string>> }

function readUndoToken(response: APIResponse): string {
  const header = response.headers()['x-om-operation'] ?? ''
  const encoded = header.startsWith('omop:') ? header.slice(5) : ''
  expect(encoded, 'x-om-operation header carries an omop: payload').not.toBe('')
  const payload = JSON.parse(decodeURIComponent(encoded)) as { undoToken?: string }
  expect(typeof payload.undoToken, 'undoToken present').toBe('string')
  return payload.undoToken as string
}

async function readTranslations(
  request: APIRequestContext,
  token: string,
  entityType: string,
  entityId: string,
): Promise<{ status: number; body: TranslationsBody }> {
  const response = await apiRequest(request, 'GET', `/api/translations/${entityType}/${entityId}`, { token })
  const body = response.ok() ? ((await response.json()) as TranslationsBody) : {}
  return { status: response.status(), body }
}

async function isResourceListed(request: APIRequestContext, token: string, resourceId: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `${RESOURCES_API}?ids=${encodeURIComponent(resourceId)}`, { token })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  return (body.items ?? []).some((item) => item.id === resourceId)
}

/**
 * TC-TRANS-019: Entity translations survive a soft delete so undo restores them
 * Covers DELETE /api/resources/resources (soft delete) + POST /api/audit_logs/audit-logs/actions/undo,
 * and DELETE /api/catalog/products (hard delete) against GET /api/translations/:entityType/:entityId.
 */
test.describe('TC-TRANS-019: Entity translations survive a soft delete so undo restores them', () => {
  test('undoing a resource delete restores the resource together with its translations', async ({ request }) => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    let token: string | null = null
    let resourceId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const createResponse = await apiRequest(request, 'POST', RESOURCES_API, {
        token,
        data: { name: `QA TC-TRANS-019 Resource ${stamp}` },
      })
      expect(createResponse.status(), 'resource create 201').toBe(201)
      resourceId = ((await createResponse.json()) as { id: string }).id
      expect(resourceId, 'resource id returned').toBeTruthy()

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${RESOURCE_ENTITY_TYPE}/${resourceId}`, {
        token,
        data: { de: { name: `Ressource ${stamp}`, description: 'Beschreibung' } },
      })
      expect(putResponse.ok(), `translation upsert failed: ${putResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(request, 'DELETE', `${RESOURCES_API}?id=${encodeURIComponent(resourceId)}`, { token })
      expect(deleteResponse.status(), 'resource delete 200').toBe(200)
      const undoToken = readUndoToken(deleteResponse)
      expect(await isResourceListed(request, token, resourceId), 'resource hidden after delete').toBe(false)

      const afterDelete = await readTranslations(request, token, RESOURCE_ENTITY_TYPE, resourceId)
      expect(afterDelete.status, 'translations kept while the resource is only soft-deleted').toBe(200)
      expect(afterDelete.body.translations?.de?.name).toBe(`Ressource ${stamp}`)

      const undoResponse = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token,
        data: { undoToken },
      })
      expect(undoResponse.status(), 'undo 200').toBe(200)
      expect(await isResourceListed(request, token, resourceId), 'resource listed again after undo').toBe(true)

      const afterUndo = await readTranslations(request, token, RESOURCE_ENTITY_TYPE, resourceId)
      expect(afterUndo.status, 'translations readable after undo').toBe(200)
      expect(afterUndo.body.translations?.de?.name).toBe(`Ressource ${stamp}`)
      expect(afterUndo.body.translations?.de?.description).toBe('Beschreibung')
    } finally {
      await deleteTranslationIfExists(request, token, RESOURCE_ENTITY_TYPE, resourceId)
      if (token && resourceId) {
        await apiRequest(request, 'DELETE', `${RESOURCES_API}?id=${encodeURIComponent(resourceId)}`, { token }).catch(() => undefined)
      }
    }
  })

  test('a hard delete still removes the record translations', async ({ request }) => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    let token: string | null = null
    let productId: string | null = null
    let translatedProductId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      productId = await createProductFixture(request, token, {
        title: `QA TC-TRANS-019 Product ${stamp}`,
        sku: `QA-TRANS-019-${stamp}`,
      })
      translatedProductId = productId

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${PRODUCT_ENTITY_TYPE}/${productId}`, {
        token,
        data: { de: { title: `Produkt ${stamp}` } },
      })
      expect(putResponse.ok(), `translation upsert failed: ${putResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'product delete 200').toBe(200)

      const afterDelete = await readTranslations(request, token, PRODUCT_ENTITY_TYPE, productId)
      expect(afterDelete.status, 'translations removed with the hard-deleted product').toBe(404)
      productId = null
    } finally {
      await deleteTranslationIfExists(request, token, PRODUCT_ENTITY_TYPE, translatedProductId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
