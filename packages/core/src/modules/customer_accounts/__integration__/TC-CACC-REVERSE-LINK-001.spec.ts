import { randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = {
  dependsOnModules: ['customer_accounts', 'customers', 'directory', 'auth'],
}

const USERS_PATH = '/api/customer_accounts/admin/users'

type CustomerLinks = {
  personEntityId: string | null
  customerEntityId: string | null
}

async function readCustomerLinks(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<CustomerLinks | null> {
  const response = await apiRequest(request, 'GET', `${USERS_PATH}/${userId}`, { token })
  expect(response.status(), 'customer user should remain readable in its own organization').toBe(200)
  return readJsonSafe<CustomerLinks>(response)
}

test.describe('TC-CACC-REVERSE-LINK-001: reverse CRM linking respects organization ownership', () => {
  test('ignores a matching person in a sibling organization, then links the own-organization person and company', async ({ request }) => {
    const fixtureToken = randomBytes(12).toString('hex')
    const email = `qa-cacc-reverse-${fixtureToken}@test.local`
    const staffEmail = `qa-cacc-reverse-staff-${fixtureToken}@test.local`
    const staffPassword = `${randomBytes(18).toString('base64url')}A1!`
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const tenantId = expectId(getTokenScope(adminToken).tenantId, 'admin token should identify the tenant')
    expect(getTokenScope(superadminToken).tenantId, 'fixture administrators should share a tenant').toBe(tenantId)

    let foreignOrganizationId: string | null = null
    let foreignStaffId: string | null = null
    let foreignStaffToken: string | null = null
    let customerUserId: string | null = null
    let companyId: string | null = null
    let foreignPersonId: string | null = null
    let ownPersonId: string | null = null

    try {
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Reverse CRM ${fixtureToken}`,
        tenantId,
      })
      foreignStaffId = await createUserFixture(request, superadminToken, {
        email: staffEmail,
        password: staffPassword,
        organizationId: foreignOrganizationId,
        roles: [],
      })
      await setUserAclVisibility(request, superadminToken, {
        userId: foreignStaffId,
        organizations: [foreignOrganizationId],
        features: ['customers.people.view', 'customers.people.manage'],
      })
      foreignStaffToken = await getAuthToken(request, staffEmail, staffPassword)
      expect(getTokenScope(foreignStaffToken)).toMatchObject({
        tenantId,
        organizationId: foreignOrganizationId,
      })

      const createResponse = await apiRequest(request, 'POST', USERS_PATH, {
        token: adminToken,
        data: {
          email,
          password: `${randomBytes(18).toString('base64url')}A1!`,
          displayName: `QA Reverse CRM ${fixtureToken}`,
        },
      })
      expect(createResponse.status(), 'unlinked portal user should be created').toBe(201)
      const created = await readJsonSafe<{ user?: { id?: string } }>(createResponse)
      customerUserId = expectId(created?.user?.id, 'portal create response should include user.id')
      await drainIntegrationQueue('events')
      expect(await readCustomerLinks(request, adminToken, customerUserId)).toMatchObject({
        personEntityId: null,
        customerEntityId: null,
      })

      foreignPersonId = await createPersonFixture(request, foreignStaffToken, {
        firstName: 'Foreign',
        lastName: fixtureToken,
        displayName: `QA Foreign Reverse CRM ${fixtureToken}`,
        primaryEmail: email,
      })
      await drainIntegrationQueue('events')
      expect(
        await readCustomerLinks(request, adminToken, customerUserId),
        'a sibling-organization person-created event must leave the portal account unlinked',
      ).toMatchObject({ personEntityId: null, customerEntityId: null })

      companyId = await createCompanyFixture(request, adminToken, `QA Reverse CRM Company ${fixtureToken}`)
      ownPersonId = await createPersonFixture(request, adminToken, {
        firstName: 'Own',
        lastName: fixtureToken,
        displayName: `QA Own Reverse CRM ${fixtureToken}`,
        primaryEmail: email,
        companyEntityId: companyId,
      })
      await expect.poll(async () => {
        await drainIntegrationQueue('events')
        return readCustomerLinks(request, adminToken, customerUserId!)
      }).toMatchObject({ personEntityId: ownPersonId, customerEntityId: companyId })
    } finally {
      if (customerUserId) {
        await apiRequest(request, 'DELETE', `${USERS_PATH}/${customerUserId}`, {
          token: adminToken,
        }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', ownPersonId)
      await deleteEntityIfExists(request, foreignStaffToken, '/api/customers/people', foreignPersonId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      await deleteUserIfExists(request, superadminToken, foreignStaffId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
    }
  })
})
