import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type DashboardSize = 'sm' | 'md' | 'lg'

type DashboardLayoutItem = {
  id: string
  widgetId: string
  order: number
  priority?: number
  size?: DashboardSize
  settings?: unknown
}

type DashboardLayoutState = {
  layout?: { items?: DashboardLayoutItem[] }
  allowedWidgetIds?: string[]
  canConfigure?: boolean
  context?: {
    userId?: string
    tenantId?: string | null
    organizationId?: string | null
    userLabel?: string | null
  }
  widgets?: Array<{
    id?: string
    title?: string
    defaultSize?: string
    defaultEnabled?: boolean
  }>
}

type WidgetAssignmentResponse = {
  widgetIds?: string[]
  hasCustom?: boolean
  mode?: 'inherit' | 'override'
  effectiveWidgetIds?: string[]
  scope?: {
    tenantId?: string | null
    organizationId?: string | null
  }
}

type TestActor = {
  roleId: string | null
  userId: string | null
  token: string
}

const BASE_DASHBOARD_FEATURES = [
  'dashboards.view',
  'analytics.view',
  'sales.orders.view',
  'customers.view',
  'customers.people.view',
  'customers.deals.view',
  'catalog.view',
]

const CONFIGURE_FEATURES = [...BASE_DASHBOARD_FEATURES, 'dashboards.configure']
const ASSIGN_WIDGETS_FEATURES = [...BASE_DASHBOARD_FEATURES, 'dashboards.admin.assign-widgets']

