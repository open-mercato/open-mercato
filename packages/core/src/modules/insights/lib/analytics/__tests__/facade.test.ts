import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely'
import { testRegistry } from '../../process/__tests__/processTestSupport'
import type { XrayDatabase } from '../../projection/types'
import {
  AnalyticsIndividualsDeniedError,
  AnalyticsInvalidRequestError,
  AnalyticsProcessNotFoundError,
  AnalyticsWindowTooLargeError,
  createAnalyticsCacheState,
  createXrayAnalytics,
  decodeCaseCursor,
  encodeCaseCursor,
  type AnalyticsRequestInput,
} from '../index'
import { BASE_MS, DAY_MS } from './analyticsTestSupport'

const TENANT = '11111111-0000-4000-8000-000000000001'
const ORG = '22222222-0000-4000-8000-000000000001'

class UnreachableDriver implements Driver {
  queries = 0

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    this.queries += 1
    throw new Error('[internal] The database must not be reached in this test')
  }

  async beginTransaction(): Promise<void> {}

  async commitTransaction(): Promise<void> {}

  async rollbackTransaction(): Promise<void> {}

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

function createSubject() {
  const driver = new UnreachableDriver()
  const db = new Kysely<XrayDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  const loadSettings = jest.fn(async () => new Map())
  const analytics = createXrayAnalytics({
    db,
    loadSettings,
    registry: () => testRegistry(),
    cacheState: createAnalyticsCacheState(),
    clock: () => BASE_MS,
  })
  return { analytics, driver, loadSettings }
}

function request(overrides: Partial<AnalyticsRequestInput> = {}): AnalyticsRequestInput {
  return {
    scope: { tenantId: TENANT, organizationIds: [] },
    processKey: 'test.deal',
    window: { windowKey: '30d' },
    viewer: { userId: '33333333-0000-4000-8000-000000000001', features: ['insights.xray.view'], canViewIndividuals: false },
    ...overrides,
  }
}

async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return null
  } catch (error) {
    return error
  }
}

describe('X-Ray analytics facade (no database)', () => {
  it('answers an explicitly empty organization scope with empty results and no query', async () => {
    const { analytics, driver, loadSettings } = createSubject()
    const map = await analytics.getProcessMap(request())
    expect(map).toEqual(expect.objectContaining({ n: 0, nodes: [], edges: [], computedThrough: null, organizationIds: [], source: 'live', kAnonymity: 10 }))
    expect((await analytics.getVariants(request({ window: { windowKey: '7d' } }))).items).toEqual([])
    expect((await analytics.getDurations(request())).open.stats.n).toBe(0)
    expect((await analytics.getBottlenecks(request())).items).toEqual([])
    expect((await analytics.getRework(request())).reworkRate).toBeNull()
    expect((await analytics.getBreakdown({ ...request(), groupBy: 'team' })).items).toEqual([])
    expect(await analytics.getConformance({ ...request(), models: [{ key: 'seq', source: { kind: 'sequence', definitionId: null, version: null }, steps: ['created'], transitions: [], startSteps: ['created'], endSteps: ['created'], activityStepMap: { created: 'created' } }] }))
      .toEqual(expect.objectContaining({ status: 'refused', reason: 'no_cases', n: 0 }))
    expect(await analytics.listCases(request())).toEqual(expect.objectContaining({ n: 0, items: [], nextCursor: null }))
    expect(driver.queries).toBe(0)
    expect(loadSettings).not.toHaveBeenCalled()
  })

  it('refuses unregistered processes, invalid requests and windows over 180 days before reading', async () => {
    const { analytics, driver } = createSubject()
    const unknown = await errorOf(() => analytics.getProcessMap(request({ processKey: 'test.unknown' })))
    expect(unknown).toBeInstanceOf(AnalyticsProcessNotFoundError)
    expect(unknown).toEqual(expect.objectContaining({ status: 404 }))
    const invalid = await errorOf(() => analytics.getProcessMap(request({ scope: { tenantId: 'not-a-uuid', organizationIds: [] } })))
    expect(invalid).toBeInstanceOf(AnalyticsInvalidRequestError)
    expect((invalid as AnalyticsInvalidRequestError).issues).toContain('scope.tenantId')
    const tooLong = await errorOf(() => analytics.getProcessMap(request({
      scope: { tenantId: TENANT, organizationIds: [ORG] },
      window: { from: new Date(BASE_MS - 181 * DAY_MS).toISOString(), to: new Date(BASE_MS).toISOString() },
    })))
    expect(tooLong).toBeInstanceOf(AnalyticsWindowTooLargeError)
    expect(tooLong).toEqual(expect.objectContaining({ status: 422, hint: 'run_background_analysis' }))
    const badPage = await errorOf(() => analytics.listCases({ ...request(), pageSize: 101 }))
    expect(badPage).toBeInstanceOf(AnalyticsInvalidRequestError)
    const badCursor = await errorOf(() => analytics.listCases({ ...request(), cursor: 'garbage' }))
    expect(badCursor).toBeInstanceOf(AnalyticsInvalidRequestError)
    expect(driver.queries).toBe(0)
  })

  it('denies per-person breakdowns before reading when the gate is closed', async () => {
    const { analytics, driver, loadSettings } = createSubject()
    const missingFeature = await errorOf(() => analytics.getBreakdown({ ...request(), groupBy: 'user' }))
    expect(missingFeature).toBeInstanceOf(AnalyticsIndividualsDeniedError)
    expect((missingFeature as AnalyticsIndividualsDeniedError).reason).toBe('feature_missing')
    const listed = await errorOf(() => analytics.getBreakdown({ ...request({ scope: { tenantId: TENANT, organizationIds: [ORG] } }), groupBy: 'user' }))
    expect((listed as AnalyticsIndividualsDeniedError).reason).toBe('feature_missing')
    const anonymous = await errorOf(() => analytics.getBreakdown({
      ...request({ scope: { tenantId: TENANT, organizationIds: [ORG] }, viewer: { userId: null, features: [], canViewIndividuals: true } }),
      groupBy: 'user',
    }))
    expect((anonymous as AnalyticsIndividualsDeniedError).reason).toBe('viewer_unknown')
    const allowedViewer = { userId: '33333333-0000-4000-8000-000000000001', features: ['insights.xray.view_individuals'], canViewIndividuals: true }
    const noOrganization = await errorOf(() => analytics.getBreakdown({ ...request({ viewer: allowedViewer }), groupBy: 'user' }))
    expect((noOrganization as AnalyticsIndividualsDeniedError).reason).toBe('no_organization')
    expect(driver.queries).toBe(0)
    expect(loadSettings).not.toHaveBeenCalled()
  })

  it('round-trips case list cursors and rejects tampered ones', () => {
    const cursor = { at: `${new Date(BASE_MS).toISOString().slice(0, -1)}001Z`, id: '44444444-0000-4000-8000-000000000001' }
    expect(decodeCaseCursor(encodeCaseCursor(cursor))).toEqual(cursor)
    expect(decodeCaseCursor(Buffer.from(JSON.stringify({ at: 'x', id: cursor.id })).toString('base64url'))).toBeNull()
    expect(decodeCaseCursor('%%%')).toBeNull()
  })
})
