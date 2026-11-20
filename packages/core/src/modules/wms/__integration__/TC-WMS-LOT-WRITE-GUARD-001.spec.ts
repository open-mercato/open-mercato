import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createProductFixture, createVariantFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture } from './helpers/wmsFixtures'

export const integrationMeta = { dependsOnModules: ['wms', 'catalog'] }

type Lot = { id: string; manufactured_at: string | null; best_before_at: string | null; expires_at: string | null }

test('lot create, update and fresh reads preserve nullable snake-case dates', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID()
  let productId: string | null = null
  let lotId: string | null = null
  try {
    productId = await createProductFixture(request, token, { title: `Lot guard ${stamp}`, sku: `LP-${stamp}` })
    const variantId = await createVariantFixture(request, token, {
      productId, name: `Lot guard ${stamp}`, sku: `LV-${stamp}`,
    })
    const nullDates = { manufactured_at: null, best_before_at: null, expires_at: null }
    lotId = await createCrudFixture(request, token, '/api/wms/lots', {
      catalogVariantId: variantId, sku: `LV-${stamp}`, lotNumber: stamp, ...nullDates,
    })
    const readLot = async () => {
      const response = await apiRequest(request, 'GET', `/api/wms/lots?ids=${lotId}`, { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items: Lot[] }>(response)
      const lot = body?.items.find((item) => item.id === lotId)
      expect(lot).toBeDefined()
      return lot
    }
    expect(await readLot()).toMatchObject(nullDates)
    const dates = {
      manufactured_at: '2026-01-01T00:00:00.000Z',
      best_before_at: '2026-06-01T00:00:00.000Z',
      expires_at: '2026-12-01T00:00:00.000Z',
    }
    const dated = await apiRequest(request, 'PUT', '/api/wms/lots', { token, data: { id: lotId, ...dates } })
    expect(dated.status()).toBe(200)
    expect(await readLot()).toMatchObject(dates)
    const cleared = await apiRequest(request, 'PUT', '/api/wms/lots', { token, data: { id: lotId, ...nullDates } })
    expect(cleared.status()).toBe(200)
    expect(await readLot()).toMatchObject(nullDates)
  } finally {
    await deleteGeneralEntityIfExists(request, token, '/api/wms/lots', lotId)
    await deleteCatalogProductIfExists(request, token, productId)
  }
})
