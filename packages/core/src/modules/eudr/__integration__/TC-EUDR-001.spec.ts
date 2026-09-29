import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const PRODUCT_MAPPINGS_PATH = '/api/eudr/product-mappings'

type ProductMappingRow = {
  id: string
  productId?: string | null
  commodity?: string | null
  hsCode?: string | null
  isInScope?: boolean | null
  updatedAt?: string | null
}

async function readMappingById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<ProductMappingRow | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCT_MAPPINGS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  )
  expect(response.status(), `GET product mapping by id should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: ProductMappingRow[] }>(response)
  return body?.items?.[0] ?? null
}

async function deleteMappingIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(
    request,
    'DELETE',
    `${PRODUCT_MAPPINGS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined)
}

/**
 * TC-EUDR-001: Product mappings CRUD + RBAC.
 *
 * Covers unauthenticated 401s, admin CRUD/readback, duplicate/commodity
 * validation, optimistic-lock `updatedAt` exposure, and employee view-only RBAC.
 */
test.describe('TC-EUDR-001: Product mappings CRUD + RBAC', () => {
  test('enforces auth/RBAC and supports product mapping CRUD', async ({ request }) => {
    const productId = randomUUID()
    let mappingId: string | null = null

    const unauthenticatedGet = await request.get(PRODUCT_MAPPINGS_PATH)
    expect(unauthenticatedGet.status(), 'GET without auth should return 401').toBe(401)

    const unauthenticatedPost = await request.post(PRODUCT_MAPPINGS_PATH, {
      data: { productId: randomUUID(), commodity: 'coffee' },
    })
    expect(unauthenticatedPost.status(), 'POST without auth should return 401').toBe(401)

    const adminToken = await getAuthToken(request, 'admin')

    try {
      const createResponse = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
        token: adminToken,
        data: {
          productId,
          commodity: 'coffee',
          hsCode: '0901',
          productSnapshot: { name: 'QA EUDR coffee', sku: `TC-EUDR-001-${Date.now()}` },
          notes: 'TC-EUDR-001 create',
        },
      })
      expect(createResponse.status(), `create product mapping failed: ${createResponse.status()}`).toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      mappingId = expectId(created?.id, 'Product mapping create response should include id')

      const createdRow = await readMappingById(request, adminToken, mappingId)
      expect(createdRow, 'created mapping should be readable by id').toBeTruthy()
      expect(createdRow?.id).toBe(mappingId)
      expect(createdRow?.productId).toBe(productId)
      expect(createdRow?.commodity).toBe('coffee')
      expect(createdRow?.hsCode).toBe('0901')
      expect(typeof createdRow?.updatedAt === 'string' && createdRow.updatedAt.length > 0).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', PRODUCT_MAPPINGS_PATH, {
        token: adminToken,
        data: { id: mappingId, hsCode: '0901.21' },
      })
      expect(updateResponse.status(), `update product mapping failed: ${updateResponse.status()}`).toBe(200)
      const updated = await readJsonSafe<{ ok?: boolean; updatedAt?: string | null }>(updateResponse)
      expect(updated?.ok).toBe(true)
      expect(typeof updated?.updatedAt === 'string' && updated.updatedAt.length > 0).toBe(true)

      const updatedRow = await readMappingById(request, adminToken, mappingId)
      expect(updatedRow?.hsCode).toBe('0901.21')

      const duplicateResponse = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
        token: adminToken,
        data: { productId, commodity: 'coffee' },
      })
      expect(duplicateResponse.status(), 'duplicate active product/commodity mapping should return 400').toBe(400)

      const invalidCommodityResponse = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
        token: adminToken,
        data: { productId: randomUUID(), commodity: 'bananas' },
      })
      expect(invalidCommodityResponse.status(), 'invalid commodity should return 400').toBe(400)

      const employeeToken = await getAuthToken(request, 'employee')
      const employeeReadResponse = await apiRequest(
        request,
        'GET',
        `${PRODUCT_MAPPINGS_PATH}?id=${encodeURIComponent(mappingId)}`,
        { token: employeeToken },
      )
      expect(employeeReadResponse.status(), 'employee should be allowed to view mappings').toBe(200)

      const employeeCreateResponse = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
        token: employeeToken,
        data: { productId: randomUUID(), commodity: 'coffee' },
      })
      expect(employeeCreateResponse.status(), 'employee should not be allowed to create mappings').toBe(403)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${PRODUCT_MAPPINGS_PATH}?id=${encodeURIComponent(mappingId)}`,
        { token: adminToken },
      )
      expect(deleteResponse.status(), `delete product mapping failed: ${deleteResponse.status()}`).toBe(200)
      const deleted = await readJsonSafe<{ ok?: boolean }>(deleteResponse)
      expect(deleted?.ok).toBe(true)

      const afterDelete = await readMappingById(request, adminToken, mappingId)
      expect(afterDelete, 'deleted product mapping should disappear from id readback').toBeNull()
      mappingId = null
    } finally {
      await deleteMappingIfExists(request, adminToken, mappingId)
    }
  })
})
