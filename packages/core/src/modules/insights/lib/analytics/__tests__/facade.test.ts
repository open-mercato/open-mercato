import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings,
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
  type AccessLogWriter,
  type AnalyticsOrgSettings,
  type AnalyticsRequestInput,
} from '../index'
import { BASE_MS, DAY_MS } from './analyticsTestSupport'

const TENANT = '11111111-0000-4000-8000-000000000001'
const ORG = '22222222-0000-4000-8000-000000000001'

class UnreachableDriver implements Driver {
  queries = 0

  constructor(private readonly onAcquire: () => void = () => undefined) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    this.queries += 1
    this.onAcquire()
    throw new Error('[internal] The database must not be reached in this test')
  }

  async beginTransaction(): Promise<void> {}

  async commitTransaction(): Promise<void> {}

  async rollbackTransaction(): Promise<void> {}

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

class RecordingDriver implements Driver {
  statements: string[] = []

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const statements = this.statements
    return {
      executeQuery: async <TRow>(compiled: CompiledQuery): Promise<QueryResult<TRow>> => {
        statements.push(compiled.sql)
        return { rows: [] }
      },
      streamQuery: () => {
        throw new Error('[internal] Streaming is not used by the analytics')
      },
    }
  }

  async beginTransaction(_connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    this.statements.push(['begin', settings.isolationLevel, settings.accessMode].filter(Boolean).join(' '))
  }

  async commitTransaction(): Promise<void> {
    this.statements.push('commit')
  }

  async rollbackTransaction(): Promise<void> {
    this.statements.push('rollback')
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

function kyselyOver(driver: Driver): Kysely<XrayDatabase> {
  return new Kysely<XrayDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

function createSubject(options: { settings?: Map<string, AnalyticsOrgSettings>; accessLog?: AccessLogWriter; onQuery?: () => void } = {}) {
  const driver = new UnreachableDriver(options.onQuery)
  const db = kyselyOver(driver)
  const loadSettings = jest.fn(async () => options.settings ?? new Map<string, AnalyticsOrgSettings>())
  const analytics = createXrayAnalytics({
    db,
    loadSettings,
    registry: () => testRegistry(),
    cacheState: createAnalyticsCacheState(),
    clock: () => BASE_MS,
    accessLog: options.accessLog ?? null,
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
    expect(map).toEqual(expect.objectContaining({ n: 0, nodes: [], edges: [], computedThrough: null, incomplete: false, organizationIds: [], source: 'live', kAnonymity: 10 }))
    expect((await analytics.getVariants(request({ window: { windowKey: '7d' } }))).items).toEqual([])
    expect((await analytics.getDurations(request())).open).toEqual(expect.objectContaining({ empty: true, stats: expect.objectContaining({ n: 0 }) }))
    expect((await analytics.getBottlenecks(request())).items).toEqual([])
    expect((await analytics.getRework(request())).reworkRate).toBeNull()
    expect((await analytics.getBreakdown({ ...request(), groupBy: 'team' })).items).toEqual([])
    expect(await analytics.getConformance({ ...request(), models: [{ key: 'seq', source: { kind: 'sequence', definitionId: null, version: null }, steps: ['created'], transitions: [], startSteps: ['created'], endSteps: ['created'], activityStepMap: { created: 'created' } }] }))
      .toEqual(expect.objectContaining({ status: 'refused', reason: 'no_cases', n: 0 }))
    expect(await analytics.listCases(request())).toEqual(expect.objectContaining({ n: 0, items: [], nextCursor: null, incomplete: false }))
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

  it('writes the per-person access log before any data is read and denies without reading when it fails', async () => {
    const settings = new Map<string, AnalyticsOrgSettings>([[ORG, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: true }]])
    const viewer = { userId: '33333333-0000-4000-8000-000000000001', features: ['insights.xray.view_individuals'], canViewIndividuals: true }
    const order: string[] = []
    const logged = createSubject({
      settings,
      accessLog: { log: async () => { order.push('access_log'); return { id: 'row' } } },
      onQuery: () => order.push('query'),
    })
    const unreachable = await errorOf(() => logged.analytics.getBreakdown({ ...request({ scope: { tenantId: TENANT, organizationIds: [ORG] }, viewer }), groupBy: 'user' }))
    expect(unreachable).not.toBeInstanceOf(AnalyticsIndividualsDeniedError)
    expect(order[0]).toBe('access_log')
    const failing = createSubject({ settings, accessLog: { log: async () => { throw new Error('[internal] audit store down') } } })
    const denied = await errorOf(() => failing.analytics.getBreakdown({ ...request({ scope: { tenantId: TENANT, organizationIds: [ORG] }, viewer }), groupBy: 'user' }))
    expect(denied).toBeInstanceOf(AnalyticsIndividualsDeniedError)
    expect((denied as AnalyticsIndividualsDeniedError).reason).toBe('access_log_failed')
    expect(failing.driver.queries).toBe(0)
  })

  it('lists the active processes of a rollup pass inside the timed read-only transaction, one bounded probe per key', async () => {
    const driver = new RecordingDriver()
    const analytics = createXrayAnalytics({
      db: kyselyOver(driver),
      loadSettings: async () => new Map(),
      registry: () => testRegistry(),
      cacheState: createAnalyticsCacheState(),
      clock: () => BASE_MS,
    })
    expect(await analytics.computeRollups({ tenantId: TENANT, organizationId: ORG })).toEqual({ processes: 0, written: 0, skipped: 0 })
    const listing = driver.statements.findIndex((statement) => statement.includes('insights_process_events'))
    expect(listing).toBeGreaterThan(0)
    expect(driver.statements.slice(0, listing)).toEqual(['begin repeatable read read only', expect.stringContaining('statement_timeout')])
    expect(driver.statements[listing]).toMatch(/exists\s*\(/)
    expect(driver.statements[listing]).toMatch(/limit 1/)
    expect(driver.statements[listing]).not.toMatch(/select distinct/)
    expect(driver.statements[listing + 1]).toBe('commit')
  })

  it('round-trips case list cursors and rejects tampered ones', () => {
    const cursor = { at: `${new Date(BASE_MS).toISOString().slice(0, -1)}001Z`, id: '44444444-0000-4000-8000-000000000001' }
    expect(decodeCaseCursor(encodeCaseCursor(cursor))).toEqual(cursor)
    expect(decodeCaseCursor(Buffer.from(JSON.stringify({ at: 'x', id: cursor.id })).toString('base64url'))).toBeNull()
    expect(decodeCaseCursor('%%%')).toBeNull()
  })
})
