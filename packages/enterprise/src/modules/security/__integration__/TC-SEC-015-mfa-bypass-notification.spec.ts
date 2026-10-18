import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
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
import {
  dismissNotificationsByType,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
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

    try {
      organizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA MFA bypass ${stamp}`,
        tenantId,
      })

      for (const [label, feature] of [
        ['exact', 'security.mfa.manage'],
        ['wildcard', 'security.mfa.*'],
        ['ordinary', null],
      ] as const) {
        const roleName = `qa_sec_bypass_${label}_${stamp}`
        const roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
        roleIds.push(roleId)
        await setRoleAclFeatures(request, adminToken, {
          roleId,
          features: ['notifications.view', ...(feature ? [feature] : [])],
          organizations: [organizationId],
        })
        const email = `qa-sec-bypass-${label}-${stamp}@example.test`
        const password = `Aa1!${randomUUID()}`
        const userId = await createUserFixture(request, adminToken, {
          email,
          password,
          organizationId,
          roles: [roleName],
        })
        actors.push({ email, password, userId, token: null })
      }

      for (const actor of actors) {
        const token = await loginActor(actor)
        expect(getTokenScope(token).organizationId).toBe(organizationId)
      }
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

        await loginActor(actors[0])
        await drainIntegrationQueue('events')

        for (const actor of actors.slice(0, 2)) {
          const notifications = await bypassNotifications(isolatedRequest, actor.token as string)
          expect(notifications.total).toBe(1)
          expect(notifications.items.map((item) => item.id)).toEqual([originalIds.get(actor.userId)])
        }
        expect(await bypassNotifications(isolatedRequest, ordinary.token as string)).toEqual({ items: [], total: 0 })
      })
    } finally {
      await withCredentialIsolatedRequest(async (isolatedRequest) => {
        for (const actor of actors) {
          await dismissNotificationsByType(isolatedRequest, actor.token, NOTIFICATION_TYPE)
        }
      })
      for (const actor of [...actors].reverse()) {
        await deleteUserIfExists(request, adminToken, actor.userId)
      }
      for (const roleId of [...roleIds].reverse()) {
        await deleteRoleIfExists(request, adminToken, roleId)
      }
      await deleteOrganizationIfExists(request, adminToken, organizationId)
    }
  })
})
