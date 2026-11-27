import { randomUUID } from 'node:crypto'
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
import { expectId, getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { acquireRecordLock, releaseRecordLock } from './helpers/recordLocks'

const RECORD_LOCK_FEATURES = [
  'record_locks.view',
  'record_locks.manage',
  'record_locks.force_release',
]

type RouteProbe = {
  name: string
  method: 'GET' | 'POST'
  path: string
  data?: Record<string, unknown>
}

const RESOURCE_KIND = 'customers.company'
const ALL_ORGANIZATIONS = '__all__'
const SETTINGS_PROBE: RouteProbe = { name: 'settings (GET)', method: 'GET', path: '/api/record_locks/settings' }

function buildRouteProbes(resourceId: string): RouteProbe[] {
  const resource = { resourceKind: RESOURCE_KIND, resourceId }
  return [
    { name: 'acquire', method: 'POST', path: '/api/record_locks/acquire', data: resource },
    { name: 'heartbeat', method: 'POST', path: '/api/record_locks/heartbeat', data: { ...resource, token: randomUUID() } },
    { name: 'release', method: 'POST', path: '/api/record_locks/release', data: { ...resource, token: randomUUID(), reason: 'cancelled' } },
    { name: 'validate', method: 'POST', path: '/api/record_locks/validate', data: { ...resource, method: 'PUT' } },
    { name: 'force-release', method: 'POST', path: '/api/record_locks/force-release', data: resource },
    SETTINGS_PROBE,
    { name: 'settings (POST)', method: 'POST', path: '/api/record_locks/settings', data: {} },
  ]
}

type ProbeResult = { status: number; body: string }

function selectedOrgHeaders(selectedOrgId: string | null): Record<string, string> | undefined {
  return selectedOrgId ? { Cookie: `om_selected_org=${selectedOrgId}` } : undefined
}

async function probe(
  request: APIRequestContext,
  token: string,
  route: RouteProbe,
  selectedOrgId: string | null = null,
): Promise<ProbeResult> {
  const response = await apiRequest(request, route.method, route.path, {
    token,
    headers: selectedOrgHeaders(selectedOrgId),
    ...(route.data === undefined ? {} : { data: route.data }),
  })
  return { status: response.status(), body: await response.text() }
}

type AcquiredLock = { resourceId: string; token: string; selectedOrgId: string | null }

/**
 * TC-LOCK-SCOPE-empty-org: record_locks routes fail closed on an explicitly
 * empty organization scope (#10448, follow-up of #10432).
 *
 * `resolveFeatureCheckContext()` returns `organizationId: null` both for an
 * unrestricted "All organizations" principal and for a principal whose
 * organization visibility list is explicitly empty. The record lock service
 * reads `null` as "all organizations" and widened action-log lookups to the
 * whole tenant, so an empty-scope caller holding `record_locks.view` received
 * other organizations' action-log ids. Every route now denies that caller with
 * 403 before any service call, while a single-organization caller and an
 * unrestricted "All organizations" caller keep working.
 *
 * The deny-all scope is built through public APIs only: the role stores
 * `organizations: []`, and soft-deleting the temporary home organization
 * removes the resolver's account-organization fallback before login. The
 * empty scope is probed both without a selection and with the "All
 * organizations" selection, which must not widen it. The unrestricted control
 * selects "All organizations" explicitly, which is the principal that
 * legitimately keeps `organizationId: null`.
 *
 * Self-contained: creates its own role, user, temporary home organization and
 * allowed organization; releases acquired locks and deletes the user, role and
 * allowed organization in `finally` (the home organization is soft-deleted as
 * part of the scenario).
 */
test.describe('TC-LOCK-SCOPE-empty-org: empty organization scope is denied', () => {
  test.describe.configure({ timeout: 120_000 })

  test('every record_locks route returns 403 for an empty scope and stays open for single-org and unrestricted scopes', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(superadminToken)
    expectId(tenantId, 'Superadmin token should carry the actor tenant')

    const stamp = randomUUID().slice(0, 8)
    const password = 'StrongSecret123!'
    const actorEmail = `qa-tc-lock-scope-${stamp}@example.com`
    let roleId: string | null = null
    let actorUserId: string | null = null
    let actorToken: string | null = null
    let allowedOrganizationId: string | null = null
    const acquiredLocks: AcquiredLock[] = []

    try {
      const homeOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-LOCK-SCOPE Temporary home ${stamp}`,
        tenantId,
      })
      allowedOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-LOCK-SCOPE Allowed ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-lock-scope-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: RECORD_LOCK_FEATURES,
        organizations: [],
      })
      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password,
        organizationId: homeOrganizationId,
        roles: [roleId],
        name: 'QA TC-LOCK-SCOPE Actor',
      })

      const removeHome = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(homeOrganizationId)}`,
        { token: superadminToken },
      )
      expect(removeHome.status(), 'Temporary home organization should be soft-deleted').toBe(200)

      actorToken = await getAuthToken(request, actorEmail, password)
      for (const selectedOrgId of [null, ALL_ORGANIZATIONS]) {
        for (const route of buildRouteProbes(randomUUID())) {
          const result = await probe(request, actorToken, route, selectedOrgId)
          const label = `${route.name} (selection: ${selectedOrgId ?? 'none'})`
          expect(result.status, `${label} must deny an explicitly empty organization scope`).toBe(403)
          expect(result.body, `${label} must not leak an action-log id`).not.toContain('latestActionLogId')
        }
      }

      const controls: Array<{ label: string; organizations: string[] | null; selectedOrgId: string | null }> = [
        { label: 'a single-organization', organizations: [allowedOrganizationId], selectedOrgId: null },
        { label: 'an unrestricted "All organizations"', organizations: null, selectedOrgId: ALL_ORGANIZATIONS },
      ]
      for (const control of controls) {
        await setRoleAclFeatures(request, superadminToken, {
          roleId,
          features: RECORD_LOCK_FEATURES,
          organizations: control.organizations,
        })

        const settings = await probe(request, actorToken, SETTINGS_PROBE, control.selectedOrgId)
        expect(settings.status, `${control.label} caller keeps settings access: ${settings.body}`).toBe(200)

        const resourceId = randomUUID()
        const acquire = await acquireRecordLock(
          request,
          actorToken,
          RESOURCE_KIND,
          resourceId,
          selectedOrgHeaders(control.selectedOrgId),
        )
        expect(acquire.status, `${control.label} caller is not denied by the scope guard`).not.toBe(403)
        expect(acquire.status, `${control.label} acquire must not error`).toBeLessThan(500)
        const lockToken = (acquire.body?.lock as { token?: string | null } | null | undefined)?.token ?? null
        if (lockToken) acquiredLocks.push({ resourceId, token: lockToken, selectedOrgId: control.selectedOrgId })
      }
    } finally {
      if (actorToken) {
        for (const lock of acquiredLocks) {
          await releaseRecordLock(
            request,
            actorToken,
            RESOURCE_KIND,
            lock.resourceId,
            lock.token,
            'cancelled',
            undefined,
            selectedOrgHeaders(lock.selectedOrgId),
          ).catch(() => undefined)
        }
      }
      await deleteUserIfExists(request, superadminToken, actorUserId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, allowedOrganizationId)
    }
  })
})
