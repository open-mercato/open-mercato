import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, createSpace, deleteBuildingIfExists, listFloors, listSpaces, stampOf, updateSpace } from './helpers'
import { watchHydration } from './hydrationWatch'

export const integrationMeta = {
  dependsOnModules: ['property_management'],
}

async function expectPlacementForm(page: Page, path: string, heading: string, submitLabel: string, name: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible()
  await expect(page.locator('[data-crud-field-id="name"] input').first()).toHaveValue(name)
  await expect(page.getByRole('button', { name: submitLabel }).first()).toBeVisible()
}

/**
 * TC-PM-056: space and common-area pages (hydration smoke)
 * The create and edit pages of a space and of a common area render their form without page errors
 * or hydration mismatches, for a building, space and common area created through the API. Nothing
 * is saved from the pages.
 */
test.describe('TC-PM-056: space and common-area pages', () => {
  test('render cleanly for create and edit', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const spaceName = `TC-PM-056 Space ${stamp}`
    const areaName = `TC-PM-056 Kitchen ${stamp}`
    let buildingId: string | null = null
    try {
      buildingId = await createBuilding(request, token, { name: `TC-PM-056 Building ${stamp}`, size: { x: 20, y: 10 } })
      const [floor] = await listFloors(request, token, buildingId)
      const [defaultSpace] = await listSpaces(request, token, floor.id)
      const shrunk = await updateSpace(request, token, { id: defaultSpace.id, x: 0, y: 0, width: 10, depth: 10 })
      expect(shrunk.status(), `shrink the default space → ${JSON.stringify(await readJsonSafe(shrunk))}`).toBe(200)
      const spaceId = await createSpace(request, token, { floorId: floor.id, name: spaceName, x: 10, y: 0, width: 10, depth: 10 })
      const area = await apiRequest(request, 'POST', '/api/property_management/common-areas', {
        token,
        data: { floorId: floor.id, name: areaName, kind: 'kitchen', x: 12, y: 6, width: 4, depth: 4 },
      })
      const areaBody = await readJsonSafe<{ id?: string }>(area)
      expect(area.status(), `POST common-areas → ${JSON.stringify(areaBody)}`).toBe(201)
      const areaId = expectId(areaBody?.id, 'Common area id')
      const floorQuery = `?floorId=${encodeURIComponent(floor.id)}`

      const watch = watchHydration(page)
      await login(page, 'admin')
      await expectPlacementForm(page, `/backend/property_management/spaces/create${floorQuery}`, 'New space', 'Create space', '')
      await expectPlacementForm(page, `/backend/property_management/spaces/${spaceId}`, spaceName, 'Save changes', spaceName)
      await expectPlacementForm(page, `/backend/property_management/common-areas/create${floorQuery}`, 'New common area', 'Create common area', '')
      await expectPlacementForm(page, `/backend/property_management/common-areas/${areaId}`, areaName, 'Save changes', areaName)
      watch.assertClean()
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
    }
  })
})
