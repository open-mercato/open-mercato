import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'

// TC-NOTIF-012: organization-dimension scoping for admin-on-behalf notification preferences. The
// admin route authorizes the *target user* through the platform's standard user-access guard
// (assertActorCanAccessUserTarget), so an org-restricted admin can only manage users inside its own
// organization — mirroring TC-DEV-005's restricted-admin pattern. Reuses the shared org/user/role
// fixtures; self-contained (creates fixtures in setup, cleans up in finally).

const ADMIN_PREFERENCES_PATH = '/api/notifications/admin/preferences'

let counter = 0
function uniqueTypeId(): string {
  counter += 1
  return `qa.notif.012.${Date.now()}.${counter}`
}

type PreferenceItem = { notificationTypeId: string; channel: string; enabled: boolean }
type PreferencesResponse = { items: PreferenceItem[] }

async function adminGet(request: APIRequestContext, token: string, userId: string) {
  return apiRequest(request, 'GET', `${ADMIN_PREFERENCES_PATH}?userId=${encodeURIComponent(userId)}`, { token })
}

async function adminPut(request: APIRequestContext, token: string, userId: string, preferences: PreferenceItem[]) {
  return apiRequest(request, 'PUT', ADMIN_PREFERENCES_PATH, { token, data: { userId, preferences } })
}

test.describe('TC-NOTIF-012: admin preference scoping across organizations', () => {
  test('an org-restricted admin can manage in-org users but is refused out-of-org users', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const password = 'Secret123!'
    const superAdminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(superAdminToken)

    let orgAId: string | null = null
    let orgBId: string | null = null
    let targetRoleId: string | null = null
    let adminRoleId: string | null = null
    let userInOrgAId: string | null = null
    let userInOrgBId: string | null = null
    let restrictedAdminId: string | null = null

    try {
      orgAId = await createOrganizationInDb({ name: `NOTIF-012 Org A ${stamp}`, tenantId })
      orgBId = await createOrganizationInDb({ name: `NOTIF-012 Org B ${stamp}`, tenantId })

      // Two target users, one per org (minimal role just so the fixture can create them).
      targetRoleId = await createRoleFixture(request, superAdminToken, { name: `NOTIF-012 Target ${stamp}` })
      await setRoleAclFeatures(request, superAdminToken, { roleId: targetRoleId, features: ['notifications.view'] })
      userInOrgAId = await createUserFixture(request, superAdminToken, {
        email: `tc-notif-012-a-${stamp}@example.com`,
        password,
        organizationId: orgAId,
        roles: [targetRoleId],
      })
      userInOrgBId = await createUserFixture(request, superAdminToken, {
        email: `tc-notif-012-b-${stamp}@example.com`,
        password,
        organizationId: orgBId,
        roles: [targetRoleId],
      })

      // An admin whose visibility is restricted to org B.
      const restrictedEmail = `tc-notif-012-admin-${stamp}@example.com`
      adminRoleId = await createRoleFixture(request, superAdminToken, { name: `NOTIF-012 Restricted Admin ${stamp}` })
      await setRoleAclFeatures(request, superAdminToken, {
        roleId: adminRoleId,
        features: ['notifications.manage_user_preferences'],
        organizations: [orgBId],
      })
      restrictedAdminId = await createUserFixture(request, superAdminToken, {
        email: restrictedEmail,
        password,
        organizationId: orgBId,
        roles: [adminRoleId],
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, password)

      const typeId = uniqueTypeId()

      // In-org (org B): the restricted admin can write and read back.
      const okPut = await adminPut(request, restrictedToken, userInOrgBId, [
        { notificationTypeId: typeId, channel: 'push', enabled: false },
      ])
      expect(okPut.status(), 'restricted admin may edit an in-org user').toBe(200)

      const okGet = await adminGet(request, restrictedToken, userInOrgBId)
      expect(okGet.status(), 'restricted admin may read an in-org user').toBe(200)
      const okItems = (await readJsonSafe<PreferencesResponse>(okGet))?.items ?? []
      expect(okItems.some((p) => p.notificationTypeId === typeId && p.channel === 'push' && p.enabled === false)).toBe(true)

      // Out-of-org (org A): both read and write are refused with 403.
      const deniedGet = await adminGet(request, restrictedToken, userInOrgAId)
      expect(deniedGet.status(), 'restricted admin cannot read an out-of-org user').toBe(403)

      const deniedPut = await adminPut(request, restrictedToken, userInOrgAId, [
        { notificationTypeId: typeId, channel: 'push', enabled: false },
      ])
      expect(deniedPut.status(), 'restricted admin cannot edit an out-of-org user').toBe(403)

      // Sanity: an unrestricted admin can reach the org-A user.
      const adminGetA = await adminGet(request, superAdminToken, userInOrgAId)
      expect(adminGetA.status(), 'unrestricted admin may read any in-tenant user').toBe(200)
    } finally {
      await deleteUserIfExists(request, superAdminToken, restrictedAdminId).catch(() => undefined)
      await deleteUserIfExists(request, superAdminToken, userInOrgAId).catch(() => undefined)
      await deleteUserIfExists(request, superAdminToken, userInOrgBId).catch(() => undefined)
      await deleteRoleIfExists(request, superAdminToken, adminRoleId).catch(() => undefined)
      await deleteRoleIfExists(request, superAdminToken, targetRoleId).catch(() => undefined)
      await deleteOrganizationInDb(orgAId).catch(() => undefined)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })
})
