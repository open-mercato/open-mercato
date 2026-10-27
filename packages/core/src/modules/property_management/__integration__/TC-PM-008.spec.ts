import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, deleteBuildingIfExists, listFloors, listSpaces, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'

type ListBody = { items?: Array<{ id: string }>; canManageAll?: boolean }

/**
 * TC-PM-008: building access on staff routes
 * In one organization, manager A sees and changes only the buildings assigned to them: B's building
 * is filtered from lists and 404 on detail, layout and mutations; a manager with no assignment sees
 * an empty list; an administrator (manage_all) sees both.
 */
test.describe('TC-PM-008: building access', () => {
  test('scopes buildings, floors and spaces to assigned managers', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let buildingA: string | null = null
    let buildingB: string | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 3)
      const [managerA, managerB, unassigned] = managers.users
      buildingA = await createBuilding(request, adminToken, { name: `QA PM Access A ${stamp}`, managerUserIds: [managerA.id] })
      buildingB = await createBuilding(request, adminToken, { name: `QA PM Access B ${stamp}`, managerUserIds: [managerB.id] })
      const search = encodeURIComponent(`QA PM Access`)

      const listA = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/buildings?search=${search}&pageSize=100`, { token: managerA.token }))
      const idsA = (listA?.items ?? []).map((item) => item.id)
      expect(idsA).toContain(buildingA)
      expect(idsA).not.toContain(buildingB)
      expect(listA?.canManageAll).toBe(false)

      const detailB = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/buildings?id=${buildingB}`, { token: managerA.token }))
      expect(detailB?.items ?? []).toHaveLength(0)

      const floorsB = await listFloors(request, adminToken, buildingB)
      const floorsSeenByA = await readJsonSafe<ListBody>(
        await apiRequest(request, 'GET', `/api/property_management/floors?buildingId=${buildingB}`, { token: managerA.token }),
      )
      expect(floorsSeenByA?.items ?? []).toHaveLength(0)

      const layoutB = await apiRequest(request, 'GET', `/api/property_management/floors/${floorsB[0].id}/layout`, { token: managerA.token })
      expect(layoutB.status()).toBe(404)

      const renameB = await apiRequest(request, 'PUT', '/api/property_management/buildings', {
        token: managerA.token,
        data: { id: buildingB, name: 'Hijacked' },
      })
      expect(renameB.status()).toBe(404)

      const [spaceB] = await listSpaces(request, adminToken, floorsB[0].id)
      const createSpaceB = await apiRequest(request, 'POST', '/api/property_management/spaces', {
        token: managerA.token,
        data: { floorId: floorsB[0].id, name: 'Intruder', x: 0, y: 0, width: 1, depth: 1 },
      })
      expect(createSpaceB.status()).toBe(404)
      const deleteSpaceB = await apiRequest(request, 'DELETE', `/api/property_management/spaces?id=${spaceB.id}`, { token: managerA.token })
      expect(deleteSpaceB.status()).toBe(404)

      const layoutReplaceB = await apiRequest(request, 'POST', `/api/property_management/buildings/${buildingB}/floors/layout`, {
        token: managerA.token,
        data: { below: 0, above: 1, floors: [{ number: 0, name: 'X', sizeX: 1, sizeY: 1 }] },
      })
      expect(layoutReplaceB.status()).toBe(404)

      const renameA = await apiRequest(request, 'PUT', '/api/property_management/buildings', {
        token: managerA.token,
        data: { id: buildingA, name: `QA PM Access A renamed ${stamp}` },
      })
      expect(renameA.status(), 'manager A changes their own building').toBe(200)

      const empty = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/buildings?search=${search}`, { token: unassigned.token }))
      expect(empty?.items ?? []).toHaveLength(0)

      const admin = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/buildings?search=${search}&pageSize=100`, { token: adminToken }))
      const adminIds = (admin?.items ?? []).map((item) => item.id)
      expect(adminIds).toEqual(expect.arrayContaining([buildingA, buildingB]))
      expect(admin?.canManageAll).toBe(true)
    } finally {
      await deleteBuildingIfExists(request, adminToken, buildingA)
      await deleteBuildingIfExists(request, adminToken, buildingB)
      await deleteManagers(request, adminToken, managers)
    }
  })

  test('a manager creating a building is assigned to it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let buildingId: string | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 1)
      const [manager] = managers.users
      buildingId = await createBuilding(request, manager.token, { name: `QA PM Own ${stamp}`, managerUserIds: [] })
      const own = await readJsonSafe<{ items?: Array<{ id: string; managers: Array<{ userId: string }> }> }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings?id=${buildingId}`, { token: manager.token }),
      )
      expect(own?.items?.[0]?.managers.map((entry) => entry.userId)).toEqual([manager.id])
    } finally {
      await deleteBuildingIfExists(request, adminToken, buildingId)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
