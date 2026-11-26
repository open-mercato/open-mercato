import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  clearUserHomeOrganization,
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
  setUserAclInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'directory', 'entities'] }

/**
 * TC-ENTITIES-014: an empty organization scope cannot reach the tenant encryption map API.
 *
 * Boundary test for the real API dispatcher -> organization scope resolver -> rbacService
 * chain (none of them mocked). `GET`/`POST /api/entities/encryption` require
 * `entities.definitions.manage`; every user here holds `entities.*`, so the only thing that
 * can deny a request is the organization scope:
 *   - `organizations: []`            => explicitly restricted to zero organizations
 *   - `organizations: [softDeleted]` => a non-empty ACL list that resolves to zero organizations
 *   - `organizations: null`          => unrestricted (control: the feature grant itself works)
 *
 * Before the fix both deny shapes ran the feature check with `organizationId: null`, passed
 * it, and a POST then wrote a tenant-global (`organization_id IS NULL`) encryption map.
 *
 * The denials must come from the dispatcher's authorization gate, which is the only layer
 * that echoes `requiredFeatures` in its 403 body; the route handler's own guard answers a
 * bare `{ error }`.
 *
 * The JWT `orgId` is minted from `users.organization_id` at login, so the home organization
 * is cleared BEFORE login for the "floating" variants. Each deny shape also runs with the
 * home organization kept: it is outside the (empty) allowed set and must not rescue access.
 *
 * The per-user ACL rows are written straight to the database (the soft-deleted organization
 * cannot be expressed through the ACL API) before the user ever logs in, so no RBAC cache
 * entry exists for them yet.
 */

const REQUIRED_FEATURE = 'entities.definitions.manage'
const ENCRYPTION_PATH = '/api/entities/encryption'
const BASELINE_FIELDS = [{ field: 'baseline_secret' }]

type EncryptionMapRow = {
  id: string
  tenant_id: string | null
  organization_id: string | null
  fields_json: unknown
  is_active: boolean
  updated_at: string
  deleted_at: string | null
}

type ScopedUser = { userId: string; token: string }

type Cleanup = {
  adminToken: string | null
  userIds: string[]
  roleIds: string[]
  organizationIds: string[]
  entityIds: string[]
}

function createCleanup(): Cleanup {
  return { adminToken: null, userIds: [], roleIds: [], organizationIds: [], entityIds: [] }
}

