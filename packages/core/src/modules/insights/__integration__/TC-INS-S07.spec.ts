import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { QA_USER_PASSWORD } from './helpers/explainApi'
import { createXrayRole, createXrayUser } from './helpers/xrayAnalyticsApi'
import {
  OPTIMISTIC_LOCK_HEADER,
  SIMULATIONS_PATH,
  cellOf,
  cleanupSimulationFixture,
  createSimulationFixture,
  createSimulationOrganization,
  groupOf,
  readSimulation,
  requestSimulation,
  simulationCall,
  uniqueSuffix,
  type SimulationFixture,
} from './helpers/simulationApi'

export const integrationMeta = {
  description: 'Change simulator role permission preview end to end (403 gates, hidden super administrators, access log, counts, live principals, apply and decisions)',
  dependsOnModules: ['insights', 'auth', 'api_keys', 'audit_logs', 'customers'],
}

const PREVIEW_KIND = 'auth.role_acl_preview'
const ACCESS_LOG_KIND = 'insights.simulation.permission_preview'
const ROLE_ACL_PATH = '/api/auth/roles/acl'
const HOUR_MS = 60 * 60 * 1000

const HOLDER_FEATURES = ['customers.deals.view', 'customers.deals.manage']

/** The role manager: the simulator, ACL management and user listing, plus the features the role grants. */
const MANAGER_FEATURES = [
  'insights.simulator.view',
  'insights.simulator.run',
  'auth.acl.manage',
  'auth.users.list',
  'auth.roles.list',
  'auth.roles.manage',
  'api_keys.view',
  'customers.deals.view',
  'customers.deals.manage',
]

type PreviewRun = {
  id: string
  status: string
  execution?: string
  hasLiveRecords?: boolean
  completedAt: string | null
  expiresAt: string
  result: {
    k: number
    groups: Array<{ key: string; total: number | null; suppressed: boolean; cells: Array<{ key: string; count: number | null; suppressed: string | null; samples: unknown[] }>; warnings: string[]; flags: string[] }>
    summary: { warnings: string[]; counts: Record<string, number>; lists: Record<string, string[]> } | null
  } | null
  caveats: string[]
  budgets: { recordsUsed: number | null }
  decisions: Array<{ decision: string; verified: boolean | null }>
}

type RecordsBody = {
  items: Array<{ id: string; type: string; label: string | null; href: string | null; groupKeys: string[]; counts: Record<string, number> }>
  total: number
  notes: string[]
  groupLabels: Record<string, string>
}

async function readAcl(request: APIRequestContext, token: string, roleId: string): Promise<{ updatedAt: string | null; features: string[] }> {
  const response = await apiRequest(request, 'GET', `${ROLE_ACL_PATH}?roleId=${roleId}`, { token })
  expect(response.status(), `GET ${ROLE_ACL_PATH}`).toBe(200)
  const body = (await response.json()) as { updatedAt?: string | null; features?: string[] }
  return { updatedAt: body.updatedAt ?? null, features: body.features ?? [] }
}

async function putAcl(
  request: APIRequestContext,
  token: string,
  input: { roleId: string; features: string[]; organizations: string[] | null; isSuperAdmin?: boolean },
  expectedUpdatedAt?: string | null,
): Promise<number> {
  const response = await apiRequest(request, 'PUT', ROLE_ACL_PATH, {
    token,
    data: input,
    headers: expectedUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER]: expectedUpdatedAt } : undefined,
  })
  return response.status()
}

async function countAccessLogRows(organizationId: string, actorUserId: string, accessType: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ total: string }>(
      'select count(*)::text as total from access_logs where resource_kind = $1 and organization_id = $2 and actor_user_id = $3 and access_type = $4',
      [ACCESS_LOG_KIND, organizationId, actorUserId, accessType],
    )
    return Number(result.rows[0]?.total ?? 0)
  })
}

