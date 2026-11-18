import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'
import { deleteBuildingIfExists, stampOf } from './helpers'
import { watchHydration } from './hydrationWatch'

export const integrationMeta = {
  dependsOnModules: ['property_management'],
}

/**
 * TC-PM-055: New building page (hydration smoke)
 * The create page renders without page errors or hydration mismatches with one ground floor row;
 * filling the name, address and the ground floor creates the building and opens its edit page.
 */
test.describe('TC-PM-055: new building page', () => {
  test('renders cleanly and creates a building', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const name = `TC-PM-055 Building ${stamp}`
    let buildingId: string | null = null
    try {
      const watch = watchHydration(page)
      await login(page, 'admin')
      await page.goto('/backend/property_management/buildings/create')
      await expect(page.getByRole('heading', { name: 'New building' }).first()).toBeVisible()
      await expect(page.getByTestId('pm-floor-row')).toHaveCount(1)

      await fillControlledInput(page.locator('[data-crud-field-id="name"] input').first(), name)
      await fillControlledInput(page.locator('[data-crud-field-id="address"] input').first(), '1 Test Street, Northbridge')
      await fillControlledInput(page.getByLabel('Name of floor 0'), 'Ground')
      await fillControlledInput(page.getByLabel('Floor 0 width (x), metres'), '20')
      await fillControlledInput(page.getByLabel('Floor 0 depth (y), metres'), '10')

      const created = await waitForApiMutation(page, '/api/property_management/buildings', async () => {
        await page.getByRole('button', { name: 'Create building' }).first().click()
      })
      const raw = await created.text()
      expect(created.status(), `POST building → ${raw}`).toBe(201)
      const body = JSON.parse(raw) as { id?: unknown }
      buildingId = typeof body.id === 'string' ? body.id : null
      expect(buildingId, 'building id').toBeTruthy()
      await page.waitForURL(new RegExp(`/backend/property_management/buildings/${buildingId}$`))
      watch.assertClean()
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
    }
  })
})
