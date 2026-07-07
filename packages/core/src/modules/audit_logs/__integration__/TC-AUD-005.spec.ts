import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityByPathIfExists, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAuditableDictionaryEntry,
  findActionLog,
  listActionLogs,
} from './helpers/auditLogsApi'

/**
 * TC-AUD-005: audit_logs.view_tenant gates cross-actor visibility
 * Covers:
 *   - GET  /api/audit_logs/audit-logs/actions
 *   - POST /api/dictionaries/{id}/entries
 *
 * A user with only `audit_logs.view_self` must receive `canViewTenant=false`
 * and only ever see their own action logs. A tenant-wide viewer (superadmin)
 * receives `canViewTenant=true` and can read other actors' logs, including via
 * the admin-only `actorUserId` filter.
 */
test.describe('TC-AUD-005: view_tenant gates cross-actor visibility', () => {
  test('a view_self user sees only their own logs; a tenant viewer sees all', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Aud005!Pass1'
    const email = `qa-aud-viewself-${stamp}@acme.com`
    const roleName = `qa_aud_viewself_${stamp}`

    let superToken: string | null = null
    let restrictedToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let superDictionaryId: string | null = null
    let restrictedDictionaryId: string | null = null

    try {
      superToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superToken)

      roleId = await createRoleFixture(request, superToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, superToken, {
        roleId,
        features: ['audit_logs.view_self', 'dictionaries.manage'],
        organizations: null,
      })
      userId = await createUserFixture(request, superToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      restrictedToken = await getAuthToken(request, email, password)
      const restrictedUserId = getTokenScope(restrictedToken).userId
      expect(restrictedUserId, 'restricted user id should resolve from its token').toBeTruthy()

      // The tenant viewer (superadmin) authors a log under a different actor.
      const superEntry = await createAuditableDictionaryEntry(request, superToken, { keyPrefix: 'aud005_admin' })
      superDictionaryId = superEntry.dictionaryId
      const superLog = await findActionLog(request, superToken, { resourceId: superEntry.entryId })
      expect(superLog, "the tenant viewer's own log should exist").not.toBeNull()

      // The restricted user authors a log under their own actor.
      const restrictedEntry = await createAuditableDictionaryEntry(request, restrictedToken, { keyPrefix: 'aud005_self' })
      restrictedDictionaryId = restrictedEntry.dictionaryId

      // Restricted view: canViewTenant=false, only own logs visible.
      const restrictedList = await listActionLogs(request, restrictedToken)
      expect(restrictedList.status, 'restricted user can read the action log').toBe(200)
      expect(restrictedList.body, 'restricted list body present').not.toBeNull()
      expect(restrictedList.body!.canViewTenant, 'view_self user receives canViewTenant=false').toBe(false)
      const restrictedItems = restrictedList.body!.items
      expect(restrictedItems.length, 'restricted user sees at least their own log').toBeGreaterThan(0)
      expect(
        restrictedItems.every((item) => item.actorUserId === restrictedUserId),
        'every returned log belongs to the restricted actor (server-side scoping)',
      ).toBe(true)
      expect(
        restrictedItems.some((item) => item.resourceId === restrictedEntry.entryId),
        "restricted user's own log is included",
      ).toBe(true)
      expect(
        restrictedItems.some((item) => item.id === superLog!.id),
        "restricted user cannot see the tenant viewer's log",
      ).toBe(false)

      // Tenant viewer: canViewTenant=true, can read the restricted user's log
      // via the admin-only actorUserId filter.
      const tenantView = await listActionLogs(request, superToken, { actorUserId: restrictedUserId })
      expect(tenantView.status, 'tenant viewer can read the action log').toBe(200)
      expect(tenantView.body!.canViewTenant, 'tenant viewer receives canViewTenant=true').toBe(true)
      expect(
        tenantView.body!.items.some((item) => item.resourceId === restrictedEntry.entryId),
        "tenant viewer can see the restricted user's log via the actorUserId filter",
      ).toBe(true)
      expect(
        tenantView.body!.items.every((item) => item.actorUserId === restrictedUserId),
        'actorUserId filter is enforced server-side',
      ).toBe(true)
    } finally {
      await deleteEntityByPathIfExists(
        request,
        restrictedToken,
        restrictedDictionaryId ? `/api/dictionaries/${encodeURIComponent(restrictedDictionaryId)}` : null,
      )
      await deleteEntityByPathIfExists(
        request,
        superToken,
        superDictionaryId ? `/api/dictionaries/${encodeURIComponent(superDictionaryId)}` : null,
      )
      await deleteUserIfExists(request, superToken, userId)
      await deleteRoleIfExists(request, superToken, roleId)
    }
  })
})
