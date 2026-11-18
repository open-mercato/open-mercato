import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, deleteBuildingIfExists, listFloors, listSpaces, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'

type ScopedRow = { id: string; buildingId?: string | null; tenantId?: string | null; organizationId?: string | null }

type Condition = { field: string; op: string; value: string }

function advancedFilterQuery(conditions: Condition[], logic: 'and' | 'or' = 'and', extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ pageSize: '100', 'filter[logic]': logic, ...extra })
  conditions.forEach((condition, index) => {
    params.set(`filter[conditions][${index}][field]`, condition.field)
    params.set(`filter[conditions][${index}][op]`, condition.op)
    params.set(`filter[conditions][${index}][value]`, condition.value)
    if (index > 0) params.set(`filter[conditions][${index}][join]`, logic)
  })
  return params.toString()
}

async function listRows(request: APIRequestContext, token: string, resource: string, query: string): Promise<ScopedRow[]> {
  const response = await apiRequest(request, 'GET', `/api/property_management/${resource}?${query}`, { token })
  const body = await readJsonSafe<{ items?: ScopedRow[] }>(response)
  expect(response.status(), `GET ${resource}?${query} → ${JSON.stringify(body)}`).toBe(200)
  return body?.items ?? []
}

/**
 * TC-PM-041: a client advanced filter cannot widen a list's scope
 * Manager A is assigned to building A only. Sending `filter[...]` conditions on `building_id`, `id`,
 * `tenant_id` and `organization_id` (AND and OR logic) to the buildings, floors and spaces lists never
 * returns a row of building B, of another tenant or of another organization; a full export with the
 * same filter stays scoped too. An administrator (manage_all) can still filter by `building_id`.
 */
test.describe('TC-PM-041: advanced filters cannot override list scope', () => {
  test('keeps tenant, organization and building scope under hostile filters', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let buildingA: string | null = null
    let buildingB: string | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 1)
      const [managerA] = managers.users
      buildingA = await createBuilding(request, adminToken, { name: `QA PM Scope A ${stamp}`, managerUserIds: [managerA.id] })
      buildingB = await createBuilding(request, adminToken, { name: `QA PM Scope B ${stamp}` })
      const [floorA] = await listFloors(request, adminToken, buildingA)
      const [floorB] = await listFloors(request, adminToken, buildingB)
      const [spaceB] = await listSpaces(request, adminToken, floorB.id)
      expect(floorA?.id).toBeTruthy()
      expect(spaceB?.id).toBeTruthy()

      const baseline = await listRows(request, managerA.token, 'buildings', 'pageSize=100')
      expect(baseline.map((row) => row.id)).toContain(buildingA)
      expect(baseline.map((row) => row.id)).not.toContain(buildingB)

      const buildingAttacks: Array<[string, string]> = [
        ['id is B', advancedFilterQuery([{ field: 'id', op: 'is', value: buildingB }])],
        ['id is_not A', advancedFilterQuery([{ field: 'id', op: 'is_not', value: buildingA }])],
        ['tenant_id is own', advancedFilterQuery([{ field: 'tenant_id', op: 'is', value: tenantId }])],
        [
          'OR id is B / tenant_id is own',
          advancedFilterQuery([
            { field: 'id', op: 'is', value: buildingB },
            { field: 'tenant_id', op: 'is', value: tenantId },
          ], 'or'),
        ],
        ['?ids=B with id is_not A', advancedFilterQuery([{ field: 'id', op: 'is_not', value: buildingA }], 'and', { ids: buildingB })],
      ]
      for (const [name, query] of buildingAttacks) {
        const ids = (await listRows(request, managerA.token, 'buildings', query)).map((row) => row.id)
        expect(ids, `buildings: ${name}`).not.toContain(buildingB)
      }

      const placementAttacks: Array<[string, string]> = [
        ['building_id is_not A', advancedFilterQuery([{ field: 'building_id', op: 'is_not', value: buildingA }])],
        ['building_id is B', advancedFilterQuery([{ field: 'building_id', op: 'is', value: buildingB }])],
        ['tenant_id is_not own', advancedFilterQuery([{ field: 'tenant_id', op: 'is_not', value: tenantId }])],
        ['organization_id is_not own', advancedFilterQuery([{ field: 'organization_id', op: 'is_not', value: organizationId }])],
        [
          'OR building_id is B / tenant_id is_not own',
          advancedFilterQuery([
            { field: 'building_id', op: 'is', value: buildingB },
            { field: 'tenant_id', op: 'is_not', value: tenantId },
          ], 'or'),
        ],
      ]
      for (const resource of ['floors', 'spaces']) {
        for (const [name, query] of placementAttacks) {
          const rows = await listRows(request, managerA.token, resource, query)
          for (const row of rows) {
            expect(row.buildingId, `${resource}: ${name}`).toBe(buildingA)
            expect(row.tenantId, `${resource}: ${name}`).toBe(tenantId)
            expect(row.organizationId, `${resource}: ${name}`).toBe(organizationId)
          }
          const ids = rows.map((row) => row.id)
          expect(ids, `${resource}: ${name}`).not.toContain(resource === 'floors' ? floorB.id : spaceB.id)
        }
      }

      const exportQuery = advancedFilterQuery([{ field: 'building_id', op: 'is', value: buildingB }], 'and', { format: 'json', exportScope: 'full' })
      const exported = await apiRequest(request, 'GET', `/api/property_management/floors?${exportQuery}`, { token: managerA.token })
      expect(exported.status()).toBe(200)
      const exportedText = await exported.text()
      expect(exportedText).toContain(floorA.id)
      expect(exportedText, 'a full export ignores the hostile filter and stays scoped').not.toContain(floorB.id)

      const adminFloors = await listRows(request, adminToken, 'floors', advancedFilterQuery([{ field: 'building_id', op: 'is', value: buildingB }]))
      expect(adminFloors.map((row) => row.id)).toContain(floorB.id)
      expect(adminFloors.every((row) => row.buildingId === buildingB), 'a legitimate filter still narrows the list').toBe(true)
    } finally {
      await deleteBuildingIfExists(request, adminToken, buildingA)
      await deleteBuildingIfExists(request, adminToken, buildingB)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
