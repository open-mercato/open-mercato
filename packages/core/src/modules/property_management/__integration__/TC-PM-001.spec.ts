import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBuilding,
  createUnit,
  createUnitProducts,
  deleteBuildingIfExists,
  deleteUnitProducts,
  layoutOf,
  listFloors,
  listSpaces,
  stampOf,
  type UnitProductFixture,
} from './helpers'

/**
 * TC-PM-001: buildings CRUD and the floor layout
 * Creating a building with 1 floor below and 3 above lays out floors -1…2, each with one default
 * space covering it; lowering the counts past a floor that holds units is refused with 422 naming
 * the floor and the minimum counts; a never-used building can be deleted.
 */
test.describe('TC-PM-001: buildings and floor layout', () => {
  test('lays out floors from counts and guards floors that hold units', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Cedar ${stamp}`, below: 1, above: 3, size: { x: 24, y: 12 } })

      const floors = await listFloors(request, token, buildingId)
      expect(floors.map((floor) => floor.number)).toEqual([-1, 0, 1, 2])
      for (const floor of floors) {
        const spaces = await listSpaces(request, token, floor.id)
        expect(spaces, `floor ${floor.number} has its default space`).toHaveLength(1)
        expect(spaces[0]).toMatchObject({ isDefault: true, x: 0, y: 0, width: 24, depth: 12 })
      }

      const topFloor = floors[floors.length - 1]
      const [topSpace] = await listSpaces(request, token, topFloor.id)
      const unitResponse = await createUnit(request, token, {
        floorId: topFloor.id,
        spaceId: topSpace.id,
        name: 'Office 201',
        catalogCategoryId: products.categoryId,
        catalogProductId: products.productId,
        x: 0,
        y: 0,
        width: 6,
        depth: 4,
      })
      expect(unitResponse.status(), 'unit on the top floor is created').toBe(201)

      const lowered = await apiRequest(request, 'POST', `/api/property_management/buildings/${buildingId}/floors/layout`, {
        token,
        data: layoutOf(1, 2, { x: 24, y: 12 }),
      })
      const loweredBody = await readJsonSafe<{ code?: string; minimumAbove?: number; blockingFloor?: { number?: number } }>(lowered)
      expect(lowered.status()).toBe(422)
      expect(loweredBody?.code).toBe('floor_has_units')
      expect(loweredBody?.minimumAbove).toBe(3)
      expect(loweredBody?.blockingFloor?.number).toBe(2)

      const raised = await apiRequest(request, 'POST', `/api/property_management/buildings/${buildingId}/floors/layout`, {
        token,
        data: layoutOf(0, 4, { x: 24, y: 12 }),
      })
      expect(raised.status(), 'removing the empty basement and adding a floor on top works').toBe(200)
      const after = await listFloors(request, token, buildingId)
      expect(after.map((floor) => floor.number)).toEqual([0, 1, 2, 3])

      const usage = await apiRequest(request, 'GET', `/api/property_management/buildings/${buildingId}/archive`, { token })
      const usageBody = await readJsonSafe<{ canDelete?: boolean; floorCount?: number; unitCount?: number }>(usage)
      expect(usageBody).toMatchObject({ canDelete: true, floorCount: 4, unitCount: 1 })

      const deleted = await apiRequest(request, 'DELETE', `/api/property_management/buildings?id=${buildingId}`, { token })
      expect(deleted.status(), 'a never-used building is deleted').toBe(200)
      const gone = await apiRequest(request, 'GET', `/api/property_management/buildings?id=${buildingId}`, { token })
      const goneBody = await readJsonSafe<{ items?: unknown[] }>(gone)
      expect(goneBody?.items ?? []).toHaveLength(0)
      buildingId = null
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })

  test('archives a building and hides it from the default list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    try {
      const name = `QA PM Archive ${stamp}`
      buildingId = await createBuilding(request, token, { name })
      const archived = await apiRequest(request, 'POST', `/api/property_management/buildings/${buildingId}/archive`, { token })
      expect(archived.status()).toBe(200)
      const active = await readJsonSafe<{ items?: Array<{ id: string }>; archivedCount?: number }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings?search=${encodeURIComponent(name)}`, { token }),
      )
      expect((active?.items ?? []).map((item) => item.id)).not.toContain(buildingId)
      const listed = await readJsonSafe<{ items?: Array<{ id: string; status: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings?status=archived&search=${encodeURIComponent(name)}`, { token }),
      )
      expect(listed?.items?.find((item) => item.id === buildingId)?.status).toBe('archived')
      const again = await apiRequest(request, 'POST', `/api/property_management/buildings/${buildingId}/archive`, { token })
      expect(again.status(), 'archiving is final').toBe(409)
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
    }
  })
})
