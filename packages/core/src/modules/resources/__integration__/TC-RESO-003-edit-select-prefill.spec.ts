import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY } from '../lib/capacityUnits'

const RESOURCES_PATH = '/api/resources/resources'
const RESOURCE_TYPES_PATH = '/api/resources/resource-types'

async function resolveCapacityDictionaryId(request: Parameters<typeof apiRequest>[0], token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/dictionaries?includeInherited=true&includeInactive=true', { token })
  expect(response.status(), 'dictionary list should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: string; key?: string; isInherited?: boolean }> }>(response)
  const matches = (body?.items ?? []).filter((item) => item.key === RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY)
  const preferred = matches.find((item) => item.isInherited === false) ?? matches[0] ?? null
  return expectId(preferred?.id, 'resources capacity unit dictionary id')
}

test.describe('TC-RESO-003: Edit forms prefill saved relation and dictionary selects', () => {
  test('resource edit shows the saved resource type and capacity unit immediately on open', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let resourceTypeId: string | null = null
    let resourceId: string | null = null
    let capacityEntryId: string | null = null
    const resourceTypeName = `QA Prefill Resource Type ${stamp}`
    const capacityUnitValue = `qa_prefill_unit_${stamp}`
    const capacityUnitLabel = `QA Prefill Unit ${stamp}`
    const resourceName = `QA Prefill Resource ${stamp}`

    try {
      const dictionaryId = await resolveCapacityDictionaryId(request, token)
      const entryResponse = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        { token, data: { value: capacityUnitValue, label: capacityUnitLabel } },
      )
      expect(entryResponse.status(), 'capacity-unit entry create should return 201').toBe(201)
      capacityEntryId = expectId((await readJsonSafe<{ id?: string }>(entryResponse))?.id, 'capacity-unit entry id')

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
          capacity: 3,
          capacityUnitValue,
          isActive: true,
        },
      })
      expect(resourceResponse.status(), 'resource fixture create should return 201').toBe(201)
      resourceId = expectId((await readJsonSafe<{ id?: string }>(resourceResponse))?.id, 'resource fixture id')

      await login(page, 'admin')
      await page.goto(`/backend/resources/resources/${encodeURIComponent(resourceId)}`)

      await expect(page.getByRole('heading', { name: resourceName }).first()).toBeVisible()
      const resourceTypeField = page.locator('[data-crud-field-id="resourceTypeId"]').first()
      await resourceTypeField.scrollIntoViewIfNeeded()
      await expect(resourceTypeField.getByRole('combobox').first()).toContainText(resourceTypeName)
      const capacityUnitField = page.locator('[data-crud-field-id="capacityUnitValue"]').first()
      await capacityUnitField.scrollIntoViewIfNeeded()
      const capacityUnitSelect = capacityUnitField.getByRole('combobox').first()
      await expect(capacityUnitSelect).toBeVisible()
      await expect(capacityUnitSelect).toContainText(capacityUnitLabel)
    } finally {
      await deleteGeneralEntityIfExists(request, token, RESOURCES_PATH, resourceId)
      await deleteGeneralEntityIfExists(request, token, RESOURCE_TYPES_PATH, resourceTypeId)
      if (capacityEntryId) {
        const dictionaryId = await resolveCapacityDictionaryId(request, token).catch(() => null)
        if (dictionaryId) {
          await apiRequest(
            request,
            'DELETE',
            `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(capacityEntryId)}`,
            { token },
          ).catch(() => {})
        }
      }
    }
  })
})
