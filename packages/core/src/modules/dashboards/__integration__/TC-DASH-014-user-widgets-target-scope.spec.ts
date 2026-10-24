import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-DASH-014 — a user's dashboard widget override is stored under that user's own tenant and
 * organization, not under the scope of the admin who saved it.
 *
 * `PUT /api/dashboards/users/widgets` used to key the override by the caller's session scope. When
 * an admin edited a same-tenant user who belongs to another organization the call answered 200,
 * but the row landed under the admin's organization, so the target's own dashboard never saw it.
 * Keying the row by the target also means organization visibility must gate the assignment: an
 * assigner restricted to some organizations gets 403 for users outside them.
 */

type DashboardLayoutState = {
  allowedWidgetIds?: string[]
  context?: { organizationId?: string | null }
}

type WidgetAssignmentResponse = {
  mode?: 'inherit' | 'override'
  widgetIds?: string[]
  hasCustom?: boolean
  scope?: { tenantId?: string | null; organizationId?: string | null }
}

type Actor = { roleId: string | null; userId: string | null; token: string }

const BASE_DASHBOARD_FEATURES = [
  'dashboards.view',
  'analytics.view',
  'sales.orders.view',
  'customers.view',
  'customers.people.view',
  'customers.deals.view',
  'catalog.view',
]

const ASSIGN_WIDGETS_FEATURES = [...BASE_DASHBOARD_FEATURES, 'dashboards.admin.assign-widgets']

