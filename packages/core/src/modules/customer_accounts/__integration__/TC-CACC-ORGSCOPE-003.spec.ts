import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  customerTestPassword,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CACC-ORGSCOPE-003 [P1]: admin customer-user detail and actions enforce the staff user's
 * feature grants in the target organization through the real RBAC service (#5577 re-review).
 *
 * The staff actor holds two tenant roles:
 * - "manager" grants `customer_accounts.view` + `customer_accounts.manage` in the home organization;
 * - "viewer" grants only `customer_accounts.view` in a second (target) organization.
 * The target organization is therefore visible to the actor, but writes there must be denied
 * and leave the record unchanged. A write sent with a rejected organization selection must also
 * be denied instead of running in the resolver fallback scope.
 * Covers: GET/PUT/DELETE /api/customer_accounts/admin/users/[id],
 * POST /api/customer_accounts/admin/users/[id]/verify-email,
 * POST /api/customer_accounts/admin/users/[id]/reset-password.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function scopeCookie(tenantId: string, organizationId: string): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId)}`,
  ].join('; ')
}

async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

type CustomerUserDetail = {
  id?: string
  displayName?: string
  isActive?: boolean
  emailVerified?: boolean
  updatedAt?: string | null
}

test.describe('TC-CACC-ORGSCOPE-003: customer user writes require manage in the target organization (#5577)', () => {
  test('denies writes in a visible organization granted view only and on a rejected selection', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrgId, tenantId } = getTokenContext(adminToken)
    expectId(homeOrgId, 'admin token should carry a home organization')
    expectId(tenantId, 'admin token should carry a tenant')

    const suffix = uniqueSuffix()
    const password = customerTestPassword()
    let targetOrgId: string | null = null
    let hiddenOrgId: string | null = null
    let managerRoleId: string | null = null
    let viewerRoleId: string | null = null
    let staffId: string | null = null
    let targetUserId: string | null = null
    let homeUserId: string | null = null

    try {
      targetOrgId = await createOrganizationFixture(request, adminToken, { name: `QA CACC ORGSCOPE3 TARGET ${suffix}` })
      hiddenOrgId = await createOrganizationFixture(request, adminToken, { name: `QA CACC ORGSCOPE3 HIDDEN ${suffix}` })

      managerRoleId = await createRoleFixture(request, superadminToken, { name: `qa-cacc-orgscope3-manager-${suffix}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: managerRoleId,
        features: ['customer_accounts.view', 'customer_accounts.manage'],
        organizations: [homeOrgId],
      })
      viewerRoleId = await createRoleFixture(request, superadminToken, { name: `qa-cacc-orgscope3-viewer-${suffix}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewerRoleId,
        features: ['customer_accounts.view'],
        organizations: [targetOrgId],
      })

      const staffEmail = `qa-cacc-orgscope3-staff-${suffix}@test.local`
      staffId = await createUserFixture(request, superadminToken, {
        email: staffEmail,
        password,
        organizationId: homeOrgId,
        roles: [managerRoleId, viewerRoleId],
      })
      const staffToken = await getAuthToken(request, staffEmail, password)

      const createCustomerUser = async (organizationId: string, label: string) => {
        const created = await scopedRequest(request, 'POST', '/api/customer_accounts/admin/users', {
          token: superadminToken,
          cookie: scopeCookie(tenantId, organizationId),
          data: {
            email: `qa-cacc-orgscope3-${label}-${suffix}@test.local`,
            password: customerTestPassword(),
            displayName: `QA CACC ORGSCOPE3 ${label} ${suffix}`,
          },
        })
        expect(created.status(), `POST /admin/users (${label}) should return 201`).toBe(201)
        const body = await readJsonSafe<{ user?: { id?: string } }>(created)
        return expectId(body?.user?.id, `User creation response (${label}) should include user.id`)
      }
      targetUserId = await createCustomerUser(targetOrgId, 'target')
      homeUserId = await createCustomerUser(homeOrgId, 'home')

      const targetScope = scopeCookie(tenantId, targetOrgId)
      const targetPath = `/api/customer_accounts/admin/users/${targetUserId}`
      const readTarget = async () => {
        const res = await scopedRequest(request, 'GET', targetPath, { token: adminToken, cookie: targetScope })
        expect(res.status()).toBe(200)
        return (await readJsonSafe<CustomerUserDetail>(res)) ?? {}
      }
      const before = await readTarget()

      // View-only grant in the visible target organization: reads are allowed.
      const staffRead = await scopedRequest(request, 'GET', targetPath, { token: staffToken, cookie: targetScope })
      expect(staffRead.status(), 'view grant in the target organization opens the user').toBe(200)

      // ...but every write answers 403.
      const update = await scopedRequest(request, 'PUT', targetPath, {
        token: staffToken,
        cookie: targetScope,
        data: { displayName: `Denied overwrite ${suffix}`, isActive: false },
      })
      expect(update.status(), 'PUT without manage in the target organization').toBe(403)

      const verify = await scopedRequest(request, 'POST', `${targetPath}/verify-email`, { token: staffToken, cookie: targetScope })
      expect(verify.status(), 'verify-email without manage in the target organization').toBe(403)

      const reset = await scopedRequest(request, 'POST', `${targetPath}/reset-password`, {
        token: staffToken,
        cookie: targetScope,
        data: { newPassword: customerTestPassword() },
      })
      expect(reset.status(), 'reset-password without manage in the target organization').toBe(403)

      const removal = await scopedRequest(request, 'DELETE', targetPath, { token: staffToken, cookie: targetScope })
      expect(removal.status(), 'DELETE without manage in the target organization').toBe(403)

      const after = await readTarget()
      expect(after.displayName, 'display name unchanged').toBe(before.displayName)
      expect(after.isActive, 'active flag unchanged').toBe(before.isActive)
      expect(after.emailVerified, 'email verification unchanged').toBe(before.emailVerified)
      expect(after.updatedAt, 'record version unchanged').toBe(before.updatedAt)

      // Positive control: the same actor manages users of its home organization.
      const homePath = `/api/customer_accounts/admin/users/${homeUserId}`
      const homeScope = scopeCookie(tenantId, homeOrgId)
      const homeUpdate = await scopedRequest(request, 'PUT', homePath, {
        token: staffToken,
        cookie: homeScope,
        data: { displayName: `QA CACC ORGSCOPE3 home renamed ${suffix}` },
      })
      expect(homeUpdate.status(), 'manage grant in the home organization allows writes').toBe(200)

      // Rejected selection: an organization the actor cannot access must not silently fall back
      // to the home organization for writes.
      const homeBefore = await readJsonSafe<CustomerUserDetail>(
        await scopedRequest(request, 'GET', homePath, { token: adminToken, cookie: homeScope }),
      )
      const rejectedScope = scopeCookie(tenantId, hiddenOrgId)
      const rejectedUpdate = await scopedRequest(request, 'PUT', homePath, {
        token: staffToken,
        cookie: rejectedScope,
        data: { displayName: `Fallback overwrite ${suffix}` },
      })
      expect(rejectedUpdate.status(), 'PUT with a rejected organization selection').toBe(403)
      const rejectedDelete = await scopedRequest(request, 'DELETE', homePath, { token: staffToken, cookie: rejectedScope })
      expect(rejectedDelete.status(), 'DELETE with a rejected organization selection').toBe(403)

      const homeAfter = await readJsonSafe<CustomerUserDetail>(
        await scopedRequest(request, 'GET', homePath, { token: adminToken, cookie: homeScope }),
      )
      expect(homeAfter?.displayName, 'home user unchanged after rejected-selection writes').toBe(homeBefore?.displayName)
      expect(homeAfter?.updatedAt).toBe(homeBefore?.updatedAt)
    } finally {
      for (const [userId, orgId] of [[targetUserId, targetOrgId], [homeUserId, homeOrgId]] as const) {
        if (userId && orgId) {
          await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${userId}`, {
            token: adminToken,
            cookie: scopeCookie(tenantId, orgId),
          }).catch(() => undefined)
        }
      }
      await deleteUserIfExists(request, superadminToken, staffId)
      await deleteRoleIfExists(request, superadminToken, managerRoleId)
      await deleteRoleIfExists(request, superadminToken, viewerRoleId)
      await deleteOrganizationIfExists(request, adminToken, targetOrgId)
      await deleteOrganizationIfExists(request, adminToken, hiddenOrgId)
    }
  })
})
