import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
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
import { watchHydration } from './hydrationWatch'

/**
 * TC-PM-032: floor plan page (hydration smoke)
 * The floor plan opens on the requested building and floor with today's statuses: the drawing, the legend
 * and the unit tile render; clicking the tile opens its detail drawer (name, status, size) and Escape
 * closes it; "Edit floor" links to the floor page.
 */
test.describe('TC-PM-032: floor plan page', () => {
  test('renders the floor and opens a unit panel on click', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      buildingId = await createBuilding(request, token, { name: `QA PM Floor plan ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [space] = await listSpaces(request, token, floor.id)
      const unitName = `Office ${stamp}`
      const response = await createUnit(request, token, {
        floorId: floor.id,
        spaceId: space.id,
        name: unitName,
        catalogCategoryId: products.categoryId,
        catalogProductId: products.productId,
        x: 2,
        y: 2,
        width: 8,
        depth: 6,
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      expect(response.status()).toBe(201)
      const unitId = expectId(body?.id, 'unit id')

      const watch = watchHydration(page)

      await login(page, 'admin')
      await page.goto(`/backend/property_management/floor-plan?buildingId=${buildingId}&floorId=${floor.id}`)
      await expect(page.getByTestId('pm-floor-plan-card')).toBeVisible()
      await expect(page.getByTestId('pm-floor-plan-legend')).toBeVisible()
      await expect(page.getByTestId('floor-drawing')).toBeVisible()
      await expect(page.getByTestId('pm-floor-plan-edit-floor')).toHaveAttribute(
        'href',
        `/backend/property_management/buildings/${buildingId}/floors/${floor.id}`,
      )

      const tile = page.getByTestId(`pm-floor-plan-unit-${unitId}`)
      await expect(tile).toBeVisible()
      await expect(tile).toHaveAttribute('data-status', 'available')
      await tile.click()

      const drawer = page.getByTestId('pm-floor-plan-drawer')
      await expect(drawer).toBeVisible()
      await expect(drawer).toContainText(unitName)
      await expect(drawer).toContainText('Available')
      await expect(drawer).toContainText('8 × 6 m, 48 m²')
      await expect(tile).toHaveAttribute('aria-pressed', 'true')

      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      watch.assertClean()
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
