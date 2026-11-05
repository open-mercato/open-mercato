import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'

const FEATURE_TOGGLE_ENTITY_TYPE = 'feature_toggles:feature_toggle'

type FeatureToggleIndexRow = {
  organization_id: string | null
  tenant_id: string | null
  deleted_at: Date | null
}

async function readFeatureToggleIndexRows(toggleId: string): Promise<FeatureToggleIndexRow[]> {
  return withClient(async (client) => {
    const result = await client.query<FeatureToggleIndexRow>(
      `select organization_id, tenant_id, deleted_at
       from entity_indexes
       where entity_type = $1 and entity_id = $2`,
      [FEATURE_TOGGLE_ENTITY_TYPE, toggleId],
    )
    return result.rows
  })
}

async function expectGlobalFeatureToggleProjection(toggleId: string): Promise<void> {
  const rows = await readFeatureToggleIndexRows(toggleId)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ organization_id: null, tenant_id: null, deleted_at: null })
}

async function deleteFeatureToggleProjectionIfExists(toggleId: string | null): Promise<void> {
  if (!toggleId) return
  await withClient(async (client) => {
    await client.query(
      'delete from entity_indexes where entity_type = $1 and entity_id = $2',
      [FEATURE_TOGGLE_ENTITY_TYPE, toggleId],
    )
  })
}

test.describe('TC-FT-001: Global feature toggle CRUD APIs', () => {
  test('should create, update, list, and delete a global feature toggle', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const identifier = `qa_toggle_${Date.now()}`
    let toggleId: string | null = null
    let indexedToggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, token, {
        identifier,
        name: 'QA Toggle',
        description: 'Integration CRUD coverage',
        category: 'qa',
        type: 'boolean',
        defaultValue: true,
      })
      indexedToggleId = toggleId
      await expectGlobalFeatureToggleProjection(toggleId)

      const listResponse = await apiRequest(request, 'GET', '/api/feature_toggles/global?page=1&pageSize=100', { token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(Array.isArray(listBody?.items)).toBe(true)
      expect(listBody?.items?.some((item) => item.id === toggleId)).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: {
          id: toggleId,
          name: 'QA Toggle Updated',
          defaultValue: false,
          category: 'qa-updated',
        },
      })
      expect(updateResponse.status()).toBe(200)
      await expectGlobalFeatureToggleProjection(toggleId)

      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}`,
        { token },
      )
      expect(verifyResponse.status()).toBe(200)
      const item = await readJsonSafe<Record<string, unknown>>(verifyResponse)
      expect(item?.name).toBe('QA Toggle Updated')
      expect(item?.defaultValue).toBe(false)
      expect(item?.category).toBe('qa-updated')

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/feature_toggles/global?id=${encodeURIComponent(toggleId)}`,
        { token },
      )
      expect(deleteResponse.status()).toBe(200)
      expect(await readFeatureToggleIndexRows(toggleId)).toHaveLength(0)
      const deletedToggleId = toggleId
      toggleId = null

      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(deletedToggleId)}`,
        { token },
      )
      expect(afterDeleteResponse.status()).toBe(404)
    } finally {
      await deleteFeatureToggleIfExists(request, token, toggleId)
      await deleteFeatureToggleProjectionIfExists(indexedToggleId).catch(() => undefined)
    }
  })
})
