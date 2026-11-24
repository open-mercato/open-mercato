import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory'] }

const PEOPLE_PATH = '/api/customers/people'

test.describe('TC-CRM-7598: customers write commands and deleted rows stay in scope', () => {
  test('an out-of-scope person id is not found for update and delete (#7598)', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8)
    const password = `QA-${randomUUID()}!aA1`
    let foreignOrganizationId: string | null = null
    let foreignPersonId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let superadminToken: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const { tenantId, organizationId: homeOrganizationId } = getTokenContext(superadminToken)
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, { name: `QA TC-CRM-7598 ${stamp}`, tenantId })
      const created = await apiRequestWithSelectedOrg(request, 'POST', PEOPLE_PATH, {
        token: superadminToken,
        selectedOrgId: foreignOrganizationId,
        data: { firstName: 'Foreign', lastName: stamp, displayName: `QA7598 foreign ${stamp}` },
      })
      expect(created.status(), 'The foreign-organization person fixture should be created').toBe(201)
      const createdBody = await readJsonSafe<{ id?: string; entityId?: string }>(created)
      foreignPersonId = expectId(createdBody?.id ?? createdBody?.entityId, 'POST /api/customers/people should return an id')

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-crm-7598-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['customers.people.view', 'customers.people.manage'],
        organizations: [homeOrganizationId],
      })
      const email = `qa-crm-7598-${stamp}@example.com`
      userId = await createUserFixture(request, superadminToken, {
        email, password, organizationId: homeOrganizationId, roles: [roleId], name: `QA7598 ${stamp}`,
      })
      const userToken = await withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, email, password))

      const update = await apiRequest(request, 'PUT', PEOPLE_PATH, {
        token: userToken,
        data: { id: foreignPersonId, displayName: `QA7598 hijacked ${stamp}` },
      })
      expect(update.status(), 'Updating an out-of-scope person should answer 404, not 403').toBe(404)

      const removal = await apiRequest(request, 'DELETE', `${PEOPLE_PATH}?id=${encodeURIComponent(foreignPersonId)}`, { token: userToken })
      expect(removal.status(), 'Deleting an out-of-scope person should answer 404, not 403').toBe(404)

      const check = await apiRequestWithSelectedOrg(request, 'GET', `${PEOPLE_PATH}?ids=${foreignPersonId}`, {
        token: superadminToken,
        selectedOrgId: foreignOrganizationId,
      })
      const body = await readJsonSafe<{ items?: Array<{ id?: string; displayName?: string; display_name?: string }> }>(check)
      const stored = (body?.items ?? []).find((item) => item.id === foreignPersonId)
      expect(stored, 'The foreign person must survive the rejected delete').toBeTruthy()
      expect(stored?.displayName ?? stored?.display_name).toBe(`QA7598 foreign ${stamp}`)
    } finally {
      if (superadminToken && foreignPersonId && foreignOrganizationId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `${PEOPLE_PATH}?id=${encodeURIComponent(foreignPersonId)}`, {
          token: superadminToken,
          selectedOrgId: foreignOrganizationId,
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
    }
  })

  test('a raw withDeleted query does not reveal deleted people (#9154)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().slice(0, 8)
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Deleted', lastName: stamp, displayName: `QA9154 deleted ${stamp}`,
      })
      const removal = await apiRequest(request, 'DELETE', `${PEOPLE_PATH}?id=${encodeURIComponent(personId)}`, { token })
      expect(removal.ok(), 'The person fixture should be deleted').toBe(true)

      const response = await apiRequest(request, 'GET', `${PEOPLE_PATH}?ids=${personId}&withDeleted=true`, { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
      expect((body?.items ?? []).map((item) => item.id)).not.toContain(personId)
    } finally {
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
    }
  })
})
