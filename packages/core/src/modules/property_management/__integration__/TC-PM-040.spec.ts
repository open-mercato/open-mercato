import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, deleteBuildingIfExists, layoutOf, stampOf } from './helpers'
import { MANAGER_PASSWORD } from './staffFixtures'

type CandidatesBody = { items?: Array<{ userId: string; name: string | null; email: string | null }> }
type ErrorBody = { error?: string; fieldErrors?: Record<string, string> }

/**
 * TC-PM-040: building managers stay inside the building's organization
 * Two organizations of one tenant each have a staff user. Manager candidates offered to an
 * administrator of organization A (searched by a fragment of the decrypted name) list only A's user,
 * and assigning B's user as a manager of a building in A is refused with 422 on `managerUserIds`,
 * both on create and on update. A's own user can still be assigned.
 */
test.describe('TC-PM-040: manager candidates are organization scoped', () => {
  test('lists and assigns only users of the building organization', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = stampOf()
    let otherOrgId: string | null = null
    let roleId: string | null = null
    let userA: string | null = null
    let userB: string | null = null
    let buildingId: string | null = null
    let refusedBuildingId: string | null = null
    try {
      otherOrgId = await createOrganizationFixture(request, adminToken, { name: `QA PM Other Org ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, adminToken, { name: `qa-pm-candidates-${stamp}`, tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['property_management.view', 'property_management.manage'] })
      userA = await createUserFixture(request, adminToken, {
        email: `qa-pm-candidate-a-${stamp}@example.com`,
        password: MANAGER_PASSWORD,
        organizationId,
        roles: [roleId],
        name: `QA PM Candidate A ${stamp}`,
      })
      userB = await createUserFixture(request, adminToken, {
        email: `qa-pm-candidate-b-${stamp}@example.com`,
        password: MANAGER_PASSWORD,
        organizationId: otherOrgId,
        roles: [roleId],
        name: `QA PM Candidate B ${stamp}`,
      })

      const candidatesResponse = await apiRequest(
        request,
        'GET',
        `/api/property_management/manager-candidates?search=${encodeURIComponent(`Candidate A ${stamp}`)}`,
        { token: adminToken },
      )
      expect(candidatesResponse.status()).toBe(200)
      const candidates = await readJsonSafe<CandidatesBody>(candidatesResponse)
      const candidateA = (candidates?.items ?? []).find((item) => item.userId === userA)
      expect(candidateA, 'the user of organization A is offered').toBeTruthy()
      expect(candidateA?.name).toBe(`QA PM Candidate A ${stamp}`)

      const stampCandidates = await readJsonSafe<CandidatesBody>(
        await apiRequest(request, 'GET', `/api/property_management/manager-candidates?search=${encodeURIComponent(stamp)}`, { token: adminToken }),
      )
      const stampIds = (stampCandidates?.items ?? []).map((item) => item.userId)
      expect(stampIds).toContain(userA)
      expect(stampIds, 'the user of organization B is never offered').not.toContain(userB)

      const refusedCreate = await apiRequest(request, 'POST', '/api/property_management/buildings', {
        token: adminToken,
        data: {
          name: `QA PM Cross Org ${stamp}`,
          address: `QA PM Cross Org ${stamp} street 1`,
          managerUserIds: [userB],
          layout: layoutOf(0, 1),
        },
      })
      if (refusedCreate.status() === 201) {
        refusedBuildingId = (await readJsonSafe<{ id?: string }>(refusedCreate))?.id ?? null
      }
      expect(refusedCreate.status(), 'a user of another organization cannot be assigned on create').toBe(422)
      expect((await readJsonSafe<ErrorBody>(refusedCreate))?.fieldErrors?.managerUserIds).toBeTruthy()

      buildingId = await createBuilding(request, adminToken, { name: `QA PM Org Managers ${stamp}`, managerUserIds: [userA] })
      const refusedUpdate = await apiRequest(request, 'PUT', '/api/property_management/buildings', {
        token: adminToken,
        data: { id: buildingId, managerUserIds: [userA, userB] },
      })
      expect(refusedUpdate.status(), 'a user of another organization cannot be assigned on update').toBe(422)
      expect((await readJsonSafe<ErrorBody>(refusedUpdate))?.fieldErrors?.managerUserIds).toBeTruthy()

      const detail = await readJsonSafe<{ items?: Array<{ managers: Array<{ userId: string }> }> }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings?id=${buildingId}`, { token: adminToken }),
      )
      expect(detail?.items?.[0]?.managers.map((entry) => entry.userId)).toEqual([userA])
    } finally {
      await deleteBuildingIfExists(request, adminToken, refusedBuildingId)
      await deleteBuildingIfExists(request, adminToken, buildingId)
      await deleteUserIfExists(request, adminToken, userA)
      await deleteUserIfExists(request, adminToken, userB)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    }
  })
})
