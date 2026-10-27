import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
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

/**
 * TC-PM-006: common areas
 * A common area may sit inside a space but never over a unit or another common area (422).
 */
test.describe('TC-PM-006: common areas', () => {
  test('refuses a common area overlapping a unit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Areas ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [space] = await listSpaces(request, token, floor.id)
      const unit = await createUnit(request, token, {
        floorId: floor.id,
        spaceId: space.id,
        name: 'Office 101',
        catalogCategoryId: products.categoryId,
        catalogProductId: products.productId,
        x: 0,
        y: 0,
        width: 6,
        depth: 6,
      })
      expect(unit.status()).toBe(201)

      const kitchen = await apiRequest(request, 'POST', '/api/property_management/common-areas', {
        token,
        data: { floorId: floor.id, name: 'Kitchen', kind: 'kitchen', x: 10, y: 0, width: 4, depth: 4 },
      })
      expect(kitchen.status(), 'a common area inside a space is fine').toBe(201)

      const clash = await apiRequest(request, 'POST', '/api/property_management/common-areas', {
        token,
        data: { floorId: floor.id, name: 'Toilets', kind: 'toilets', x: 4, y: 4, width: 3, depth: 3 },
      })
      const body = await readJsonSafe<{ error?: string }>(clash)
      expect(clash.status()).toBe(422)
      expect(body?.error).toContain('Office 101')

      const clashArea = await apiRequest(request, 'POST', '/api/property_management/common-areas', {
        token,
        data: { floorId: floor.id, name: 'Storage', kind: 'storage', x: 12, y: 2, width: 3, depth: 3 },
      })
      expect(clashArea.status(), 'common areas do not overlap each other').toBe(422)
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
