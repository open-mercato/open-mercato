/** @jest-environment node */
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { testRegistry } from '../../lib/process/__tests__/processTestSupport'
import { caseListResultSchema, createAnalyticsCacheState, createXrayAnalytics, type XrayAnalytics } from '../../lib/analytics/index'
import { ANALYTICS_ORG, BASE_MS } from '../../lib/analytics/__tests__/analyticsTestSupport'
import {
  createScriptedAnalyticsDb,
  drillDownPopulation,
  listingOf,
  type ScriptedAnalyticsDb,
  type ScriptedListingRow,
} from '../../lib/analytics/__tests__/scriptedAnalyticsDb'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_A = ANALYTICS_ORG
const USER_ID = '33333333-0000-4000-8000-000000000001'
const COMPUTED_THROUGH = '2026-01-05T08:00:00.000000Z'
const population = drillDownPopulation()

const getAuthFromRequestMock = jest.fn()
const resolveFeatureCheckContextMock = jest.fn()
const grants: { features: string[] } = { features: [] }
const registrySnapshot = { current: testRegistry() }
const analyticsHolder: { current: XrayAnalytics | null; scripted: ScriptedAnalyticsDb | null } = { current: null, scripted: null }

const container = {
  resolve: (name: string): unknown => {
    if (name === 'rbacService') {
      return {
        userHasAllFeatures: async (_userId: string, required: string[]) => hasAllFeatures(required, grants.features),
        loadAcl: async () => ({ isSuperAdmin: false, features: grants.features }),
      }
    }
    throw new Error(`[internal] unexpected service ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (...args: unknown[]) => resolveFeatureCheckContextMock(...args),
}))

jest.mock('../../lib/process/registry', () => {
  const actual = jest.requireActual('../../lib/process/registry')
  return { ...actual, getProcessRegistry: () => registrySnapshot.current }
})

jest.mock('../../lib/analytics/index', () => {
  const actual = jest.requireActual('../../lib/analytics/index')
  return {
    ...actual,
    createXrayAnalyticsFromContainer: () => {
      if (!analyticsHolder.current) throw new Error('[internal] analytics not prepared')
      return analyticsHolder.current
    },
  }
})

import { GET as casesGet } from '../xray/[processKey]/cases/route'

function prepareAnalytics(listing: readonly ScriptedListingRow[]): ScriptedAnalyticsDb {
  const scripted = createScriptedAnalyticsDb({ events: population.events, listing, computedThrough: COMPUTED_THROUGH })
  analyticsHolder.scripted = scripted
  analyticsHolder.current = createXrayAnalytics({
    db: scripted.db,
    loadSettings: async () => new Map([[ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false }]]),
    registry: () => registrySnapshot.current,
    cache: null,
    cacheState: createAnalyticsCacheState(),
    clock: () => BASE_MS,
  })
  return scripted
}

async function getCases(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await casesGet(new Request(`http://localhost/api/insights/xray/test.deal/cases?${query}`, { method: 'GET' }), { params: { processKey: 'test.deal' } })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(() => {
  jest.clearAllMocks()
  grants.features = ['insights.xray.view', 'test.deals.view']
  getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_A })
  resolveFeatureCheckContextMock.mockResolvedValue({
    organizationId: ORG_A,
    scope: { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: null, tenantId: TENANT_ID },
    allowedOrganizationIds: null,
  })
  analyticsHolder.current = null
  analyticsHolder.scripted = null
})

describe('GET /api/insights/xray/{processKey}/cases — drill-downs follow the analytics cell rule', () => {
  const hidden = {
    processKey: 'test.deal',
    organizationIds: [ORG_A],
    n: 0,
    computedThrough: COMPUTED_THROUGH,
    incomplete: false,
    suppressed: true,
    items: [],
    nextCursor: null,
  }

  it('answers an empty suppressed page (never the n of the cell) for a suppressed or complementary-suppressed step', async () => {
    for (const [activityKey, caseIds] of [['priority:high', population.cases.priority], ['status:won', population.cases.won]] as const) {
      const scripted = prepareAnalytics(listingOf(caseIds))
      const response = await getCases(`window=30d&activityKey=${encodeURIComponent(activityKey)}`)
      expect(response.status).toBe(200)
      expect(response.body).toEqual(expect.objectContaining(hidden))
      expect(response.body.window).toEqual(expect.objectContaining({ windowKey: '30d', timeZone: 'UTC' }))
      expect(caseListResultSchema.safeParse(response.body).success).toBe(true)
      expect(scripted.count('case_page')).toBe(0)
    }
  })

  it('answers an empty suppressed page for a suppressed or unknown stored variant hash', async () => {
    for (const variantHash of [population.storedHashes.lost, population.storedHashes.qualifiedLost, 'f'.repeat(64)]) {
      const scripted = prepareAnalytics(listingOf(population.cases.qualifiedLost))
      const response = await getCases(`window=30d&variantHash=${variantHash}`)
      expect(response.status).toBe(200)
      expect(response.body).toEqual(expect.objectContaining(hidden))
      expect(scripted.count('case_page')).toBe(0)
    }
  })

  it('lists visible drill-downs and plain listings unchanged, flagged as not suppressed', async () => {
    const lost = listingOf([...population.cases.qualifiedLost, ...population.cases.lost])
    prepareAnalytics(lost)
    const byStep = await getCases(`window=30d&activityKey=${encodeURIComponent('status:lost')}`)
    expect(byStep.status).toBe(200)
    expect(byStep.body).toEqual(expect.objectContaining({ suppressed: false, n: lost.length, nextCursor: null }))
    expect(byStep.body.items).toEqual(lost.map((row) => ({ caseId: row.caseId, organizationId: row.organizationId })))
    expect(caseListResultSchema.safeParse(byStep.body).success).toBe(true)

    const won = listingOf(population.cases.won)
    prepareAnalytics(won)
    const byVariant = await getCases(`window=30d&variantHash=${population.storedHashes.won}`)
    expect(byVariant.body).toEqual(expect.objectContaining({ suppressed: false, n: won.length }))
    expect(byVariant.body.items).toHaveLength(won.length)

    const scripted = prepareAnalytics(won)
    const plain = await getCases('window=30d&status=completed')
    expect(plain.body).toEqual(expect.objectContaining({ suppressed: false, n: won.length }))
    expect(scripted.count('case_events')).toBe(0)
  })

  it('still answers 422 filter_too_narrow for a drill-down with a too narrow actor filter', async () => {
    const scripted = prepareAnalytics(listingOf(population.cases.won))
    const response = await getCases(`window=30d&activityKey=${encodeURIComponent('status:lost')}&actorRoleIds=99999999-0000-4000-8000-000000000001`)
    expect(response).toEqual({ status: 422, body: { error: 'insights.xray.errors.filter_too_narrow', code: 'filter_too_narrow', hint: 'widen_actor_filter' } })
    expect(scripted.count('case_page')).toBe(0)
  })
})
