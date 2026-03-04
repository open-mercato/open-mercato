import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return (await response.json().catch(() => ({}))) as JsonRecord
}

const TEST_INTEGRATION_ID = 'test_mapping_integration'
const ENTITY_TYPE = 'catalog.product'

/**
 * TC-DS-002: Data sync field mapping CRUD APIs
 *
 * Tests the mapping management endpoints added by SPEC-045b.
 * Requires POST/GET /api/data_sync/mappings and GET/PUT/DELETE /api/data_sync/mappings/:id routes.
 * Uses a generic integration ID — works without any specific provider module.
 */

async function isMappingRouteAvailable(
  request: Parameters<typeof getAuthToken>[0],
  token: string,
): Promise<boolean> {
  const response = await apiRequest(request, 'GET', '/api/data_sync/mappings?page=1&pageSize=1', { token })
  return response.status() !== 404
}

test.describe('TC-DS-002: Data sync field mapping CRUD APIs', () => {
  test('create, read, update, and delete a field mapping', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    if (!(await isMappingRouteAvailable(request, token))) {
      test.skip(true, 'Mapping routes not deployed in current environment')
      return
    }

    let mappingId: string | undefined

    try {
      // Create mapping
      const createResponse = await apiRequest(request, 'POST', '/api/data_sync/mappings', {
        token,
        data: {
          integrationId: TEST_INTEGRATION_ID,
          entityType: ENTITY_TYPE,
          mapping: {
            title: 'name',
            sku: 'handle',
            description: 'body_html',
          },
        },
      })
      expect([200, 201]).toContain(createResponse.status())
      const createBody = await readJson(createResponse)
      expect(createBody).toHaveProperty('id')
      expect(createBody.integrationId).toBe(TEST_INTEGRATION_ID)
      expect(createBody.entityType).toBe(ENTITY_TYPE)
      expect(createBody.mapping).toBeDefined()
      const mappingData = createBody.mapping as JsonRecord
      expect(mappingData.title).toBe('name')
      expect(mappingData.sku).toBe('handle')
      mappingId = String(createBody.id)

      // List mappings and verify created mapping appears
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/data_sync/mappings?integrationId=${TEST_INTEGRATION_ID}&entityType=${ENTITY_TYPE}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJson(listResponse)
      expect(listBody).toHaveProperty('items')
      expect(Array.isArray(listBody.items)).toBe(true)
      const listItems = listBody.items as JsonRecord[]
      expect(listItems.map((item) => String(item.id))).toContain(mappingId)
      expect(listBody).toHaveProperty('total')
      expect(listBody).toHaveProperty('page')
      expect(listBody).toHaveProperty('totalPages')

      // Get mapping by ID
      const getResponse = await apiRequest(request, 'GET', `/api/data_sync/mappings/${mappingId}`, { token })
      expect(getResponse.status()).toBe(200)
      const getBody = await readJson(getResponse)
      expect(getBody.id).toBe(mappingId)
      expect(getBody.integrationId).toBe(TEST_INTEGRATION_ID)
      expect(getBody.entityType).toBe(ENTITY_TYPE)
      expect(getBody).toHaveProperty('createdAt')
      expect(getBody).toHaveProperty('updatedAt')

      // Update mapping
      const updateResponse = await apiRequest(request, 'PUT', `/api/data_sync/mappings/${mappingId}`, {
        token,
        data: {
          mapping: {
            title: 'name',
            sku: 'handle',
            description: 'body_html',
            price: 'variants.0.price',
          },
        },
      })
      expect(updateResponse.status()).toBe(200)
      const updateBody = await readJson(updateResponse)
      expect(updateBody.id).toBe(mappingId)
      const updatedMapping = updateBody.mapping as JsonRecord
      expect(updatedMapping.price).toBe('variants.0.price')

      // Verify update persisted
      const verifyResponse = await apiRequest(request, 'GET', `/api/data_sync/mappings/${mappingId}`, { token })
      expect(verifyResponse.status()).toBe(200)
      const verifyBody = await readJson(verifyResponse)
      const verifiedMapping = verifyBody.mapping as JsonRecord
      expect(verifiedMapping.price).toBe('variants.0.price')
    } finally {
      // Cleanup: delete the mapping
      if (mappingId) {
        const deleteResponse = await apiRequest(request, 'DELETE', `/api/data_sync/mappings/${mappingId}`, { token })
        expect(deleteResponse.status()).toBe(200)
        const deleteBody = await readJson(deleteResponse)
        expect(deleteBody.deleted).toBe(true)

        // Verify deletion
        const getDeletedResponse = await apiRequest(request, 'GET', `/api/data_sync/mappings/${mappingId}`, { token })
        expect(getDeletedResponse.status()).toBe(404)
      }
    }
  })

  test('creating mapping with same integration+entity upserts existing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    if (!(await isMappingRouteAvailable(request, token))) {
      test.skip(true, 'Mapping routes not deployed in current environment')
      return
    }

    let mappingId: string | undefined

    try {
      // Create initial mapping
      const createResponse = await apiRequest(request, 'POST', '/api/data_sync/mappings', {
        token,
        data: {
          integrationId: TEST_INTEGRATION_ID,
          entityType: 'catalog.category',
          mapping: { name: 'title' },
        },
      })
      expect([200, 201]).toContain(createResponse.status())
      const createBody = await readJson(createResponse)
      mappingId = String(createBody.id)

      // Create again with same integration+entity — should upsert
      const upsertResponse = await apiRequest(request, 'POST', '/api/data_sync/mappings', {
        token,
        data: {
          integrationId: TEST_INTEGRATION_ID,
          entityType: 'catalog.category',
          mapping: { name: 'title', slug: 'handle' },
        },
      })
      expect(upsertResponse.status()).toBe(200)
      const upsertBody = await readJson(upsertResponse)
      expect(upsertBody.id).toBe(mappingId)
      const upsertedMapping = upsertBody.mapping as JsonRecord
      expect(upsertedMapping.slug).toBe('handle')
    } finally {
      if (mappingId) {
        await apiRequest(request, 'DELETE', `/api/data_sync/mappings/${mappingId}`, { token })
      }
    }
  })

  test('list mappings returns paginated response with default pageSize', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    if (!(await isMappingRouteAvailable(request, token))) {
      test.skip(true, 'Mapping routes not deployed in current environment')
      return
    }

    const listResponse = await apiRequest(request, 'GET', '/api/data_sync/mappings?page=1', { token })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    expect(listBody).toHaveProperty('items')
    expect(Array.isArray(listBody.items)).toBe(true)
    expect(listBody.page).toBe(1)
    expect(listBody.pageSize).toBe(20)
    expect(typeof listBody.totalPages).toBe('number')
  })

  test('get non-existent mapping returns 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    if (!(await isMappingRouteAvailable(request, token))) {
      test.skip(true, 'Mapping routes not deployed in current environment')
      return
    }

    const getResponse = await apiRequest(
      request,
      'GET',
      '/api/data_sync/mappings/00000000-0000-0000-0000-000000000000',
      { token },
    )
    expect(getResponse.status()).toBe(404)
  })
})
