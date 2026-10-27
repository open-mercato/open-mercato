import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBuilding,
  createSpace,
  createUnit,
  createUnitProducts,
  deleteBuildingIfExists,
  deleteUnitProducts,
  listFloors,
  listSpaces,
  setProductUse,
  stampOf,
  updateSpace,
  type UnitProductFixture,
} from './helpers'

const FLOOR_X = 20

async function dragTargetBy(page: Page, dxMetres: number, dyMetres: number): Promise<void> {
  const floorBox = await page.getByTestId('floor-drawing').boundingBox()
  const targetBox = await page.getByTestId('placement-target').boundingBox()
  expect(floorBox, 'floor drawing is rendered').not.toBeNull()
  expect(targetBox, 'draggable unit is rendered').not.toBeNull()
  if (!floorBox || !targetBox) return
  const pxPerMetre = floorBox.width / FLOOR_X
  const startX = targetBox.x + targetBox.width / 2
  const startY = targetBox.y + targetBox.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dxMetres * pxPerMetre, startY + dyMetres * pxPerMetre, { steps: 12 })
  await page.mouse.up()
}

/**
 * TC-PM-005: unit placement editor (drag and drop)
 * Dragging a unit into another space makes the Space field follow; dropping it onto a common area
 * names the common area in words and disables Save.
 */
test.describe('TC-PM-005: unit placement editor', () => {
  test('space follows the drop and an overlap disables Save', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    let products: UnitProductFixture | null = null
    try {
      products = await createUnitProducts(request, token, stamp)
      const bookable = await setProductUse(request, token, products.productId, 'bookable', 'hour')
      expect(bookable.ok(), 'product becomes bookable').toBeTruthy()
      buildingId = await createBuilding(request, token, { name: `QA PM Placement ${stamp}`, size: { x: FLOOR_X, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [defaultSpace] = await listSpaces(request, token, floor.id)
      const shrunk = await updateSpace(request, token, { id: defaultSpace.id, name: 'West', x: 0, y: 0, width: 10, depth: 10 })
      expect(shrunk.status(), 'the default space can be shrunk').toBe(200)
      await createSpace(request, token, { floorId: floor.id, name: 'East', x: 10, y: 0, width: 10, depth: 10 })
      const kitchen = await apiRequest(request, 'POST', '/api/property_management/common-areas', {
        token,
        data: { floorId: floor.id, name: 'Kitchen', kind: 'kitchen', x: 12, y: 6, width: 4, depth: 4 },
      })
      expect(kitchen.status()).toBe(201)
      const unit = await createUnit(request, token, {
        floorId: floor.id,
        spaceId: defaultSpace.id,
        name: 'Room A',
        catalogCategoryId: products.categoryId,
        catalogProductId: products.productId,
        x: 1,
        y: 1,
        width: 3,
        depth: 3,
      })
      const unitBody = await readJsonSafe<{ id?: string }>(unit)
      expect(unit.status()).toBe(201)
      const unitId = expectId(unitBody?.id, 'unit id')

      await login(page, 'admin')
      await page.goto(`/backend/property_management/units/${unitId}`)
      const target = page.getByTestId('placement-target')
      await expect(target).toBeVisible()
      await expect(target).toHaveAttribute('aria-roledescription', 'draggable')
      const spaceField = page.locator('[data-crud-field-id="spaceId"]')
      await expect(spaceField).toContainText('West')
      const submit = page.getByTestId('placement-submit').first()
      await expect(submit).toBeEnabled()

      await dragTargetBy(page, 10, 0)
      await expect(page.getByTestId('placement-position')).toHaveText('11, 1 m')
      await expect(spaceField).toContainText('East')
      await expect(page.getByTestId('placement-status')).toContainText('East')
      await expect(submit).toBeEnabled()

      await dragTargetBy(page, 1, 5)
      await expect(page.getByTestId('placement-status')).toContainText('Kitchen')
      await expect(submit).toBeDisabled()
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
      await deleteUnitProducts(request, token, products)
    }
  })
})
