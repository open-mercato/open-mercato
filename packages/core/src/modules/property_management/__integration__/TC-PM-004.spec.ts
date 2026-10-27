import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBuilding,
  createUnit,
  createUnitProducts,
  deleteBuildingIfExists,
  deleteUnitProducts,
  listFloors,
  listSpaces,
  stampOf,
  type UnitProductFixture,
} from './helpers'

type Period = { catalogProductId: string; validTo: string | null; use: string }

/**
 * TC-PM-004: units and the unit product history
 * An overlapping unit is refused with 422 naming the unit in the way; a product change through
 * `POST units/{id}/product` closes the open history period and opens a new one. (The active-lease
 * lock, 409, is covered with leases in Phase 2.)
 */
test.describe('TC-PM-004: units', () => {
  test('refuses overlaps and keeps a product history', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Units ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [space] = await listSpaces(request, token, floor.id)
      const base = { floorId: floor.id, spaceId: space.id, catalogCategoryId: products.categoryId, catalogProductId: products.productId }

      const first = await createUnit(request, token, { ...base, name: 'Office 201', x: 0, y: 0, width: 8, depth: 6 })
      const firstBody = await readJsonSafe<{ id?: string }>(first)
      expect(first.status()).toBe(201)
      const unitId = expectId(firstBody?.id, 'unit id')

      const clash = await createUnit(request, token, { ...base, name: 'Office 202', x: 6, y: 2, width: 6, depth: 4 })
      const clashBody = await readJsonSafe<{ error?: string; code?: string }>(clash)
      expect(clash.status()).toBe(422)
      expect(clashBody?.code).toBe('placement_invalid')
      expect(clashBody?.error).toContain('Office 201')

      const outside = await createUnit(request, token, { ...base, name: 'Office 203', x: 18, y: 0, width: 4, depth: 4 })
      expect(outside.status(), 'a unit sticking out of its space is refused').toBe(422)

      const changed = await apiRequest(request, 'POST', `/api/property_management/units/${unitId}/product`, {
        token,
        data: { catalogProductId: products.secondProductId },
      })
      expect(changed.status()).toBe(200)

      const history = await apiRequest(request, 'GET', `/api/property_management/units/${unitId}/product`, { token })
      const historyBody = await readJsonSafe<{ periods?: Period[]; productLocked?: boolean }>(history)
      const periods = historyBody?.periods ?? []
      expect(periods).toHaveLength(2)
      expect(periods.filter((period) => period.validTo === null).map((period) => period.catalogProductId)).toEqual([products.secondProductId])
      expect(periods.find((period) => period.catalogProductId === products?.productId)?.validTo).not.toBeNull()
      expect(historyBody?.productLocked).toBe(false)

      const listed = await readJsonSafe<{ items?: Array<{ id: string; catalogProductId: string; use: string | null }> }>(
        await apiRequest(request, 'GET', `/api/property_management/units?id=${unitId}`, { token }),
      )
      expect(listed?.items?.[0]).toMatchObject({ catalogProductId: products.secondProductId, use: 'leasable' })
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
