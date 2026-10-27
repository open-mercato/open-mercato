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
 * TC-PM-002: floors (name, size)
 * Renaming and growing a floor works and grows its covering default space; shrinking it below a
 * unit on it is refused with 422 naming the unit.
 */
test.describe('TC-PM-002: floor resize', () => {
  test('refuses resizing a floor smaller than a unit on it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Resize ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [space] = await listSpaces(request, token, floor.id)
      const unit = await createUnit(request, token, {
        floorId: floor.id,
        spaceId: space.id,
        name: 'Corner office',
        catalogCategoryId: products.categoryId,
        catalogProductId: products.productId,
        x: 14,
        y: 2,
        width: 5,
        depth: 4,
      })
      expect(unit.status()).toBe(201)

      const grown = await apiRequest(request, 'PUT', '/api/property_management/floors', {
        token,
        data: { id: floor.id, name: 'Ground Floor — Reception', sizeX: 30, sizeY: 12 },
      })
      expect(grown.status()).toBe(200)
      const [grownSpace] = await listSpaces(request, token, floor.id)
      expect(grownSpace).toMatchObject({ isDefault: true, width: 30, depth: 12 })

      const shrunk = await apiRequest(request, 'PUT', '/api/property_management/floors', {
        token,
        data: { id: floor.id, sizeX: 16 },
      })
      const body = await readJsonSafe<{ code?: string; error?: string }>(shrunk)
      expect(shrunk.status()).toBe(422)
      expect(body?.code).toBe('floor_resize_strands')
      expect(body?.error).toContain('Corner office')
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