async function preview(request: APIRequestContext, token: string, organizationId: string, roleId: string, features: string[]) {
  return requestSimulation(request, token, {
    kind: PREVIEW_KIND,
    artifactId: roleId,
    proposal: { roleId, isSuperAdmin: false, features, organizations: [organizationId] },
  }, { selectedOrgId: organizationId })
}

async function completedRun(request: APIRequestContext, token: string, organizationId: string, runId: string): Promise<PreviewRun> {
  const read = await readSimulation(request, token, runId, { selectedOrgId: organizationId })
  expect(read.status, `GET ${SIMULATIONS_PATH}/${runId}: ${read.text}`).toBe(200)
  return read.body?.result as unknown as PreviewRun
}

/** A role whose ACL is the super-admin flag, and a user holding it plus `roleId` (both created by the super administrator). */
async function createHiddenSuperAdmin(request: APIRequestContext, fixture: SimulationFixture, organizationId: string, roleId: string): Promise<string> {
  if (!fixture.superadminToken) fixture.superadminToken = await getAuthToken(request, 'superadmin')
  const superToken = fixture.superadminToken
  const superRoleId = await createRoleFixture(request, superToken, { name: `QA INS-S07 super ${uniqueSuffix()}`, tenantId: fixture.tenantId ?? undefined })
  fixture.privilegedRoleIds.push(superRoleId)
  expect(await putAcl(request, superToken, { roleId: superRoleId, isSuperAdmin: true, features: [], organizations: null })).toBe(200)
  const userId = await createUserFixture(request, superToken, {
    email: `qa-ins-s07-super-${uniqueSuffix()}@example.com`,
    password: QA_USER_PASSWORD,
    organizationId,
    roles: [roleId, superRoleId],
    name: 'QA INS-S07 hidden super admin',
  })
  fixture.privilegedUserIds.push(userId)
  return userId
}

/**
 * TC-INS-S07: role permission preview end to end.
 * Covers POST /api/insights/simulations for the inline kind `auth.role_acl_preview`, GET
 * /api/insights/simulations/{id} and /records, PUT /api/auth/roles/acl as the apply path (optimistic
 * lock), and POST /api/insights/simulations/{id}/decision.
 *
 * A fresh organization (k = 5) has a role granting deal view + manage there, held by five users, a
 * hidden super administrator and an API key. A role manager previews removing deal management: the
 * preview is computed at once (completed, 24 h TTL), writes an access-log row first, counts the five
 * users as losing permissions (the super administrator is absent from counts and lists; the single
 * API key is a group below k), reports the lost feature and gated pages, and lists the affected users
 * and API key live. Callers without `auth.acl.manage` or `auth.users.list` are refused (403), an
 * unknown role answers 404. Applying through the ACL PUT verifies the decision; a stale lock answers
 * 409; a differing save does not verify. Previewing the removal of the manager's own
 * `auth.acl.manage` warns about the self-lockout.
 */
