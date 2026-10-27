import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'

export const integrationMeta = {
  dependsOnModules: ['property_management'],
}

type FloorsResponse = { items?: Array<{ number?: number }> }

async function deleteBuildingIfExists(request: APIRequestContext, token: string, id: string | null): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `/api/property_management/buildings?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

test.describe('TC-PM-010: building edit page re-lays floors and deletes with name confirmation', () => {
  test('raises the above-ground count, saves four floors, then deletes the building from the dialog', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const buildingName = `TC-PM-010 Building ${stamp}`
    let buildingId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/property_management/buildings', {
        token,
        data: {
          name: buildingName,
          address: '1 Test Street, Northbridge',
          layout: {
            below: 1,
            above: 2,
            floors: [
              { number: -1, name: 'Parking', sizeX: 30, sizeY: 20 },
              { number: 0, name: 'Ground', sizeX: 30, sizeY: 20 },
              { number: 1, name: 'First', sizeX: 30, sizeY: 20 },
            ],
          },
        },
      })
      expect(createResponse.status(), 'POST /api/property_management/buildings should return 201').toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      buildingId = typeof created?.id === 'string' ? created.id : null
      expect(buildingId, 'building id').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/property_management/buildings/${buildingId}`)
      const rows = page.getByTestId('pm-floor-row')
      await expect(rows).toHaveCount(3)

      await fillControlledInput(page.locator('#pm-floors-above'), '3')
      await expect(rows).toHaveCount(4)
      await fillControlledInput(page.getByLabel('Name of floor 2'), 'Second')
      await fillControlledInput(page.getByLabel('Floor 2 width (x), metres'), '30')
      await fillControlledInput(page.getByLabel('Floor 2 depth (y), metres'), '20')

      const saveResponse = await waitForApiMutation(
        page,
        '/api/property_management/buildings',
        async () => {
          await page.getByRole('button', { name: 'Save changes' }).first().click()
        },
        'PUT',
      )
      expect(saveResponse.ok(), `PUT building should succeed, got ${saveResponse.status()}`).toBeTruthy()

      const floorsResponse = await apiRequest(request, 'GET', `/api/property_management/floors?buildingId=${buildingId}&pageSize=100`, { token })
      const floors = await readJsonSafe<FloorsResponse>(floorsResponse)
      expect((floors?.items ?? []).map((floor) => floor.number).sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual([-1, 0, 1, 2])
      await expect(rows).toHaveCount(4)

      await page.getByRole('button', { name: 'Delete building' }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const confirmButton = dialog.getByRole('button', { name: 'Delete building' })
      await expect(confirmButton).toBeDisabled()
      await fillControlledInput(dialog.getByLabel('Type the building name to confirm'), buildingName)
      const deleteResponse = await waitForApiMutation(page, '/api/property_management/buildings', async () => {
        await confirmButton.click()
      }, 'DELETE')
      expect(deleteResponse.ok(), `DELETE building should succeed, got ${deleteResponse.status()}`).toBeTruthy()
      await page.waitForURL(/\/backend\/property_management\/buildings$/)
      buildingId = null
    } finally {
      await deleteBuildingIfExists(request, token, buildingId)
    }
  })
})
