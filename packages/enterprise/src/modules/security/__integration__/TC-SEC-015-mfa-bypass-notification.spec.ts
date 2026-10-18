import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { loginViaApi } from './helpers/securityFixtures'

export const integrationMeta = {
  dependsOnModules: ['security', 'notifications'],
}

const NOTIFICATION_TYPE = 'security.mfa.emergency_bypass_active'

type Actor = {
  email: string
  password: string
  userId: string
  token: string | null
}

async function loginActor(actor: Actor): Promise<string> {
  return withCredentialIsolatedRequest(async (request) => {
    const response = await loginViaApi(request, actor.email, actor.password)
    expect(response.mfa_required).not.toBe(true)
    actor.token = response.token
    return response.token
  })
}

async function bypassNotifications(request: APIRequestContext, token: string) {
  return listNotifications(request, token, { type: NOTIFICATION_TYPE, pageSize: 100 })
}

test.describe('TC-SEC-015: MFA emergency bypass notification', () => {
  test('warns MFA managers including wildcard grants, excludes ordinary users, and deduplicates repeated logins', async ({ request }) => {
    test.skip(
      !parseBooleanWithDefault(process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS, false),
      'Requires an isolated app server and test runner both configured with OM_SECURITY_MFA_EMERGENCY_BYPASS=true.',
    )

    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = randomUUID()
    const roleIds: string[] = []
    const actors: Actor[] = []
    let organizationId: string | null = null
    let otherOrganizationId: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA MFA bypass ${stamp}`,
        tenantId,
      })
      otherOrganizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA MFA bypass other ${stamp}`,
        tenantId,
      })

      for (const [label, feature, actorOrganizationId] of [
        ['exact', 'security.mfa.manage', organizationId],
        ['wildcard', 'security.mfa.*', organizationId],
        ['ordinary', null, organizationId],
        ['other', 'security.mfa.manage', otherOrganizationId],
      ] as const) {
        const roleName = `qa_sec_bypass_${label}_${stamp}`
        const roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
        roleIds.push(roleId)
        await setRoleAclFeatures(request, adminToken, {
          roleId,
          features: ['notifications.view', ...(feature ? [feature] : [])],
          organizations: label === 'other' ? [organizationId, otherOrganizationId] : [actorOrganizationId],
        })
        const email = `qa-sec-bypass-${label}-${stamp}@example.test`
        const password = `Aa1!${randomUUID()}`
        const userId = await createUserFixture(request, adminToken, {
          email,
          password,
          organizationId: actorOrganizationId,
          roles: [roleName],
        })
        actors.push({ email, password, userId, token: null })
      }

      await Promise.all(actors.slice(0, 3).map(async (actor) => {
        const token = await loginActor(actor)
        expect(getTokenScope(token).organizationId).toBe(organizationId)
      }))
      await drainIntegrationQueue('events')

      await withCredentialIsolatedRequest(async (isolatedRequest) => {
        const originalIds = new Map<string, string>()
        for (const actor of actors.slice(0, 2)) {
          const notifications = await bypassNotifications(isolatedRequest, actor.token as string)
          expect(notifications.total).toBe(1)
          expect(notifications.items).toEqual([
            expect.objectContaining({
              id: expect.any(String),
              type: NOTIFICATION_TYPE,
              severity: 'warning',
              status: 'unread',
              titleKey: 'security.notifications.mfaEmergencyBypass.title',
              bodyKey: 'security.notifications.mfaEmergencyBypass.body',
              channels: ['in_app'],
            }),
          ])
          originalIds.set(actor.userId, notifications.items[0].id as string)
        }

        const ordinary = actors[2]
        expect(await bypassNotifications(isolatedRequest, ordinary.token as string)).toEqual({ items: [], total: 0 })
        const otherManager = actors[3]
        const readOtherManagerNotifications = () => withClient(async (client) => {
          const result = await client.query<{ id: string }>(
            'select id from notifications where tenant_id = $1 and recipient_user_id = $2 and type = $3',
            [tenantId, otherManager.userId, NOTIFICATION_TYPE],
          )
          return result.rows
        })
        expect(await readOtherManagerNotifications()).toEqual([])

        const firstManager = actors[0]
        const dismissedId = originalIds.get(firstManager.userId) as string
        const dismiss = await apiRequest(isolatedRequest, 'PUT', `/api/notifications/${encodeURIComponent(dismissedId)}/dismiss`, {
          token: firstManager.token as string,
        })
        expect(dismiss.ok()).toBe(true)

        await loginActor(firstManager)
        await drainIntegrationQueue('events')

        expect(await bypassNotifications(isolatedRequest, firstManager.token as string)).toEqual({ items: [], total: 0 })
        const dismissed = await listNotifications(isolatedRequest, firstManager.token as string, {
          type: NOTIFICATION_TYPE,
          status: 'dismissed',
        })
        expect(dismissed.total).toBe(1)
        expect(dismissed.items).toEqual([expect.objectContaining({ id: dismissedId, status: 'dismissed' })])
        const wildcardManager = actors[1]
        const notifications = await bypassNotifications(isolatedRequest, wildcardManager.token as string)
        expect(notifications.total).toBe(1)
        expect(notifications.items.map((item) => item.id)).toEqual([originalIds.get(wildcardManager.userId)])
        expect(await bypassNotifications(isolatedRequest, ordinary.token as string)).toEqual({ items: [], total: 0 })
        expect(await readOtherManagerNotifications()).toEqual([])
      })
    } finally {
      try {
        if (actors.length > 0) {
          await withClient(async (client) => {
            await client.query(
              'delete from notifications where tenant_id = $1 and recipient_user_id = any($2::uuid[]) and type = $3',
              [tenantId, actors.map((actor) => actor.userId), NOTIFICATION_TYPE],
            )
          })
        }
      } finally {
        for (const actor of [...actors].reverse()) {
          await deleteUserIfExists(request, adminToken, actor.userId)
        }
        for (const roleId of [...roleIds].reverse()) {
          await deleteRoleIfExists(request, adminToken, roleId)
        }
        await deleteOrganizationIfExists(request, adminToken, otherOrganizationId)
        await deleteOrganizationIfExists(request, adminToken, organizationId)
      }
    }
  })
})