function uniqueEntityId(): string {
  return `entities:tc_entities_013_${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function encryptionGetPath(entityId: string): string {
  return `${ENCRYPTION_PATH}?entityId=${encodeURIComponent(entityId)}`
}

function readTokenOrgId(token: string): string | null {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { orgId?: string | null }
  return payload.orgId ?? null
}

async function readEncryptionMapRows(entityId: string): Promise<EncryptionMapRow[]> {
  return withClient(async (client) => {
    const result = await client.query<EncryptionMapRow>(
      `select id::text as id,
              tenant_id::text as tenant_id,
              organization_id::text as organization_id,
              fields_json,
              is_active,
              updated_at::text as updated_at,
              deleted_at::text as deleted_at
         from encryption_maps
        where entity_id = $1
        order by id asc`,
      [entityId],
    )
    return result.rows
  })
}

async function deleteEncryptionMapRows(entityId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from encryption_maps where entity_id = $1', [entityId])
  })
}

async function softDeleteOrganizationInDb(organizationId: string): Promise<void> {
  await withClient(async (client) => {
    const result = await client.query(
      'update organizations set deleted_at = now(), is_active = false where id = $1 and deleted_at is null',
      [organizationId],
    )
    expect(result.rowCount, 'the test organization should be soft-deleted exactly once').toBe(1)
  })
}

async function seedBaselineMap(
  request: APIRequestContext,
  adminToken: string,
  cleanup: Cleanup,
): Promise<{ entityId: string; rows: EncryptionMapRow[] }> {
  const entityId = uniqueEntityId()
  cleanup.entityIds.push(entityId)
  const response = await apiRequest(request, 'POST', ENCRYPTION_PATH, {
    token: adminToken,
    data: { entityId, fields: BASELINE_FIELDS, isActive: true },
  })
  expect(response.status(), 'admin should be able to seed the baseline encryption map').toBe(200)
  const rows = await readEncryptionMapRows(entityId)
  expect(rows, 'the baseline encryption map should be exactly one row').toHaveLength(1)
  expect(rows[0].fields_json).toEqual(BASELINE_FIELDS)
  return { entityId, rows }
}

async function createScopedUser(
  request: APIRequestContext,
  adminToken: string,
  cleanup: Cleanup,
  input: { label: string; organizations: string[] | null; keepHomeOrganization: boolean },
): Promise<ScopedUser> {
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const stamp = randomUUID()
  const email = `tc-entities-013-${input.label}-${stamp}@example.com`
  const password = `Aa1!${randomBytes(20).toString('hex')}`

  const roleId = await createRoleFixture(request, adminToken, { name: `TC-ENTITIES-014 ${input.label} ${stamp}` })
  cleanup.roleIds.push(roleId)
  const userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
  cleanup.userIds.push(userId)

  await setUserAclInDb({ userId, tenantId, features: ['entities.*'], organizations: input.organizations })
  if (!input.keepHomeOrganization) await clearUserHomeOrganization(userId)

  const token = await getAuthToken(request, email, password)
  expect(
    readTokenOrgId(token),
    input.keepHomeOrganization
      ? 'the user should keep the home organization in the JWT'
      : 'the floating user should have no home organization in the JWT',
  ).toBe(input.keepHomeOrganization ? organizationId : null)
  return { userId, token }
}

async function expectDeniedByDispatcher(
  request: APIRequestContext,
  userToken: string,
  entityId: string,
): Promise<void> {
  const getResponse = await apiRequest(request, 'GET', encryptionGetPath(entityId), { token: userToken })
  const getBody = await readJsonSafe<Record<string, unknown>>(getResponse)
  expect(getResponse.status(), 'GET must be forbidden for an empty organization scope').toBe(403)
  expect(getBody?.requiredFeatures, 'GET must be denied by the dispatcher authorization gate').toEqual([REQUIRED_FEATURE])
  expect(getBody, 'a denied GET must not leak the encryption map').not.toHaveProperty('fields')

  const postResponse = await apiRequest(request, 'POST', ENCRYPTION_PATH, {
    token: userToken,
    data: { entityId, fields: [{ field: 'leaked_secret' }], isActive: false },
  })
  const postBody = await readJsonSafe<Record<string, unknown>>(postResponse)
  expect(postResponse.status(), 'POST must be forbidden for an empty organization scope').toBe(403)
  expect(postBody?.requiredFeatures, 'POST must be denied by the dispatcher authorization gate').toEqual([REQUIRED_FEATURE])
}

async function expectMapUnchanged(
  request: APIRequestContext,
  adminToken: string,
  baseline: { entityId: string; rows: EncryptionMapRow[] },
): Promise<void> {
  expect(
    await readEncryptionMapRows(baseline.entityId),
    'denied requests must not create, change or delete any encryption map row',
  ).toEqual(baseline.rows)

  const adminRead = await apiRequest(request, 'GET', encryptionGetPath(baseline.entityId), { token: adminToken })
  expect(adminRead.status()).toBe(200)
  const adminBody = await readJsonSafe<{ fields?: unknown; isActive?: boolean }>(adminRead)
  expect(adminBody?.fields, 'admin should still read the baseline map').toMatchObject(BASELINE_FIELDS)
  expect(adminBody?.isActive).toBe(true)
}

async function runCleanup(request: APIRequestContext, cleanup: Cleanup): Promise<void> {
  for (const userId of cleanup.userIds) {
    await deleteUserAclInDb(userId).catch(() => undefined)
    await deleteUserIfExists(request, cleanup.adminToken, userId)
  }
  for (const roleId of cleanup.roleIds) await deleteRoleIfExists(request, cleanup.adminToken, roleId)
  for (const entityId of cleanup.entityIds) await deleteEncryptionMapRows(entityId).catch(() => undefined)
  for (const organizationId of cleanup.organizationIds) await deleteOrganizationInDb(organizationId).catch(() => undefined)
}

test.describe('TC-ENTITIES-014: an empty organization scope cannot reach the encryption map API', () => {
  for (const keepHomeOrganization of [false, true]) {
    const variant = keepHomeOrganization ? 'with a home organization outside the scope' : 'without a home organization'

    test(`a user restricted to zero organizations is denied GET and POST ${variant}`, async ({ request }) => {
      const cleanup = createCleanup()
      try {
        const adminToken = await getAuthToken(request, 'admin')
        cleanup.adminToken = adminToken
        const baseline = await seedBaselineMap(request, adminToken, cleanup)
        const user = await createScopedUser(request, adminToken, cleanup, {
          label: 'deny-all',
          organizations: [],
          keepHomeOrganization,
        })

        await expectDeniedByDispatcher(request, user.token, baseline.entityId)
        await expectMapUnchanged(request, adminToken, baseline)
      } finally {
        await runCleanup(request, cleanup)
      }
    })

    test(`a user whose only allowed organization was soft-deleted is denied GET and POST ${variant}`, async ({ request }) => {
      const cleanup = createCleanup()
      try {
        const adminToken = await getAuthToken(request, 'admin')
        cleanup.adminToken = adminToken
        const { tenantId } = getTokenContext(adminToken)
        const baseline = await seedBaselineMap(request, adminToken, cleanup)

        const staleOrganizationId = await createOrganizationInDb({
          name: `TC-ENTITIES-014 stale org ${randomUUID()}`,
          tenantId,
        })
        cleanup.organizationIds.push(staleOrganizationId)
        await softDeleteOrganizationInDb(staleOrganizationId)

        const user = await createScopedUser(request, adminToken, cleanup, {
          label: 'stale-org',
          organizations: [staleOrganizationId],
          keepHomeOrganization,
        })

        await expectDeniedByDispatcher(request, user.token, baseline.entityId)
        await expectMapUnchanged(request, adminToken, baseline)
      } finally {
        await runCleanup(request, cleanup)
      }
    })
  }

  test('control: the same feature grant with an unrestricted organization scope reads the map', async ({ request }) => {
    const cleanup = createCleanup()
    try {
      const adminToken = await getAuthToken(request, 'admin')
      cleanup.adminToken = adminToken
      const baseline = await seedBaselineMap(request, adminToken, cleanup)
      const user = await createScopedUser(request, adminToken, cleanup, {
        label: 'control',
        organizations: null,
        keepHomeOrganization: true,
      })

      const response = await apiRequest(request, 'GET', encryptionGetPath(baseline.entityId), { token: user.token })
      expect(response.status(), 'an unrestricted user holding entities.* must read the map').toBe(200)
      const body = await readJsonSafe<{ entityId?: string; fields?: unknown }>(response)
      expect(body?.entityId).toBe(baseline.entityId)
      expect(body?.fields).toMatchObject(BASELINE_FIELDS)
    } finally {
      await runCleanup(request, cleanup)
    }
  })
})