const API = {
  layout: '/api/dashboards/layout',
  userWidgets: '/api/dashboards/users/widgets',
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`
}

async function createActor(
  request: APIRequestContext,
  input: { superadminToken: string; tenantId: string; organizationId: string; prefix: string; features: string[] },
): Promise<Actor> {
  const id = uniqueId(input.prefix)
  const roleName = `qa_dash_${id.replace(/-/g, '_')}`
  const email = `${id}@dashboards.example.com`
  const password = 'Valid1!Pass'
  const actor: Actor = { roleId: null, userId: null, token: '' }
  actor.roleId = await createRoleFixture(request, input.superadminToken, { name: roleName, tenantId: input.tenantId })
  await setRoleAclFeatures(request, input.superadminToken, {
    roleId: actor.roleId,
    features: input.features,
    organizations: null,
  })
  actor.userId = await createUserFixture(request, input.superadminToken, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [roleName],
    name: `QA Dash ${input.prefix}`,
  })
  actor.token = await getAuthToken(request, email, password)
  return actor
}

async function cleanupActor(request: APIRequestContext, superadminToken: string | null, actor: Actor | null): Promise<void> {
  if (!actor) return
  await deleteUserIfExists(request, superadminToken, actor.userId)
  await deleteRoleIfExists(request, superadminToken, actor.roleId)
}

async function readLayout(request: APIRequestContext, token: string): Promise<DashboardLayoutState> {
  const response = await apiRequest(request, 'GET', API.layout, { token })
  expect(response.status(), 'GET /api/dashboards/layout should return 200').toBe(200)
  return (await readJsonSafe<DashboardLayoutState>(response)) ?? {}
}

test.describe('TC-DASH-014: user widget overrides follow the target user scope', () => {
  test('TC-DASH-014-1: an assigner override for a user in another organization reaches that user dashboard', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let targetOrgId: string | null = null
    let target: Actor | null = null
    let assigner: Actor | null = null

    try {
      targetOrgId = await createOrganizationFixture(request, superadminToken, {
        name: uniqueId('QA TC-DASH-014 org'),
        tenantId: scope.tenantId,
      })
      expect(targetOrgId).not.toBe(scope.organizationId)
      target = await createActor(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: targetOrgId,
        prefix: 'tc-dash-014-target',
        features: BASE_DASHBOARD_FEATURES,
      })
      assigner = await createActor(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-dash-014-admin',
        features: ASSIGN_WIDGETS_FEATURES,
      })
      const assignerToken = assigner.token

      const initial = await readLayout(request, target.token)
      expect(initial.context?.organizationId).toBe(targetOrgId)
      const initialWidgetIds = initial.allowedWidgetIds ?? []
      expect(initialWidgetIds.length, 'target needs at least two widgets to observe an override').toBeGreaterThanOrEqual(2)
      const [chosenWidgetId] = initialWidgetIds

      const putResponse = await apiRequest(request, 'PUT', API.userWidgets, {
        token: assignerToken,
        data: { userId: target.userId, mode: 'override', widgetIds: [chosenWidgetId] },
      })
      expect(putResponse.status()).toBe(200)

      const overridden = await readLayout(request, target.token)
      expect(overridden.allowedWidgetIds).toEqual([chosenWidgetId])

      const assignmentResponse = await apiRequest(
        request,
        'GET',
        `${API.userWidgets}?userId=${encodeURIComponent(target.userId ?? '')}`,
        { token: assignerToken },
      )
      const assignment = await readJsonSafe<WidgetAssignmentResponse>(assignmentResponse)
      expect(assignmentResponse.status()).toBe(200)
      expect(assignment?.hasCustom).toBe(true)
      expect(assignment?.widgetIds).toEqual([chosenWidgetId])
      expect(assignment?.scope).toEqual({ tenantId: scope.tenantId, organizationId: targetOrgId })

      const inheritResponse = await apiRequest(request, 'PUT', API.userWidgets, {
        token: assignerToken,
        data: { userId: target.userId, mode: 'inherit', widgetIds: [] },
      })
      expect(inheritResponse.status()).toBe(200)

      const restored = await readLayout(request, target.token)
      expect(restored.allowedWidgetIds).toEqual(initialWidgetIds)
    } finally {
      if (target?.userId) {
        await apiRequest(request, 'PUT', API.userWidgets, {
          token: adminToken,
          data: { userId: target.userId, mode: 'inherit', widgetIds: [] },
        }).catch(() => undefined)
      }
      await cleanupActor(request, superadminToken, assigner)
      await cleanupActor(request, superadminToken, target)
      await deleteOrganizationIfExists(request, superadminToken, targetOrgId)
    }
  })

  test('TC-DASH-014-2: an assigner restricted to its own organization cannot manage users in another one', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let targetOrgId: string | null = null
    let target: Actor | null = null
    let assigner: Actor | null = null

    try {
      targetOrgId = await createOrganizationFixture(request, superadminToken, {
        name: uniqueId('QA TC-DASH-014 hidden org'),
        tenantId: scope.tenantId,
      })
      target = await createActor(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: targetOrgId,
        prefix: 'tc-dash-014-hidden',
        features: BASE_DASHBOARD_FEATURES,
      })
      assigner = await createActor(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-dash-014-assigner',
        features: ASSIGN_WIDGETS_FEATURES,
      })
      await setUserAclVisibility(request, superadminToken, {
        userId: assigner.userId ?? '',
        organizations: [scope.organizationId],
        features: ASSIGN_WIDGETS_FEATURES,
      })

      const before = await readLayout(request, target.token)
      const beforeWidgetIds = before.allowedWidgetIds ?? []
      expect(beforeWidgetIds.length).toBeGreaterThanOrEqual(2)

      const putResponse = await apiRequest(request, 'PUT', API.userWidgets, {
        token: assigner.token,
        data: { userId: target.userId, mode: 'override', widgetIds: [beforeWidgetIds[0]] },
      })
      expect(putResponse.status()).toBe(403)

      const getResponse = await apiRequest(
        request,
        'GET',
        `${API.userWidgets}?userId=${encodeURIComponent(target.userId ?? '')}`,
        { token: assigner.token },
      )
      expect(getResponse.status()).toBe(403)

      const after = await readLayout(request, target.token)
      expect(after.allowedWidgetIds).toEqual(beforeWidgetIds)
    } finally {
      if (target?.userId) {
        await apiRequest(request, 'PUT', API.userWidgets, {
          token: adminToken,
          data: { userId: target.userId, mode: 'inherit', widgetIds: [] },
        }).catch(() => undefined)
      }
      await cleanupActor(request, superadminToken, assigner)
      await cleanupActor(request, superadminToken, target)
      await deleteOrganizationIfExists(request, superadminToken, targetOrgId)
    }
  })
})
