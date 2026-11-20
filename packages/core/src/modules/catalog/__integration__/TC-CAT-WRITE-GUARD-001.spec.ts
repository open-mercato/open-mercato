import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('product create and update responses retain ignored fields across the real mappers', async ({ request }) => {
  const token = await getAuthToken(request)
  let productId: string | null = null
  const stamp = randomUUID()
  const ignoredFields = [{ key: 'made_up', reason: 'unknown' }]
  try {
    const created = await apiRequest(request, 'POST', '/api/catalog/products', {
      token, data: { title: `Guard ${stamp}`, sku: `GUARD-${stamp}`, made_up: 'create' },
    })
    expect(created.status()).toBe(201)
    const createdBody = await readJsonSafe<{ id: string; ignoredFields: unknown }>(created)
    productId = createdBody?.id ?? null
    expect(productId).toBeTruthy()
    expect(createdBody?.ignoredFields).toEqual(ignoredFields)

    const title = `Updated guard ${stamp}`
    const updated = await apiRequest(request, 'PUT', '/api/catalog/products', {
      token, data: { id: productId, title, made_up: 'update' },
    })
    expect(updated.status()).toBe(200)
    expect(await readJsonSafe<{ ignoredFields: unknown }>(updated)).toMatchObject({ ignoredFields })

    const detail = await apiRequest(request, 'GET', `/api/catalog/products?id=${productId}`, { token })
    expect(detail.status()).toBe(200)
    const body = await readJsonSafe<{ items: Array<{ id: string; title: string }> }>(detail)
    expect(body?.items.find((product) => product.id === productId)?.title).toBe(title)
  } finally {
    await deleteCatalogProductIfExists(request, token, productId)
  }
})
