import { expect, test, type APIRequestContext } from '@playwright/test'
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
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_JOBS_PATH, createScheduleJob, deleteScheduleJob } from './helpers/scheduler'

/**
 * TC-SCHED-010: real-world regression for #7806 — `GET /api/scheduler/jobs?format=json&exportScope=full`
 * must keep applying the route's own `buildFilters` visibility predicate (own-org, own-tenant-scope,
 * superadmin-only system-scope) instead of dropping to `{}`, which would leak every tenant's jobs on a
 * full export (scheduler jobs opt out of the factory's automatic tenant/org scope via
 * `omitAutomaticTenantOrgScope`, so it owns 100% of the visibility logic). Unlike the existing mocked
 * unit coverage in `api/jobs/__tests__/route.scope.test.ts`, this exercises the real authenticated route,
 * real ACL resolution, and a real Postgres-backed query engine.
 */

const SCHEDULER_FEATURES = ['scheduler.jobs.view', 'scheduler.jobs.manage']

async function createTenantFixture(request: APIRequestContext, superadminToken: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token: superadminToken, data: { name } })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tenant fixture should return an id')
}

async function deleteTenantIfExists(request: APIRequestContext, superadminToken: string | null, tenantId: string | null): Promise<void> {
  if (!superadminToken || !tenantId) return
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`, { token: superadminToken }).catch(() => undefined)
}

type ScopedActor = {
  organizationId: string
  roleId: string
  userId: string
  token: string
}

/** Provisions a role (scoped to exactly one organization) + user + token, so the actor's own-org
 * visibility can never widen to "every org in the tenant" and mask the isolation this test checks. */
async function createScopedActor(
  request: APIRequestContext,
  superadminToken: string,
  input: { tenantId: string; organizationId: string; stamp: string; label: string; features?: string[] },
): Promise<ScopedActor> {
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `sched-${input.label}-${input.stamp}`,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features: input.features ?? SCHEDULER_FEATURES,
    organizations: [input.organizationId],
  })
  const email = `sched-${input.label}-${input.stamp}@test.invalid`
  const password = 'Valid1!Pass'
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [roleId],
  })
  const token = await getAuthToken(request, email, password)
  return { organizationId: input.organizationId, roleId, userId, token }
}

async function cleanupScopedActor(request: APIRequestContext, superadminToken: string, actor: ScopedActor | null): Promise<void> {
  if (!actor) return
  await deleteUserIfExists(request, superadminToken, actor.userId)
  await deleteRoleIfExists(request, superadminToken, actor.roleId)
}

test.describe('TC-SCHED-010: full export stays scoped to the caller tenant/organization (#7806)', () => {
  test('own-org job survives, other-org and foreign-tenant jobs do not; missing-feature caller is refused', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId: homeTenantId, organizationId: homeOrgId } = getTokenContext(adminToken)
    expect(homeTenantId.length, 'admin token should carry a tenant id').toBeGreaterThan(0)
    expect(homeOrgId.length, 'admin token should carry an organization id').toBeGreaterThan(0)

    const stamp = `${Date.now()}`

    let ownOrgActor: ScopedActor | null = null
    let otherOrgActor: ScopedActor | null = null
    let viewOnlyActor: ScopedActor | null = null
    let secondOrgId: string | null = null
    let foreignTenantId: string | null = null
    let foreignOrgId: string | null = null
    let foreignRoleId: string | null = null
    let foreignUserId: string | null = null
    let ownOrgJobId: string | null = null
    let otherOrgJobId: string | null = null
    let foreignTenantJobId: string | null = null
    let foreignToken: string | null = null

    try {
      // Own-org actor: scoped to the home tenant's existing organization.
      ownOrgActor = await createScopedActor(request, superadminToken, {
        tenantId: homeTenantId,
        organizationId: homeOrgId,
        stamp,
        label: 'own',
      })

      // Other-org actor: a SECOND organization inside the SAME tenant.
      secondOrgId = await createOrganizationFixture(request, superadminToken, {
        name: `QA SCHED Org B ${stamp}`,
        tenantId: homeTenantId,
      })
      otherOrgActor = await createScopedActor(request, superadminToken, {
        tenantId: homeTenantId,
        organizationId: secondOrgId,
        stamp,
        label: 'other-org',
      })

      // Foreign-tenant actor: a genuinely different tenant + organization (the #7806 boundary).
      foreignTenantId = await createTenantFixture(request, superadminToken, `QA SCHED Tenant B ${stamp}`)
      foreignOrgId = await createOrganizationFixture(request, superadminToken, {
        name: `QA SCHED Org C ${stamp}`,
        tenantId: foreignTenantId,
      })
      foreignRoleId = await createRoleFixture(request, superadminToken, { name: `sched-foreign-${stamp}`, tenantId: foreignTenantId })
      await setRoleAclFeatures(request, superadminToken, { roleId: foreignRoleId, features: SCHEDULER_FEATURES, organizations: [foreignOrgId] })
      const foreignEmail = `sched-foreign-${stamp}@test.invalid`
      const foreignPassword = 'Valid1!Pass'
      foreignUserId = await createUserFixture(request, superadminToken, {
        email: foreignEmail,
        password: foreignPassword,
        organizationId: foreignOrgId,
        roles: [foreignRoleId],
      })
      foreignToken = await getAuthToken(request, foreignEmail, foreignPassword)

      // View-only (no scheduler.jobs.view) actor in the home org, for the 403 assertion.
      viewOnlyActor = await createScopedActor(request, superadminToken, {
        tenantId: homeTenantId,
        organizationId: homeOrgId,
        stamp,
        label: 'nofeat',
        features: [],
      })

      ownOrgJobId = await createScheduleJob(request, ownOrgActor.token, { name: `QA SCHED Own Org Job ${stamp}` })
      otherOrgJobId = await createScheduleJob(request, otherOrgActor.token, { name: `QA SCHED Other Org Job ${stamp}` })
      foreignTenantJobId = await createScheduleJob(request, foreignToken, { name: `QA SCHED Foreign Tenant Job ${stamp}` })

      // Full export as the own-org actor must only surface the own-org job.
      const exportResponse = await apiRequest(
        request,
        'GET',
        `${SCHEDULER_JOBS_PATH}?format=json&exportScope=full`,
        { token: ownOrgActor.token },
      )
      expect(exportResponse.status(), 'full export should return 200 for an authorized caller').toBe(200)
      // The full-export JSON serializer keys each row by its human-readable column header
      // (e.g. "Id"), not the raw field name — see `serializeJson` in `lib/crud/exporters.ts`.
      const exported = await readJsonSafe<Array<{ Id: string }>>(exportResponse)
      const exportedIds = new Set((exported ?? []).map((item) => item.Id))

      expect(exportedIds.has(ownOrgJobId), 'own-org job must survive the full export').toBe(true)
      expect(exportedIds.has(otherOrgJobId), 'another organization\'s job (same tenant) must not leak into the export').toBe(false)
      expect(exportedIds.has(foreignTenantJobId), 'a foreign tenant\'s job must not leak into the export (#7806)').toBe(false)

      // A caller without scheduler.jobs.view is refused outright, not served a scoped-empty export.
      const forbiddenResponse = await apiRequest(
        request,
        'GET',
        `${SCHEDULER_JOBS_PATH}?format=json&exportScope=full`,
        { token: viewOnlyActor.token },
      )
      expect(forbiddenResponse.status(), 'full export must be refused without scheduler.jobs.view').toBe(403)
      const forbiddenBody = await readJsonSafe<{ error?: string; requiredFeatures?: string[] }>(forbiddenResponse)
      expect(forbiddenBody?.requiredFeatures ?? []).toContain('scheduler.jobs.view')
    } finally {
      await deleteScheduleJob(request, superadminToken, ownOrgJobId)
      await deleteScheduleJob(request, otherOrgActor?.token ?? superadminToken, otherOrgJobId)
      await deleteScheduleJob(request, foreignToken ?? superadminToken, foreignTenantJobId)

      await cleanupScopedActor(request, superadminToken, ownOrgActor)
      await cleanupScopedActor(request, superadminToken, otherOrgActor)
      await cleanupScopedActor(request, superadminToken, viewOnlyActor)
      await deleteUserIfExists(request, superadminToken, foreignUserId)
      await deleteRoleIfExists(request, superadminToken, foreignRoleId)

      await deleteOrganizationIfExists(request, superadminToken, secondOrgId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrgId)
      await deleteTenantIfExists(request, superadminToken, foreignTenantId)
    }
  })
})