test.describe('TC-INS-S07: role permission preview end to end', () => {
  test('previews a role ACL change, hides super administrators, logs the access, then verifies the applied decision', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    const apiKeyIds: string[] = []
    let organizationId: string | null = null
    try {
      organizationId = await createSimulationOrganization(request, fixture, 'INS-S07')
      const orgId = organizationId
      const roleId = await createXrayRole(request, fixture, { label: 'INS-S07 sales', features: HOLDER_FEATURES, organizations: [orgId] })
      const holderIds: string[] = []
      for (let index = 0; index < 5; index += 1) {
        const userId = await createUserFixture(request, fixture.adminToken as string, {
          email: `qa-ins-s07-holder-${index}-${uniqueSuffix()}@example.com`,
          password: QA_USER_PASSWORD,
          organizationId: orgId,
          roles: [roleId],
          name: `QA INS-S07 holder ${index}`,
        })
        fixture.userIds.push(userId)
        holderIds.push(userId)
      }
      const hiddenSuperAdminId = await createHiddenSuperAdmin(request, fixture, orgId, roleId)
      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: fixture.adminToken as string,
        data: { name: `QA INS-S07 key ${uniqueSuffix()}`, roles: [roleId], organizationId: orgId },
      })
      expect(keyResponse.ok(), `POST /api/api_keys/keys: ${await keyResponse.text()}`).toBeTruthy()
      const apiKeyId = ((await keyResponse.json()) as { id: string }).id
      apiKeyIds.push(apiKeyId)

      const managerRoleId = await createXrayRole(request, fixture, { label: 'INS-S07 manager', features: MANAGER_FEATURES, organizations: [orgId] })
      const manager = await createXrayUser(request, fixture, { label: 'INS-S07 manager', organizationId: orgId, roleId: managerRoleId })
      const withoutAclManage = await createXrayUser(request, fixture, {
        label: 'INS-S07 no acl',
        organizationId: orgId,
        roleId: await createXrayRole(request, fixture, { label: 'INS-S07 no acl', features: MANAGER_FEATURES.filter((feature) => feature !== 'auth.acl.manage'), organizations: [orgId] }),
      })
      const withoutUsersList = await createXrayUser(request, fixture, {
        label: 'INS-S07 no users',
        organizationId: orgId,
        roleId: await createXrayRole(request, fixture, { label: 'INS-S07 no users', features: MANAGER_FEATURES.filter((feature) => feature !== 'auth.users.list'), organizations: [orgId] }),
      })

      const refused = await preview(request, withoutAclManage.token, orgId, roleId, ['customers.deals.view'])
      expect(refused.status, refused.text).toBe(403)
      expect(refused.body?.code).toBe('forbidden')
      expect((await preview(request, withoutUsersList.token, orgId, roleId, ['customers.deals.view'])).status).toBe(403)
      const unknownRole = await preview(request, manager.token, orgId, '00000000-0000-4000-8000-0000000000c7', ['customers.deals.view'])
      expect(unknownRole.status, unknownRole.text).toBe(404)
      expect(unknownRole.body?.code).toBe('artifact_unavailable')
      expect(await countAccessLogRows(orgId, manager.userId, 'simulate')).toBe(0)

      const before = await readAcl(request, manager.token, roleId)
      const requested = await preview(request, manager.token, orgId, roleId, ['customers.deals.view'])
      expect(requested.status, requested.text).toBe(200)
      expect(requested.body).toEqual(expect.objectContaining({ ok: true, status: 'completed', progressJobId: null, deduplicated: false }))
      const runId = requested.body?.runId as string
      expect(await countAccessLogRows(orgId, manager.userId, 'simulate')).toBe(1)

      const run = await completedRun(request, manager.token, orgId, runId)
      expect(run.status).toBe('completed')
      expect(run.execution).toBe('inline')
      expect(run.hasLiveRecords).toBe(true)
      expect(Date.parse(run.expiresAt) - Date.parse(run.completedAt as string)).toBeGreaterThan(24 * HOUR_MS - 60_000)
      expect(Date.parse(run.expiresAt) - Date.parse(run.completedAt as string)).toBeLessThanOrEqual(24 * HOUR_MS + 60_000)
      const users = groupOf(run as never, `${orgId}:users`)
      expect(users.suppressed).toBe(false)
      expect(users.total).toBe(5)
      expect(cellOf(users, 'loses').count).toBe(5)
      expect(cellOf(users, 'gains').count).toBe(0)
      expect(cellOf(users, 'unchanged').count).toBe(0)
      const keys = groupOf(run as never, `${orgId}:api_keys`)
      expect(keys.suppressed).toBe(true)
      expect(keys.total).toBeNull()
      expect(run.budgets.recordsUsed).toBeNull()
      expect(run.result?.summary?.lists.features_lost).toEqual(['customers.deals.manage'])
      expect(run.result?.summary?.lists.features_gained).toEqual([])
      expect(run.result?.summary?.warnings).toEqual([])
      expect(run.result?.summary?.counts.pages_lost ?? 0).toBeGreaterThanOrEqual(1)
      if (run.result?.summary?.counts.api_routes_lost === undefined) expect(run.caveats).toContain('auth.simulation.caveats.apiRoutesUnavailable')
      else expect(run.result.summary.counts.api_routes_lost).toBeGreaterThanOrEqual(3)
      const stored = JSON.stringify(run)
      for (const id of [...holderIds, hiddenSuperAdminId, apiKeyId]) expect(stored).not.toContain(id)

      const records = await simulationCall<RecordsBody>(request, manager.token, 'GET', `${SIMULATIONS_PATH}/${runId}/records?pageSize=100`, { selectedOrgId: orgId })
      expect(records.status, records.text).toBe(200)
      expect(records.body?.total).toBe(6)
      expect(records.body?.items.filter((item) => item.type === 'user').map((item) => item.id).sort()).toEqual([...holderIds].sort())
      expect(records.body?.items.filter((item) => item.type === 'api_key').map((item) => item.id)).toEqual([apiKeyId])
      expect(records.body?.items.map((item) => item.id)).not.toContain(hiddenSuperAdminId)
      expect(records.body?.items.every((item) => item.counts.features_lost === 1 && item.counts.features_gained === 0)).toBe(true)
      expect(records.body?.groupLabels[`${orgId}:users`]).toBeTruthy()
      expect(await countAccessLogRows(orgId, manager.userId, 'read')).toBe(1)
      const recordsDenied = await simulationCall(request, withoutUsersList.token, 'GET', `${SIMULATIONS_PATH}/${runId}/records`, { selectedOrgId: orgId })
      expect(recordsDenied.status).toBe(404)

      expect(await putAcl(request, manager.token, { roleId, features: ['customers.deals.view'], organizations: [orgId] }, before.updatedAt)).toBe(200)
      expect(await putAcl(request, manager.token, { roleId, features: ['customers.deals.view'], organizations: [orgId] }, before.updatedAt)).toBe(409)
      const applied = await simulationCall<{ decision?: { decision: string; verified: boolean | null } }>(request, manager.token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { selectedOrgId: orgId, data: { decision: 'applied' } })
      expect(applied.status, applied.text).toBe(201)
      expect(applied.body?.decision).toEqual(expect.objectContaining({ decision: 'applied', verified: true }))
      const inEffect = await simulationCall<RecordsBody>(request, manager.token, 'GET', `${SIMULATIONS_PATH}/${runId}/records`, { selectedOrgId: orgId })
      expect(inEffect.body?.total).toBe(0)
      expect(inEffect.body?.notes).toEqual(['auth.simulation.records.proposalInEffect'])

      const second = await preview(request, manager.token, orgId, roleId, [])
      expect(second.status, second.text).toBe(200)
      expect(second.body?.runId).not.toBe(runId)
      const current = await readAcl(request, manager.token, roleId)
      expect(await putAcl(request, manager.token, { roleId, features: HOLDER_FEATURES, organizations: [orgId] }, current.updatedAt)).toBe(200)
      const differs = await simulationCall<{ decision?: { verified: boolean | null } }>(request, manager.token, 'POST', `${SIMULATIONS_PATH}/${second.body?.runId}/decision`, { selectedOrgId: orgId, data: { decision: 'applied' } })
      expect(differs.status, differs.text).toBe(201)
      expect(differs.body?.decision?.verified).toBe(false)

      const selfLockout = await preview(request, manager.token, orgId, managerRoleId, MANAGER_FEATURES.filter((feature) => feature !== 'auth.acl.manage'))
      expect(selfLockout.status, selfLockout.text).toBe(200)
      const selfRun = await completedRun(request, manager.token, orgId, selfLockout.body?.runId as string)
      expect(selfRun.result?.summary?.warnings).toEqual(['auth.simulation.warnings.selfLockoutAclManage'])
    } finally {
      if (organizationId) {
        const orgId = organizationId
        await withClient(async (client) => {
          await client.query('delete from access_logs where organization_id = $1 and resource_kind = $2', [orgId, ACCESS_LOG_KIND])
          for (const id of apiKeyIds) await client.query('delete from api_keys where id = $1', [id])
        }).catch(() => undefined)
      }
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
