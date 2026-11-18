import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createBuilding, deleteBuildingIfExists, listFloors, stampOf } from './helpers'
import { watchHydration } from './hydrationWatch'

/**
 * TC-PM-054: floor page (hydration smoke)
 * A floor's setup page renders its header, details form, drawing and tables without page errors or
 * hydration mismatches; an administrator sees the add actions and they link to the create pages for
 * that floor.
 */
test.describe('TC-PM-054: floor page hydration', () => {
  test('renders the floor setup page', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let buildingId: string | null = null
    try {
      buildingId = await createBuilding(request, token, { name: `QA PM Floor page ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)

      const watch = watchHydration(page)
      await login(page, 'admin')
      await page.goto(`/backend/property_management/buildings/${buildingId}/floors/${floor.id}`)
      await expect(page.getByRole('heading', { name: floor.name }).first()).toBeVisible()
      await expect(page.getByTestId('floor-drawing')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Add unit' })).toHaveAttribute(
        'href',
        `/backend/property_management/units/create?floorId=${floor.id}`,
      )
      await expect(page.getByRole('button', { name: 'Save floor' }).first()).toBeVisible()
      watch.assertClean()
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
    }
  })
})
