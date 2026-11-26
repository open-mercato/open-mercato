import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  clearUserHomeOrganization,
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['staff', 'auth', 'api_keys', 'dashboards', 'directory'] }

/**
 * TC-STAFF-10188: staff self-scope through the real time-entry and widget routes.
 *
 * Issue #10188: a caller with no organization in scope (an API key created for all
 * organizations) reached the staff self-scope interceptors with an empty
 * organization id and an `api_key:<id>` subject, and both routes failed with 500.
 * The review of the fix asked for the self-scope to be proven through real
 * database queries, including a user who is staff in two organizations:
 *
 * - an all-organizations API key without `staff.timesheets.manage_all` is refused
 *   with 403 on both routes, never 500;
 * - an API key with `staff.timesheets.manage_all` is not narrowed;
 * - a user who is staff in two organizations only ever sees their own entries: the
 *   one organization's entries when it is selected, both organizations' entries in
 *   the widget when none is, and a refusal (not an arbitrary membership) on the
 *   single-organization time-entry list when none is selected;
 * - an isolated staff member sees only their own entry, even when the request asks
 *   for someone else's staff member.
 *
 * Self-contained: the second organization, the roles, users, API keys, staff
 * members and entries are created here and removed in `finally`. The spec uses DB
 * fixtures (a second organization, a floating user), so it must run against an
 * app that shares the database Playwright resolves from `DATABASE_URL`.
 */

const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const MEMBERS_PATH = '/api/staff/team-members'
const WIDGET_DATA_PATH = '/api/dashboards/widgets/data'
const API_KEYS_PATH = '/api/api_keys/keys'
const AMBIGUOUS_MESSAGE = 'Select a single organization to view your own time entries.'
const NOT_STAFF_MESSAGE = 'User is not a staff member.'

type Credential = { kind: 'bearer'; token: string } | { kind: 'apiKey'; secret: string }

function buildHeaders(credential: Credential, selectedOrgId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (credential.kind === 'bearer') headers.Authorization = `Bearer ${credential.token}`
  else headers['x-api-key'] = credential.secret
  if (selectedOrgId) headers.Cookie = `om_selected_org=${selectedOrgId}`
  return headers
}

async function call(
  request: APIRequestContext,
  credential: Credential,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: { data?: unknown; selectedOrgId?: string } = {},
) {
  return request.fetch(path, { method, headers: buildHeaders(credential, options.selectedOrgId), data: options.data })
}

async function listEntryIds(
  request: APIRequestContext,
  credential: Credential,
  entryIds: string[],
  options: { selectedOrgId?: string; staffMemberId?: string } = {},
): Promise<{ status: number; ids: string[]; body: Record<string, unknown> | null }> {
  const query = new URLSearchParams({ ids: entryIds.join(','), pageSize: '50' })
  if (options.staffMemberId) query.set('staffMemberId', options.staffMemberId)
  const response = await call(request, credential, 'GET', `${ENTRIES_PATH}?${query}`, { selectedOrgId: options.selectedOrgId })
  const body = await readJsonSafe<Record<string, unknown>>(response)
  const items = Array.isArray(body?.items) ? (body?.items as Array<{ id?: string }>) : []
  return { status: response.status(), ids: items.map((item) => String(item.id)).sort(), body }
}

async function countWidgetEntries(
  request: APIRequestContext,
  credential: Credential,
  entryIds: string[],
  options: { selectedOrgId?: string; forgedStaffMemberId?: string } = {},
): Promise<{ status: number; value: number | null; body: Record<string, unknown> | null }> {
  const filters: Array<Record<string, unknown>> = [{ field: 'id', operator: 'in', value: entryIds }]
  if (options.forgedStaffMemberId) {
    filters.push({ field: 'staffMemberId', operator: 'eq', value: options.forgedStaffMemberId })
  }
  const response = await call(request, credential, 'POST', WIDGET_DATA_PATH, {
    selectedOrgId: options.selectedOrgId,
    data: { entityType: 'staff:staff_time_entries', metric: { field: 'id', aggregate: 'count' }, filters },
  })
  const body = await readJsonSafe<Record<string, unknown>>(response)
  const value = typeof body?.value === 'number' ? body.value : null
  return { status: response.status(), value, body }
}

