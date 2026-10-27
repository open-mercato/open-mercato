import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
 * TC-PM-011: concurrent layout writes
 * Every geometry write locks the floor row before validating, so two concurrent overlapping unit
 * creates, a unit and a common area racing for the same spot, and a floor shrink racing a unit
 * create each end with exactly one winner and a 422 for the other.
 */
test.describe('TC-PM-011: layout write serialization', () => {
  test('lets exactly one of two overlapping concurrent writes win', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Race ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [space] = await listSpaces(request, token, floor.id)
      const base = { floorId: floor.id, spaceId: space.id, catalogCategoryId: products.categoryId, catalogProductId: products.productId }

      const units = await Promise.all([
        createUnit(request, token, { ...base, name: 'Race A', x: 0, y: 0, width: 6, depth: 6 }),
        createUnit(request, token, { ...base, name: 'Race B', x: 3, y: 3, width: 6, depth: 6 }),
      ])
      expect(units.map((response) => response.status()).sort()).toEqual([201, 422])

      const mixed = await Promise.all([
        createUnit(request, token, { ...base, name: 'Race C', x: 10, y: 0, width: 4, depth: 4 }),
        apiRequest(request, 'POST', '/api/property_management/common-areas', {
          token,
          data: { floorId: floor.id, name: 'Race kitchen', kind: 'kitchen', x: 12, y: 2, width: 4, depth: 4 },
        }),
      ])
      expect(mixed.map((response) => response.status()).sort()).toEqual([201, 422])

      const resizeRace = await Promise.all([
        apiRequest(request, 'PUT', '/api/property_management/floors', { token, data: { id: floor.id, sizeX: 17 } }),
        createUnit(request, token, { ...base, name: 'Race D', x: 17, y: 6, width: 3, depth: 3 }),
      ])
      const [resize, edgeUnit] = resizeRace.map((response) => response.status())
      expect([resize, edgeUnit].filter((status) => status === 422)).toHaveLength(1)
      expect([resize, edgeUnit].filter((status) => status === 200 || status === 201)).toHaveLength(1)
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
