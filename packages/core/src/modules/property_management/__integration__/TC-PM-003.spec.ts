import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBuilding,
  createSpace,
  createUnit,
  createUnitProducts,
  deleteBuildingIfExists,
  deleteUnitProducts,
  listFloors,
  listSpaces,
  stampOf,
  updateSpace,
  type UnitProductFixture,
} from './helpers'

/**
 * TC-PM-003: spaces
 * A floor is divided like a disk: the default space is shrunk first, then a new space goes into
 * the freed area. An overlapping space is refused (422, naming it); shrinking a space that would
 * strand a unit is refused (422, naming the unit); deleting the default space while it holds units
 * is refused (409).
 */
test.describe('TC-PM-003: spaces', () => {
  test('keeps spaces non-overlapping and units inside their space', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Spaces ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [whole] = await listSpaces(request, token, floor.id)

      const overlapping = await apiRequest(request, 'POST', '/api/property_management/spaces', {
        token,
        data: { floorId: floor.id, name: 'Bike room', x: 12, y: 0, width: 8, depth: 10 },
      })
      const overlapBody = await readJsonSafe<{ error?: string }>(overlapping)
      expect(overlapping.status()).toBe(422)
      expect(overlapBody?.error).toContain(whole.name)

      const shrink = await updateSpace(request, token, { id: whole.id, width: 12 })
      expect(shrink.status(), 'the default space can be shrunk while empty').toBe(200)
      const bikeRoomId = await createSpace(request, token, { floorId: floor.id, name: 'Bike room', purpose: 'Bikes', x: 12, y: 0, width: 8, depth: 10 })
      expect(bikeRoomId).toBeTruthy()

      const unit = await createUnit(request, token, {
        floorId: floor.id,
        spaceId: whole.id,
        name: 'Tiny Meeting Room',
        catalogCategoryId: products.categoryId,
        catalogProductId: products.productId,
        x: 6,
        y: 6,
        width: 4,
        depth: 4,
      })
      expect(unit.status()).toBe(201)

      const stranding = await updateSpace(request, token, { id: whole.id, depth: 8 })
      const strandingBody = await readJsonSafe<{ error?: string; code?: string }>(stranding)
      expect(stranding.status()).toBe(422)
      expect(strandingBody?.code).toBe('placement_invalid')
      expect(strandingBody?.error).toContain('Tiny Meeting Room')

      const deleteDefault = await apiRequest(request, 'DELETE', `/api/property_management/spaces?id=${whole.id}`, { token })
      const deleteBody = await readJsonSafe<{ code?: string }>(deleteDefault)
      expect(deleteDefault.status()).toBe(409)
      expect(deleteBody?.code).toBe('space_has_units')

      const deleteEmpty = await apiRequest(request, 'DELETE', `/api/property_management/spaces?id=${bikeRoomId}`, { token })
      expect(deleteEmpty.status()).toBe(200)
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