test.describe('TC-STAFF-10188: staff self-scope without a single organization', () => {
  test('denies org-less API keys, keeps manage_all and never shows another member\'s entries', async ({ request }) => {
    test.slow()
    const stamp = randomUUID().slice(0, 8)
    const password = `QA-${randomUUID()}!aA1`
    const adminToken = await getAuthToken(request, 'admin')
    const admin: Credential = { kind: 'bearer', token: adminToken }
    const { tenantId, organizationId: homeOrgId } = getTokenContext(adminToken)

    let secondOrgId: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []
    const apiKeyIds: string[] = []
    const createdEntries: Array<{ id: string; orgId: string }> = []
    const createdMembers: Array<{ id: string; orgId: string }> = []

    const createMember = async (orgId: string, displayName: string, userId: string): Promise<string> => {
      const response = await call(request, admin, 'POST', MEMBERS_PATH, {
        selectedOrgId: orgId,
        data: { displayName, userId },
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      expect(response.status(), `POST ${MEMBERS_PATH} in ${orgId} should create the member: ${JSON.stringify(body)}`).toBe(201)
      const id = expectId(body?.id, 'member id')
      createdMembers.push({ id, orgId })
      return id
    }

    const createEntry = async (orgId: string, staffMemberId: string, date: string): Promise<string> => {
      const response = await call(request, admin, 'POST', ENTRIES_PATH, {
        selectedOrgId: orgId,
        data: { staffMemberId, date, durationMinutes: 30, source: 'manual', notes: `QA10188 ${stamp}` },
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      expect(response.status(), `POST ${ENTRIES_PATH} in ${orgId} should create the entry: ${JSON.stringify(body)}`).toBe(201)
      const id = expectId(body?.id, 'entry id')
      createdEntries.push({ id, orgId })
      return id
    }

    const createRoleWith = async (provision: APIRequestContext, token: string, name: string, features: string[]) => {
      const roleId = await createRoleFixture(provision, token, { name: `${name}-${stamp}`, tenantId })
      roleIds.push(roleId)
      await setRoleAclFeatures(provision, token, { roleId, features, organizations: null })
      return roleId
    }

    const createApiKey = async (name: string, roleId: string, organizationId: string | null): Promise<string> => {
      const response = await call(request, admin, 'POST', API_KEYS_PATH, {
        data: { name: `${name} ${stamp}`, roles: [roleId], organizationId },
      })
      const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
      expect(response.status(), `POST ${API_KEYS_PATH} should create ${name}: ${JSON.stringify(body)}`).toBe(201)
      apiKeyIds.push(expectId(body?.id, 'api key id'))
      expect(typeof body?.secret === 'string' && body.secret.length > 0, 'api key secret').toBe(true)
      return body?.secret as string
    }

    try {
      secondOrgId = await createOrganizationInDb({ name: `QA10188 second org ${stamp}`, tenantId })
      const secondOrg = secondOrgId

      const selfScopeFeatures = ['staff.timesheets.view', 'staff.timesheets.manage_own', 'analytics.view']
      const { multiOrgUserId, isolatedUserId, selfRoleId, viewKeyRoleId, manageAllRoleId } =
        await withCredentialIsolatedRequest(async (provision) => {
          const superadminToken = await getAuthToken(provision, 'superadmin')
          const selfRole = await createRoleWith(provision, superadminToken, 'qa-10188-self', selfScopeFeatures)
          const viewKeyRole = await createRoleWith(provision, superadminToken, 'qa-10188-key-view', [
            'staff.timesheets.view',
            'analytics.view',
          ])
          const manageAllRole = await createRoleWith(provision, superadminToken, 'qa-10188-key-manage-all', [
            'staff.timesheets.view',
            'staff.timesheets.manage_all',
            'staff.timesheets.projects.manage',
            'analytics.view',
          ])
          const multiOrgUser = await createUserFixture(provision, superadminToken, {
            email: `qa-10188-multi-${stamp}@example.com`, password, organizationId: homeOrgId, roles: [selfRole],
          })
          userIds.push(multiOrgUser)
          const isolatedUser = await createUserFixture(provision, superadminToken, {
            email: `qa-10188-isolated-${stamp}@example.com`, password, organizationId: homeOrgId, roles: [selfRole],
          })
          userIds.push(isolatedUser)
          return {
            multiOrgUserId: multiOrgUser,
            isolatedUserId: isolatedUser,
            selfRoleId: selfRole,
            viewKeyRoleId: viewKeyRole,
            manageAllRoleId: manageAllRole,
          }
        })
      expect(selfRoleId).toBeTruthy()
      // `ensureUserExists` only links a user to a staff member in their home organization, so a
      // user who is staff in two organizations is one without a home organization. The JWT
      // `orgId` is minted from `users.organization_id` at login, so this runs before login.
      await clearUserHomeOrganization(multiOrgUserId)

      const memberHome = await createMember(homeOrgId, `QA10188 multi home ${stamp}`, multiOrgUserId)
      const memberSecond = await createMember(secondOrg, `QA10188 multi second ${stamp}`, multiOrgUserId)
      const memberIsolated = await createMember(homeOrgId, `QA10188 isolated ${stamp}`, isolatedUserId)

      const entryHome = await createEntry(homeOrgId, memberHome, '2031-03-03')
      const entrySecond = await createEntry(secondOrg, memberSecond, '2031-03-04')
      const entryIsolated = await createEntry(homeOrgId, memberIsolated, '2031-03-05')
      const allEntries = [entryHome, entrySecond, entryIsolated]

      const orglessViewKey: Credential = { kind: 'apiKey', secret: await createApiKey('QA10188 org-less view key', viewKeyRoleId, null) }
      const orglessManageAllKey: Credential = { kind: 'apiKey', secret: await createApiKey('QA10188 org-less manage-all key', manageAllRoleId, null) }
      const homeManageAllKey: Credential = { kind: 'apiKey', secret: await createApiKey('QA10188 home manage-all key', manageAllRoleId, homeOrgId) }

      await withCredentialIsolatedRequest(async (keyRequest) => {
        const deniedList = await listEntryIds(keyRequest, orglessViewKey, allEntries)
        expect(deniedList.status, `org-less key list: ${JSON.stringify(deniedList.body)}`).toBe(403)
        expect(deniedList.body).toMatchObject({ error: NOT_STAFF_MESSAGE })

        const deniedWidget = await countWidgetEntries(keyRequest, orglessViewKey, allEntries)
        expect(deniedWidget.status, `org-less key widget: ${JSON.stringify(deniedWidget.body)}`).toBe(403)
        expect(deniedWidget.body).toMatchObject({ error: NOT_STAFF_MESSAGE })

        // The time-entry list answers for one organization, so an org-less manager gets an
        // empty 200 there; the widget aggregates tenant-wide and shows every fixture entry.
        const orglessManageAllList = await listEntryIds(keyRequest, orglessManageAllKey, allEntries)
        expect(orglessManageAllList.status, `org-less manage_all list: ${JSON.stringify(orglessManageAllList.body)}`).toBe(200)
        const orglessManageAllWidget = await countWidgetEntries(keyRequest, orglessManageAllKey, allEntries)
        expect(orglessManageAllWidget.status, `org-less manage_all widget: ${JSON.stringify(orglessManageAllWidget.body)}`).toBe(200)
        expect(orglessManageAllWidget.value, 'manage_all is not narrowed to one staff member').toBe(3)

        const homeManageAllList = await listEntryIds(keyRequest, homeManageAllKey, allEntries)
        expect(homeManageAllList.status, `home manage_all list: ${JSON.stringify(homeManageAllList.body)}`).toBe(200)
        expect(homeManageAllList.ids).toEqual([entryHome, entryIsolated].sort())
        const homeManageAllWidget = await countWidgetEntries(keyRequest, homeManageAllKey, allEntries)
        expect(homeManageAllWidget.status).toBe(200)
        expect(homeManageAllWidget.value).toBe(2)
      })

      await withCredentialIsolatedRequest(async (userRequest) => {
        const multiOrg: Credential = {
          kind: 'bearer',
          token: await getAuthToken(userRequest, `qa-10188-multi-${stamp}@example.com`, password),
        }

        const noOrgList = await listEntryIds(userRequest, multiOrg, allEntries)
        expect(noOrgList.status, `multi-org user, no organization: ${JSON.stringify(noOrgList.body)}`).toBe(403)
        expect(noOrgList.body).toMatchObject({ error: AMBIGUOUS_MESSAGE })

        const noOrgWidget = await countWidgetEntries(userRequest, multiOrg, allEntries)
        expect(noOrgWidget.status, `multi-org widget, no organization: ${JSON.stringify(noOrgWidget.body)}`).toBe(200)
        expect(noOrgWidget.value, 'both own entries, never the isolated member\'s').toBe(2)

        const forgedWidget = await countWidgetEntries(userRequest, multiOrg, allEntries, { forgedStaffMemberId: memberIsolated })
        expect(forgedWidget.status).toBe(200)
        expect(forgedWidget.value, 'a forged staffMemberId filter is replaced by the caller\'s own').toBe(2)

        const homeList = await listEntryIds(userRequest, multiOrg, allEntries, { selectedOrgId: homeOrgId })
        expect(homeList.status, `multi-org user, home selected: ${JSON.stringify(homeList.body)}`).toBe(200)
        expect(homeList.ids).toEqual([entryHome])

        const secondList = await listEntryIds(userRequest, multiOrg, allEntries, {
          selectedOrgId: secondOrg,
          staffMemberId: memberHome,
        })
        expect(secondList.status, `multi-org user, second selected: ${JSON.stringify(secondList.body)}`).toBe(200)
        expect(secondList.ids).toEqual([entrySecond])

        const secondWidget = await countWidgetEntries(userRequest, multiOrg, allEntries, { selectedOrgId: secondOrg })
        expect(secondWidget.status).toBe(200)
        expect(secondWidget.value).toBe(1)
      })

      await withCredentialIsolatedRequest(async (userRequest) => {
        const isolated: Credential = {
          kind: 'bearer',
          token: await getAuthToken(userRequest, `qa-10188-isolated-${stamp}@example.com`, password),
        }

        const ownList = await listEntryIds(userRequest, isolated, allEntries, { staffMemberId: memberHome })
        expect(ownList.status, `isolated member list: ${JSON.stringify(ownList.body)}`).toBe(200)
        expect(ownList.ids).toEqual([entryIsolated])

        const ownWidget = await countWidgetEntries(userRequest, isolated, allEntries, { forgedStaffMemberId: memberHome })
        expect(ownWidget.status, `isolated member widget: ${JSON.stringify(ownWidget.body)}`).toBe(200)
        expect(ownWidget.value).toBe(1)
      })
    } finally {
      for (const entry of createdEntries) {
        await call(request, admin, 'DELETE', `${ENTRIES_PATH}?id=${encodeURIComponent(entry.id)}`, {
          selectedOrgId: entry.orgId,
        }).catch(() => undefined)
      }
      for (const member of createdMembers) {
        await call(request, admin, 'DELETE', `${MEMBERS_PATH}?id=${encodeURIComponent(member.id)}`, {
          selectedOrgId: member.orgId,
        }).catch(() => undefined)
      }
      for (const apiKeyId of apiKeyIds) {
        await apiRequest(request, 'DELETE', `${API_KEYS_PATH}?id=${encodeURIComponent(apiKeyId)}`, { token: adminToken })
          .catch(() => undefined)
      }
      await withCredentialIsolatedRequest(async (cleanup) => {
        const superadminToken = await getAuthToken(cleanup, 'superadmin').catch(() => null)
        for (const userId of userIds) await deleteUserIfExists(cleanup, superadminToken, userId)
        for (const roleId of roleIds) await deleteRoleIfExists(cleanup, superadminToken, roleId)
      })
      await deleteOrganizationInDb(secondOrgId).catch(() => undefined)
    }
  })
})