const API = {
  layout: '/api/dashboards/layout',
  roleWidgets: '/api/dashboards/roles/widgets',
  userWidgets: '/api/dashboards/users/widgets',
  widgetData: '/api/dashboards/widgets/data',
  widgetDataBatch: '/api/dashboards/widgets/data/batch',
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`
}

async function createActorWithFeatures(
  request: APIRequestContext,
  input: {
    superadminToken: string
    scope: { tenantId: string; organizationId: string }
    prefix: string
    features: string[]
  },
): Promise<TestActor> {
  const id = uniqueId(input.prefix)
  const roleName = `qa_dash_${id.replace(/-/g, '_')}`
  const email = `${id}@dashboards.example.com`
  const password = 'Valid1!Pass'

  const roleId = await createRoleFixture(request, input.superadminToken, {
    name: roleName,
    tenantId: input.scope.tenantId,
  })
  await setRoleAclFeatures(request, input.superadminToken, {
    roleId,
    features: input.features,
    organizations: null,
  })

  const userId = await createUserFixture(request, input.superadminToken, {
    email,
    password,
    organizationId: input.scope.organizationId,
    roles: [roleName],
    name: `QA Dash ${input.prefix}`,
  })

  const token = await getAuthToken(request, email, password)
  return { roleId, userId, token }
}

async function cleanupActor(request: APIRequestContext, superadminToken: string | null, actor: TestActor | null): Promise<void> {
  if (!actor) return
  await deleteUserIfExists(request, superadminToken, actor.userId)
  await deleteRoleIfExists(request, superadminToken, actor.roleId)
}

async function readLayout(request: APIRequestContext, token: string): Promise<DashboardLayoutState> {
  const response = await apiRequest(request, 'GET', API.layout, { token })
  const body = await readJsonSafe<DashboardLayoutState>(response)
  expect(response.status(), 'GET /api/dashboards/layout should return 200').toBe(200)
  expect(body, 'GET /api/dashboards/layout should return JSON').toBeTruthy()
  return body as DashboardLayoutState
}

function expectWidgetIds(state: DashboardLayoutState, minimum = 1): string[] {
  const widgetIds = Array.isArray(state.allowedWidgetIds) ? state.allowedWidgetIds : []
  expect(widgetIds.length, 'dashboard should expose allowed widgets for the fixture role').toBeGreaterThanOrEqual(minimum)
  return widgetIds
}

function makeLayoutItems(widgetIds: string[]): DashboardLayoutItem[] {
  return widgetIds.slice(0, 3).map((widgetId, index) => ({
    id: randomUUID(),
    widgetId,
    order: index,
    priority: index,
    size: (index === 0 ? 'sm' : index === 1 ? 'md' : 'lg') as DashboardSize,
    settings: { slot: index },
  }))
}

test.describe('TC-DASH-001..008: Dashboard API integration coverage', () => {
  test('TC-DASH-001: GET /api/dashboards/layout initializes and returns the current user dashboard state', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let actor: TestActor | null = null

    try {
      actor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-001',
        features: BASE_DASHBOARD_FEATURES,
      })

      const state = await readLayout(request, actor.token)
      const widgetIds = expectWidgetIds(state)

      expect(Array.isArray(state.layout?.items), 'layout.items should be an array').toBe(true)
      expect(state.canConfigure, 'view-only actor should not be allowed to configure the dashboard').toBe(false)
      expect(state.context?.userId).toBe(actor.userId)
      expect(state.context?.tenantId).toBe(scope.tenantId)
      expect(state.context?.organizationId).toBe(scope.organizationId)
      expect(typeof state.context?.userLabel).toBe('string')
      expect(Array.isArray(state.widgets), 'widgets should be an array').toBe(true)
      expect(state.widgets?.length).toBe(widgetIds.length)
      expect(state.widgets?.[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          defaultSize: expect.any(String),
          defaultEnabled: expect.any(Boolean),
        }),
      )
    } finally {
      await cleanupActor(request, superadminToken, actor)
    }
  })

  test('TC-DASH-002: PUT /api/dashboards/layout persists widget ordering and sizes', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let actor: TestActor | null = null

    try {
      actor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-002',
        features: CONFIGURE_FEATURES,
      })

      const initial = await readLayout(request, actor.token)
      const items = makeLayoutItems(expectWidgetIds(initial, 2).slice(0, 2).reverse())

      const putResponse = await apiRequest(request, 'PUT', API.layout, {
        token: actor.token,
        data: { items },
      })
      const putBody = await readJsonSafe<{ ok?: boolean }>(putResponse)
      expect(putResponse.status()).toBe(200)
      expect(putBody?.ok).toBe(true)

      const persisted = await readLayout(request, actor.token)
      expect(persisted.layout?.items).toEqual(
        items.map((item, index) =>
          expect.objectContaining({
            id: item.id,
            widgetId: item.widgetId,
            order: index,
            priority: index,
            size: item.size,
          }),
        ),
      )
    } finally {
      await cleanupActor(request, superadminToken, actor)
    }
  })

  test('TC-DASH-003: PUT /api/dashboards/layout rejects unauthenticated and non-configure actors', async ({ request, baseURL }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let viewOnlyActor: TestActor | null = null
    let assignOnlyActor: TestActor | null = null

    const payload = {
      items: [
        {
          id: randomUUID(),
          widgetId: 'dashboards.analytics.ordersKpi',
          order: 0,
          priority: 0,
          size: 'md',
        },
      ],
    }

    const anonymousContext = await playwrightRequest.newContext({ baseURL })
    try {
      const noAuthResponse = await anonymousContext.fetch(API.layout, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
      })
      const noAuthBody = await readJsonSafe<{ error?: string }>(noAuthResponse)
      expect(noAuthResponse.status()).toBe(401)
      expect(noAuthBody?.error).toBe('Unauthorized')

      viewOnlyActor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-003-view',
        features: BASE_DASHBOARD_FEATURES,
      })
      const viewOnlyResponse = await apiRequest(request, 'PUT', API.layout, {
        token: viewOnlyActor.token,
        data: payload,
      })
      const viewOnlyBody = await readJsonSafe<{ error?: string }>(viewOnlyResponse)
      expect(viewOnlyResponse.status()).toBe(403)
      expect(viewOnlyBody?.error).toBe('Forbidden')

      assignOnlyActor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-003-assign',
        features: ASSIGN_WIDGETS_FEATURES,
      })
      const assignOnlyResponse = await apiRequest(request, 'PUT', API.layout, {
        token: assignOnlyActor.token,
        data: payload,
      })
      const assignOnlyBody = await readJsonSafe<{ error?: string }>(assignOnlyResponse)
      expect(assignOnlyResponse.status()).toBe(403)
      expect(assignOnlyBody?.error).toBe('Forbidden')
    } finally {
      await anonymousContext.dispose()
      await cleanupActor(request, superadminToken, viewOnlyActor)
      await cleanupActor(request, superadminToken, assignOnlyActor)
    }
  })

  test('TC-DASH-004: PATCH /api/dashboards/layout/{itemId} updates a single widget size and settings', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let actor: TestActor | null = null

    try {
      actor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-004',
        features: CONFIGURE_FEATURES,
      })

      const initial = await readLayout(request, actor.token)
      const [item] = makeLayoutItems(expectWidgetIds(initial, 1))
      const putResponse = await apiRequest(request, 'PUT', API.layout, {
        token: actor.token,
        data: { items: [item] },
      })
      expect(putResponse.status()).toBe(200)

      const patchResponse = await apiRequest(request, 'PATCH', `${API.layout}/${encodeURIComponent(item.id)}`, {
        token: actor.token,
        data: { size: 'lg', settings: { someKey: 'value' } },
      })
      const patchBody = await readJsonSafe<{ ok?: boolean }>(patchResponse)
      expect(patchResponse.status()).toBe(200)
      expect(patchBody?.ok).toBe(true)

      const updated = await readLayout(request, actor.token)
      expect(updated.layout?.items?.[0]).toEqual(
        expect.objectContaining({
          id: item.id,
          widgetId: item.widgetId,
          size: 'lg',
          settings: { someKey: 'value' },
        }),
      )
    } finally {
      await cleanupActor(request, superadminToken, actor)
    }
  })

  test('TC-DASH-005: PATCH /api/dashboards/layout/{itemId} rejects invalid item ids and missing items', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let actor: TestActor | null = null

    try {
      actor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-005',
        features: CONFIGURE_FEATURES,
      })

      const missingLayoutResponse = await apiRequest(request, 'PATCH', `${API.layout}/00000000-0000-0000-0000-000000000000`, {
        token: actor.token,
        data: { size: 'lg' },
      })
      const missingLayoutBody = await readJsonSafe<{ error?: string }>(missingLayoutResponse)
      expect(missingLayoutResponse.status()).toBe(404)
      expect(missingLayoutBody?.error).toContain('Layout not found')

      const invalidIdResponse = await apiRequest(request, 'PATCH', `${API.layout}/invalid-not-uuid`, {
        token: actor.token,
        data: { size: 'lg' },
      })
      expect(invalidIdResponse.status()).toBe(400)

      const initial = await readLayout(request, actor.token)
      const [item] = makeLayoutItems(expectWidgetIds(initial, 1))
      const putResponse = await apiRequest(request, 'PUT', API.layout, {
        token: actor.token,
        data: { items: [item] },
      })
      expect(putResponse.status()).toBe(200)

      const missingItemResponse = await apiRequest(request, 'PATCH', `${API.layout}/${randomUUID()}`, {
        token: actor.token,
        data: { size: 'lg' },
      })
      const missingItemBody = await readJsonSafe<{ error?: string }>(missingItemResponse)
      expect(missingItemResponse.status()).toBe(404)
      expect(missingItemBody?.error).toContain('Layout item not found')
    } finally {
      await cleanupActor(request, superadminToken, actor)
    }
  })

  test('TC-DASH-006: role widget assignment GET returns empty defaults and PUT persists custom widgets', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const roleName = `qa_dash_role_widgets_${Date.now()}`
    let roleId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      const widgetIds = expectWidgetIds(await readLayout(request, adminToken), 2).slice(0, 2)

      const initialResponse = await apiRequest(request, 'GET', `${API.roleWidgets}?roleId=${encodeURIComponent(roleId)}`, {
        token: adminToken,
      })
      const initialBody = await readJsonSafe<WidgetAssignmentResponse>(initialResponse)
      expect(initialResponse.status()).toBe(200)
      expect(initialBody?.widgetIds).toEqual([])
      expect(initialBody?.hasCustom).toBe(false)
      expect(initialBody?.scope).toEqual({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      const putResponse = await apiRequest(request, 'PUT', API.roleWidgets, {
        token: adminToken,
        data: { roleId, widgetIds },
      })
      const putBody = await readJsonSafe<{ ok?: boolean; widgetIds?: string[] }>(putResponse)
      expect(putResponse.status()).toBe(200)
      expect(putBody?.ok).toBe(true)
      expect(putBody?.widgetIds).toEqual(widgetIds)

      const secondResponse = await apiRequest(request, 'GET', `${API.roleWidgets}?roleId=${encodeURIComponent(roleId)}`, {
        token: adminToken,
      })
      const secondBody = await readJsonSafe<WidgetAssignmentResponse>(secondResponse)
      expect(secondResponse.status()).toBe(200)
      expect(secondBody?.widgetIds).toEqual(widgetIds)
      expect(secondBody?.hasCustom).toBe(true)
    } finally {
      if (roleId) {
        await apiRequest(request, 'PUT', API.roleWidgets, {
          token: adminToken,
          data: { roleId, widgetIds: [] },
        }).catch(() => undefined)
      }
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('TC-DASH-007: user widget assignment supports override and inherit modes', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let actor: TestActor | null = null

    try {
      actor = await createActorWithFeatures(request, {
        superadminToken,
        scope,
        prefix: 'tc-dash-007',
        features: BASE_DASHBOARD_FEATURES,
      })
      const [widgetId] = expectWidgetIds(await readLayout(request, adminToken), 1)

      const initialResponse = await apiRequest(request, 'GET', `${API.userWidgets}?userId=${encodeURIComponent(actor.userId ?? '')}`, {
        token: adminToken,
      })
      const initialBody = await readJsonSafe<WidgetAssignmentResponse>(initialResponse)
      expect(initialResponse.status()).toBe(200)
      expect(initialBody?.mode).toBe('inherit')
      expect(initialBody?.widgetIds).toEqual([])
      expect(initialBody?.hasCustom).toBe(false)
      expect(Array.isArray(initialBody?.effectiveWidgetIds)).toBe(true)

      const overrideResponse = await apiRequest(request, 'PUT', API.userWidgets, {
        token: adminToken,
        data: { userId: actor.userId, mode: 'override', widgetIds: [widgetId] },
      })
      const overrideBody = await readJsonSafe<{ ok?: boolean; mode?: string; widgetIds?: string[] }>(overrideResponse)
      expect(overrideResponse.status()).toBe(200)
      expect(overrideBody?.ok).toBe(true)
      expect(overrideBody?.mode).toBe('override')
      expect(overrideBody?.widgetIds).toEqual([widgetId])

      const overriddenResponse = await apiRequest(request, 'GET', `${API.userWidgets}?userId=${encodeURIComponent(actor.userId ?? '')}`, {
        token: adminToken,
      })
      const overriddenBody = await readJsonSafe<WidgetAssignmentResponse>(overriddenResponse)
      expect(overriddenResponse.status()).toBe(200)
      expect(overriddenBody?.mode).toBe('override')
      expect(overriddenBody?.widgetIds).toEqual([widgetId])
      expect(overriddenBody?.hasCustom).toBe(true)

      const inheritResponse = await apiRequest(request, 'PUT', API.userWidgets, {
        token: adminToken,
        data: { userId: actor.userId, mode: 'inherit', widgetIds: [] },
      })
      const inheritBody = await readJsonSafe<{ ok?: boolean; mode?: string; widgetIds?: string[] }>(inheritResponse)
      expect(inheritResponse.status()).toBe(200)
      expect(inheritBody?.ok).toBe(true)
      expect(inheritBody?.mode).toBe('inherit')
      expect(inheritBody?.widgetIds).toEqual([])

      const inheritedResponse = await apiRequest(request, 'GET', `${API.userWidgets}?userId=${encodeURIComponent(actor.userId ?? '')}`, {
        token: adminToken,
      })
      const inheritedBody = await readJsonSafe<WidgetAssignmentResponse>(inheritedResponse)
      expect(inheritedResponse.status()).toBe(200)
      expect(inheritedBody?.mode).toBe('inherit')
      expect(inheritedBody?.widgetIds).toEqual([])
      expect(inheritedBody?.hasCustom).toBe(false)
    } finally {
      if (actor?.userId) {
        await apiRequest(request, 'PUT', API.userWidgets, {
          token: adminToken,
          data: { userId: actor.userId, mode: 'inherit', widgetIds: [] },
        }).catch(() => undefined)
      }
      await cleanupActor(request, superadminToken, actor)
    }
  })

  test('TC-DASH-008: widget data single and batch endpoints return aggregate results and per-request errors', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const validRequest = {
      entityType: 'sales:orders',
      metric: { field: 'id', aggregate: 'count' },
    }
    const invalidRequest = {
      entityType: 'sales:orders',
      metric: { field: 'doesNotExist', aggregate: 'count' },
    }

    const response = await apiRequest(request, 'POST', API.widgetData, {
      token: adminToken,
      data: validRequest,
    })
    const body = await readJsonSafe<{
      value?: number | null
      data?: unknown[]
      metadata?: { fetchedAt?: string; recordCount?: number }
    }>(response)
    expect(response.status()).toBe(200)
    expect(typeof body?.value === 'number' || body?.value === null).toBe(true)
    expect(Array.isArray(body?.data)).toBe(true)
    expect(typeof body?.metadata?.fetchedAt).toBe('string')
    expect(typeof body?.metadata?.recordCount).toBe('number')

    const invalidResponse = await apiRequest(request, 'POST', API.widgetData, {
      token: adminToken,
      data: invalidRequest,
    })
    const invalidBody = await readJsonSafe<{ error?: string }>(invalidResponse)
    expect(invalidResponse.status()).toBe(400)
    expect(invalidBody?.error).toContain('Invalid metric field')

    const batchResponse = await apiRequest(request, 'POST', API.widgetDataBatch, {
      token: adminToken,
      data: {
        requests: [
          { id: 'orders-count', request: validRequest },
          { id: 'invalid-field', request: invalidRequest },
        ],
      },
    })
    const batchBody = await readJsonSafe<{
      results?: Array<{ id?: string; ok?: boolean; data?: unknown; error?: string }>
    }>(batchResponse)
    expect(batchResponse.status()).toBe(200)
    expect(batchBody?.results).toHaveLength(2)
    expect(batchBody?.results?.find((item) => item.id === 'orders-count')).toEqual(
      expect.objectContaining({ ok: true, data: expect.any(Object) }),
    )
    expect(batchBody?.results?.find((item) => item.id === 'invalid-field')).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Invalid metric field') }),
    )
  })
})
