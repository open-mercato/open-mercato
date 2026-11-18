import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, deleteBuildingIfExists, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import { isoDayFromToday } from './leaseFixtures'
import { confirmClosure, endClosure, endClosures, listClosures, postClosure, previewClosure, type ClosureInput } from './unavailabilityFixtures'

type ClosureListBody = { items?: Array<{ id: string }>; total?: number; truncated?: boolean }

/**
 * TC-PM-042: building access and RBAC for unavailabilities
 * Manager A (assigned to building A, holding property_management.availability.manage) lists, previews,
 * confirms and ends closures of building A only. A closure of building B is filtered from A's list
 * (with and without `buildingIds`), and its dry run, confirm and end answer 404. The list reports
 * `total` and `truncated`. A viewer of building A without property_management.availability.manage can
 * list A's closures but gets 403 on dry run, confirm and end.
 */
test.describe('TC-PM-042: unavailability building access', () => {
  test('scopes closures to the managers of their building', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let viewers: ManagerFixture | null = null
    let buildingA: string | null = null
    let buildingB: string | null = null
    const closureIds: string[] = []
    try {
      managers = await createManagers(request, adminToken, `${stamp}-m`, 1, ['property_management.availability.manage'])
      viewers = await createManagers(request, adminToken, `${stamp}-v`, 1)
      const [managerA] = managers.users
      const [viewer] = viewers.users
      buildingA = await createBuilding(request, adminToken, { name: `QA PM Closures A ${stamp}`, managerUserIds: [managerA.id, viewer.id] })
      buildingB = await createBuilding(request, adminToken, { name: `QA PM Closures B ${stamp}` })
      const window = { startsAt: `${isoDayFromToday(5)}T08:00`, endsAt: `${isoDayFromToday(6)}T08:00` }
      const closureOfA: ClosureInput = { subjectType: 'building', subjectId: buildingA, ...window }
      const closureOfB: ClosureInput = { subjectType: 'building', subjectId: buildingB, ...window }

      const { id: closureB } = await confirmClosure(request, adminToken, closureOfB, closureIds)
      expect((await listClosures(request, adminToken, buildingB)).map((row) => row.id)).toContain(closureB)

      const listResponse = await apiRequest(request, 'GET', '/api/property_management/unavailabilities', { token: managerA.token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<ClosureListBody>(listResponse)
      expect((listBody?.items ?? []).map((row) => row.id), 'a closure of building B is filtered from the list').not.toContain(closureB)
      expect(listBody?.truncated).toBe(false)
      expect(listBody?.total).toBe(listBody?.items?.length)
      expect(await listClosures(request, managerA.token, buildingB), 'buildingIds=B returns nothing to manager A').toHaveLength(0)

      const adminPreviewOfB = await previewClosure(request, adminToken, closureOfB)
      expect((await postClosure(request, managerA.token, closureOfB, true)).status(), 'dry run outside the assigned buildings').toBe(404)
      expect(
        (await postClosure(request, managerA.token, { ...closureOfB, previewToken: adminPreviewOfB.previewToken }, false)).status(),
        'confirm outside the assigned buildings',
      ).toBe(404)
      expect((await endClosure(request, managerA.token, closureB)).status(), 'end outside the assigned buildings').toBe(404)

      const { id: closureA } = await confirmClosure(request, managerA.token, closureOfA, closureIds)
      expect((await listClosures(request, managerA.token, buildingA)).map((row) => row.id)).toContain(closureA)

      expect((await listClosures(request, viewer.token, buildingA)).map((row) => row.id), 'a viewer lists closures of building A').toContain(closureA)
      expect((await postClosure(request, viewer.token, closureOfA, true)).status(), 'dry run needs property_management.availability.manage').toBe(403)
      const managerPreviewOfA = await previewClosure(request, managerA.token, closureOfA)
      expect(
        (await postClosure(request, viewer.token, { ...closureOfA, previewToken: managerPreviewOfA.previewToken }, false)).status(),
        'confirm needs property_management.availability.manage',
      ).toBe(403)
      expect((await endClosure(request, viewer.token, closureA)).status(), 'end needs property_management.availability.manage').toBe(403)

      expect((await endClosure(request, managerA.token, closureA)).status(), 'manager A ends a closure of building A').toBe(200)
    } finally {
      await endClosures(request, adminToken, closureIds)
      await deleteBuildingIfExists(request, adminToken, buildingA)
      await deleteBuildingIfExists(request, adminToken, buildingB)
      await deleteManagers(request, adminToken, managers)
      await deleteManagers(request, adminToken, viewers)
    }
  })
})
