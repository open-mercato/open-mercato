import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { RESOURCES_RESOURCE_FIELDSET_LAPTOP } from '../lib/resourceCustomFields'

const RESOURCES_PATH = '/api/resources/resources'
const RESOURCE_TYPES_PATH = '/api/resources/resource-types'

const LAPTOP_FIELD = '[data-crud-field-id="cf_laptop_serial"]'
const GENERAL_FIELD = '[data-crud-field-id="cf_asset_tag"]'

test.describe('TC-RESO-010: Resource edit loads the persisted custom fieldset', () => {
  test('a persisted non-General fieldset is active on edit via both SSR and CSR navigation', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let resourceTypeId: string | null = null
    let resourceId: string | null = null
    const resourceTypeName = `QA Laptop Type ${stamp}`
    const resourceName = `QA Laptop Resource ${stamp}`

    try {
      const typeResponse = await apiRequest(request, 'POST', RESOURCE_TYPES_PATH, {
        token,
        data: { name: resourceTypeName },
      })
      expect(typeResponse.status(), 'resource-type fixture create should return 201').toBe(201)
      resourceTypeId = expectId((await readJsonSafe<{ id?: string }>(typeResponse))?.id, 'resource-type fixture id')

      const resourceResponse = await apiRequest(request, 'POST', RESOURCES_PATH, {
        token,
        data: {
          name: resourceName,
          resourceTypeId,
          customFieldsetCode: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
          isActive: true,
        },
      })
      expect(resourceResponse.status(), 'resource fixture create should return 201').toBe(201)
      resourceId = expectId((await readJsonSafe<{ id?: string }>(resourceResponse))?.id, 'resource fixture id')

      // The CRUD API must persist and return the chosen fieldset.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `${RESOURCES_PATH}?ids=${encodeURIComponent(resourceId)}&pageSize=1`,
        { token },
      )
      expect(detailResponse.status(), 'resource detail fetch should return 200').toBe(200)
      const detailBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(detailResponse)
      expect(detailBody?.items?.[0]?.custom_fieldset_code, 'persisted fieldset code').toBe(
        RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      )

      await login(page, 'admin')

      // SSR: open the edit page directly. The Laptops fieldset (and its fields)
      // must be the active selection on first load — not General (#2646).
      await page.goto(`/backend/resources/resources/${encodeURIComponent(resourceId)}`)
      await expect(page.getByRole('heading', { name: resourceName }).first()).toBeVisible()
      const ssrLaptopField = page.locator(LAPTOP_FIELD).first()
      await ssrLaptopField.scrollIntoViewIfNeeded()
      await expect(ssrLaptopField).toBeVisible()
      await expect(page.locator(GENERAL_FIELD)).toHaveCount(0)

      // CSR: reach the same edit page by clicking the row from the list. This is
      // the navigation path the original bug report reproduced under.
      await page.goto('/backend/resources/resources')
      await page.getByText(resourceName).first().click()
      await expect(page.getByRole('heading', { name: resourceName }).first()).toBeVisible()
      const csrLaptopField = page.locator(LAPTOP_FIELD).first()
      await csrLaptopField.scrollIntoViewIfNeeded()
      await expect(csrLaptopField).toBeVisible()
      await expect(page.locator(GENERAL_FIELD)).toHaveCount(0)
    } finally {
      await deleteGeneralEntityIfExists(request, token, RESOURCES_PATH, resourceId)
      await deleteGeneralEntityIfExists(request, token, RESOURCE_TYPES_PATH, resourceTypeId)
    }
  })
})
