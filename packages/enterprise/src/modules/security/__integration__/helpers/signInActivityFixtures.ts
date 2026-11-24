import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, postForm, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const firefoxLinux = 'Firefox/132 on Linux'
export const chromeWindows = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36'
export const fixtureIp = '203.0.113.7'
export const newDeviceNotificationType = 'security.sign_in.new_device'

export type ActivityRow = {
  id: string
  ipAddress: string | null
  browserName: string | null
  mfaStatus: string | null
  userAgent: string | null
}

type Actor = { tenantId: string; organizationId: string; userId: string; email: string; password: string }
type LoginResult = { ok: boolean; token?: string; mfa_required?: boolean; challenge_id?: string; redirect?: string }

const actorFeatures = [
  'security.profile.view', 'security.profile.manage', 'security.mfa.manage', 'notifications.view', 'dashboards.view',
]

export async function createActivityFixture(request: APIRequestContext) {
  const available = await request.get('/api/security/sign-ins')
  expect(available.status(), 'The isolated app must expose Enterprise sign-in activity').not.toBe(404)
  const adminToken = await withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, 'superadmin'))
  const homeTenantId = getTokenScope(adminToken).tenantId
  const cleanup: Array<() => Promise<unknown>> = []
  const actors: Array<{ tenantId: string; userId: string }> = []

  async function dispose() {
    try {
      await drainIntegrationQueue('events')
    } finally {
      try {
        if (actors.length > 0) {
          await withClient(async (client) => {
            for (const { tenantId, userId } of actors) {
              await client.query(
                'delete from notifications where tenant_id = $1 and recipient_user_id = $2 and type = $3',
                [tenantId, userId, newDeviceNotificationType],
              )
              await client.query('delete from security_sign_in_notification_intents where tenant_id = $1 and user_id = $2', [tenantId, userId])
              await client.query('delete from security_sign_in_mfa_receipts where tenant_id = $1 and user_id = $2', [tenantId, userId])
              await client.query('delete from security_sign_in_attempts where tenant_id = $1 and user_id = $2', [tenantId, userId])
              await client.query('delete from security_known_devices where tenant_id = $1 and user_id = $2', [tenantId, userId])
              await client.query('delete from mfa_challenges where tenant_id = $1 and user_id = $2', [tenantId, userId])
              await client.query('delete from user_mfa_methods where tenant_id = $1 and user_id = $2', [tenantId, userId])
            }
          })
        }
      } finally {
        for (const action of cleanup.reverse()) await action()
      }
    }
  }

  async function createActor(options: { foreign?: boolean; isAdmin?: boolean; enforce?: boolean } = {}): Promise<Actor> {
    const stamp = randomUUID()
    let tenantId = homeTenantId
    if (options.foreign) {
      const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: adminToken, data: { name: `QA sign-in tenant ${stamp}` },
      })
      expect(tenant.status()).toBe(201)
      const created = await tenant.json() as { id: string }
      cleanup.push(() => apiRequest(request, 'DELETE', `/api/directory/tenants?id=${created.id}`, { token: adminToken }))
      tenantId = created.id
    }

    const organizationId = await createOrganizationFixture(request, adminToken, { tenantId, name: `QA sign-in ${stamp}` })
    cleanup.push(() => deleteOrganizationIfExists(request, adminToken, organizationId))
    const roleName = `qa_sign_in_${stamp}`
    const roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
    cleanup.push(() => deleteRoleIfExists(request, adminToken, roleId))
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      organizations: [organizationId],
      features: options.isAdmin ? [...actorFeatures, 'auth.users.list', 'security.sign_ins.view'] : actorFeatures,
    })

    const email = `qa-sign-in-${stamp}@example.test`
    const password = `Aa1!${randomUUID()}`
    const userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    actors.push({ tenantId, userId })
    cleanup.push(() => deleteUserIfExists(request, adminToken, userId))
    const policy = await apiRequest(request, 'POST', '/api/security/enforcement', {
      token: adminToken,
      data: { tenantId, organizationId, scope: 'organisation', isEnforced: options.enforce ?? false, allowedMethods: ['totp'] },
    })
    expect(policy.status()).toBe(201)
    const { id: policyId } = await policy.json() as { id: string }
    cleanup.push(() => apiRequest(request, 'DELETE', `/api/security/enforcement/${policyId}`, { token: adminToken }))

    return { tenantId, organizationId, userId, email, password }
  }

  return { adminToken, createActor, dispose }
}

export async function signIn(actor: Pick<Actor, 'email' | 'password'>, input: {
  userAgent?: string
  ip?: string
  requireRole?: string
  status?: number
} = {}) {
  const data = {
    email: actor.email,
    password: actor.password,
    ...(input.requireRole ? { requireRole: input.requireRole } : {}),
  }
  return withCredentialIsolatedRequest(async (isolatedRequest) => {
    const response = await postForm(isolatedRequest, '/api/auth/login', data, {
      headers: { 'User-Agent': input.userAgent ?? firefoxLinux, 'X-Forwarded-For': input.ip ?? fixtureIp },
    })
    expect(response.status()).toBe(input.status ?? 200)
    return await response.json() as LoginResult
  })
}

export function expectLoginToken(result: LoginResult): string {
  expect(result.token).toEqual(expect.any(String))
  if (!result.token) throw new Error('[internal] Fixture login returned no token')
  return result.token
}

export async function getActivity(request: APIRequestContext, token: string, query: Record<string, string> = {}) {
  const response = await apiRequest(request, 'GET', `/api/security/sign-ins?${new URLSearchParams(query)}`, { token })
  expect(response.status()).toBe(200)
  return await response.json() as { items: ActivityRow[]; total: number }
}

export async function getOwnActivity(request: APIRequestContext, token: string) {
  const response = await apiRequest(request, 'GET', '/api/security/profile/sign-ins', { token })
  expect(response.status()).toBe(200)
  return await response.json() as { items: ActivityRow[] }
}

export async function expectActivityCount(request: APIRequestContext, token: string, query: Record<string, string>, count: number) {
  await expect.poll(async () => {
    await drainIntegrationQueue('events')
    return (await getActivity(request, token, query)).total
  }, { timeout: 10_000 }).toBe(count)
  return (await getActivity(request, token, query)).items
}

export async function enqueueActivityJob<T>(name: string, data: T) {
  const [{ createQueue }, { resolveAppRoot }, { resolve }] = await Promise.all([
    import('@open-mercato/queue'),
    import('@open-mercato/core/helpers/integration/appRoot'),
    import('node:path'),
  ])
  const baseDir = process.env.QUEUE_BASE_DIR?.trim() || resolve(resolveAppRoot(), '.mercato/queue')
  const queue = createQueue<T>(name, 'local', { baseDir })
  try {
    await queue.enqueue(data)
  } finally {
    await queue.close()
  }
}
