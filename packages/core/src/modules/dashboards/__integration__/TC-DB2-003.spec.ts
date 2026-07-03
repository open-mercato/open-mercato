import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type DashboardSize = 'sm' | 'md' | 'lg' | 'full'

type DashboardLayoutItem = {
  id: string
  widgetId: string
  order: number
  priority?: number
  size?: DashboardSize
  settings?: unknown
}

type DashboardLayoutPreferences = {
  dateRange?: {
    preset: 'last_7_days' | 'last_30_days' | 'custom'
    from?: string
    to?: string
    compare: 'previous_period' | 'previous_year' | 'none'
  }
}

type DashboardLayoutState = {
  layout?: {
    items?: DashboardLayoutItem[]
    preferences?: DashboardLayoutPreferences
  }
  allowedWidgetIds?: string[]
  canConfigure?: boolean
}

type TestActor = {
  roleId: string | null
  userId: string | null
  token: string
}

const API = {
  layout: '/api/dashboards/layout',
}

const PASSWORD = 'Str0ng!Pass'

const CONFIGURE_FEATURES = [
  'dashboards.view',
  'dashboards.configure',
  'analytics.view',
  'sales.orders.view',
  'sales.channels.view',
  'sales.settings.view',
  'customers.view',
  'customers.people.view',
  'customers.deals.view',
  'catalog.view',
  'catalog.products.view',
  'currencies.view',
  'dictionaries.view',
]

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`
}

async function createConfirmedUser(
  request: APIRequestContext,
  token: string,
  input: { email: string; password: string; organizationId: string; roleName: string; name: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: {
      email: input.email,
      password: input.password,
      organizationId: input.organizationId,
      roles: [input.roleName],
      isConfirmed: true,
      name: input.name,
    },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/auth/users should return 201').toBe(201)
  return expectId(body?.id, 'User creation response should include id')
}

async function createActorWithFeatures(
  request: APIRequestContext,
  input: {
    superadminToken: string
    tenantId: string
    organizationId: string
    prefix: string
    features: string[]
  },
): Promise<TestActor> {
  const id = uniqueId(input.prefix)
  const roleName = `qa_db2_${id.replace(/-/g, '_')}`
  const email = `${id}@dashboards.example.com`

  const roleId = await createRoleFixture(request, input.superadminToken, {
    name: roleName,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, input.superadminToken, {
    roleId,
    features: input.features,
    organizations: null,
  })

  const userId = await createConfirmedUser(request, input.superadminToken, {
    email,
    password: PASSWORD,
    organizationId: input.organizationId,
    roleName,
    name: `QA DB2 ${input.prefix}`,
  })

  const token = await getAuthToken(request, email, PASSWORD)
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

function pickWidgetIds(state: DashboardLayoutState): [string, string] {
  const widgetIds = Array.isArray(state.allowedWidgetIds) ? state.allowedWidgetIds : []
  expect(widgetIds.length, 'dashboard should expose allowed widgets for the fixture role').toBeGreaterThan(0)
  return [widgetIds[0], widgetIds[1] ?? widgetIds[0]]
}

test.describe('TC-DB2-003: layout backward-compatible round trip', () => {
  test('round-trips legacy and v2 payloads, keeps PATCH compatible, rejects invalid sizes, and isolates users', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let firstActor: TestActor | null = null
    let secondActor: TestActor | null = null

    try {
      firstActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-003-first',
        features: CONFIGURE_FEATURES,
      })
      secondActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-003-second',
        features: CONFIGURE_FEATURES,
      })

      const [primaryWidgetId, secondaryWidgetId] = pickWidgetIds(await readLayout(request, firstActor.token))
      const legacyItems: DashboardLayoutItem[] = [
        {
          id: randomUUID(),
          widgetId: secondaryWidgetId,
          order: 10,
          priority: 10,
          size: 'sm',
          settings: { legacySlot: 'second' },
        },
        {
          id: randomUUID(),
          widgetId: primaryWidgetId,
          order: 2,
          priority: 2,
          size: 'lg',
          settings: { legacySlot: 'first' },
        },
      ]

      const legacyPutResponse = await apiRequest(request, 'PUT', API.layout, {
        token: firstActor.token,
        data: { items: legacyItems },
      })
      const legacyPutBody = await readJsonSafe<{ ok?: boolean }>(legacyPutResponse)
      expect(legacyPutResponse.status(), 'pre-v2 {items} PUT body (no preferences) should remain accepted').toBe(200)
      expect(legacyPutBody?.ok).toBe(true)

      const afterLegacy = await readLayout(request, firstActor.token)
      // PUT reindexes order/priority by ARRAY POSITION (same contract as pre-v2 develop),
      // ignoring client-sent order values — assert array order, not the order field.
      expect(afterLegacy.layout?.items).toEqual([
        expect.objectContaining({
          id: legacyItems[0].id,
          widgetId: secondaryWidgetId,
          order: 0,
          priority: 0,
          size: 'sm',
          settings: { legacySlot: 'second' },
        }),
        expect.objectContaining({
          id: legacyItems[1].id,
          widgetId: primaryWidgetId,
          order: 1,
          priority: 1,
          size: 'lg',
          settings: { legacySlot: 'first' },
        }),
      ])

      const objectItems: DashboardLayoutItem[] = [
        {
          id: randomUUID(),
          widgetId: primaryWidgetId,
          order: 0,
          priority: 0,
          size: 'full',
          settings: { mode: 'full-width' },
        },
        {
          id: randomUUID(),
          widgetId: secondaryWidgetId,
          order: 1,
          priority: 1,
          size: 'md',
          settings: { mode: 'secondary' },
        },
      ]
      const preferences: DashboardLayoutPreferences = {
        dateRange: {
          preset: 'last_7_days',
          compare: 'previous_year',
        },
      }

      const objectPutResponse = await apiRequest(request, 'PUT', API.layout, {
        token: firstActor.token,
        data: { items: objectItems, preferences },
      })
      const objectPutBody = await readJsonSafe<{ ok?: boolean; preferences?: DashboardLayoutPreferences }>(objectPutResponse)
      expect(objectPutResponse.status(), 'v2 object PUT should be accepted').toBe(200)
      expect(objectPutBody?.ok).toBe(true)

      const afterObject = await readLayout(request, firstActor.token)
      expect(afterObject.layout?.items).toEqual(
        objectItems.map((item, index) =>
          expect.objectContaining({
            id: item.id,
            widgetId: item.widgetId,
            order: index,
            priority: index,
            size: item.size,
            settings: item.settings,
          }),
        ),
      )
      expect(afterObject.layout?.preferences).toEqual(preferences)

      const patchResponse = await apiRequest(request, 'PATCH', `${API.layout}/${encodeURIComponent(objectItems[0].id)}`, {
        token: firstActor.token,
        data: { settings: { mode: 'patched' } },
      })
      const patchBody = await readJsonSafe<{ ok?: boolean }>(patchResponse)
      expect(patchResponse.status(), 'PATCH should work after an object-shape PUT').toBe(200)
      expect(patchBody?.ok).toBe(true)

      const afterPatch = await readLayout(request, firstActor.token)
      expect(afterPatch.layout?.items?.[0]).toEqual(
        expect.objectContaining({
          id: objectItems[0].id,
          size: 'full',
          settings: { mode: 'patched' },
        }),
      )
      expect(afterPatch.layout?.preferences).toEqual(preferences)

      const invalidSizeResponse = await apiRequest(request, 'PUT', API.layout, {
        token: firstActor.token,
        data: {
          items: [
            {
              id: randomUUID(),
              widgetId: primaryWidgetId,
              order: 0,
              priority: 0,
              size: 'banana',
            },
          ],
        },
      })
      expect(invalidSizeResponse.status(), 'invalid widget size should be rejected').toBe(400)

      const secondLayout = await readLayout(request, secondActor.token)
      const firstItemIds = new Set((afterPatch.layout?.items ?? []).map((item) => item.id))
      expect((secondLayout.layout?.items ?? []).some((item) => firstItemIds.has(item.id))).toBe(false)
      expect(secondLayout.layout?.preferences).not.toEqual(preferences)
    } finally {
      await cleanupActor(request, superadminToken, secondActor)
      await cleanupActor(request, superadminToken, firstActor)
    }
  })
})
