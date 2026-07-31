const mockGetEntityIds = jest.fn(() => ({}))
const mockFlattenSystemEntityIds = jest.fn(() => ['a', 'b', 'c', 'd', 'e'])
const mockReadCoverageSnapshots = jest.fn(async () => new Map())
const mockPrimeColumnCache = jest.fn(async () => undefined)
const mockResolveEntityTableName = jest.fn((_em: unknown, entityType: string) => `${entityType}_table`)

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: (...args: unknown[]) => mockGetEntityIds(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  flattenSystemEntityIds: (...args: unknown[]) => mockFlattenSystemEntityIds(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  resolveEntityTableName: (...args: unknown[]) => mockResolveEntityTableName(...(args as [any, string])),
}))

jest.mock('../lib/coverage', () => ({
  readCoverageSnapshots: (...args: unknown[]) => mockReadCoverageSnapshots(...(args as [])),
  primeColumnCache: (...args: unknown[]) => mockPrimeColumnCache(...(args as [])),
}))

import handleWarmup from '../subscribers/coverage_warmup'

const WARMUP_ENV_KEYS = [
  'QUERY_INDEX_WARMUP_ENABLED',
  'QUERY_INDEX_WARMUP_CONCURRENCY',
  'QUERY_INDEX_WARMUP_STAGGER_MS',
  'QUERY_INDEX_WARMUP_THROTTLE_MS',
] as const

function createContext() {
  const emit = jest.fn(async () => undefined)
  const eventBus = { emit }
  const em = { getKysely: () => ({ id: 'db' }) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'eventBus') return eventBus
      if (name === 'em') return em
      throw new Error(`Unexpected token: ${name}`)
    }),
  }
  return { ctx, emit }
}

function delaysByEntity(emit: jest.Mock): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [event, payload] of emit.mock.calls) {
    if (event !== 'query_index.coverage.refresh') continue
    out[(payload as any).entityType] = (payload as any).delayMs
  }
  return out
}

describe('query_index coverage warmup burst spreading', () => {
  const originalEnv: Record<string, string | undefined> = {}
  let testCounter = 0

  beforeEach(() => {
    jest.clearAllMocks()
    // Fresh entity ids per test so the module-level `lastWarmupAt` throttle Map never suppresses emits.
    testCounter += 1
    const suffix = testCounter
    mockFlattenSystemEntityIds.mockReturnValue(['a', 'b', 'c', 'd', 'e'].map((id) => `${id}:${suffix}`))
    for (const key of WARMUP_ENV_KEYS) originalEnv[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of WARMUP_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
  })

  it('assigns proportionally larger delayMs to later chunks when stagger is set', async () => {
    process.env.QUERY_INDEX_WARMUP_CONCURRENCY = '2'
    process.env.QUERY_INDEX_WARMUP_STAGGER_MS = '1000'
    const { ctx, emit } = createContext()

    await handleWarmup({ tenantId: null }, ctx)

    const delays = delaysByEntity(emit)
    const values = Object.values(delays).sort((left, right) => left - right)
    // 5 entities, concurrency 2 → chunks [0,1,2] → delays 0, 1000, 2000.
    expect(values).toEqual([0, 0, 1000, 1000, 2000])
  })

  it('keeps every delayMs at 0 when stagger is unset (unchanged default behavior)', async () => {
    process.env.QUERY_INDEX_WARMUP_CONCURRENCY = '2'
    delete process.env.QUERY_INDEX_WARMUP_STAGGER_MS
    const { ctx, emit } = createContext()

    await handleWarmup({ tenantId: null }, ctx)

    const delays = delaysByEntity(emit)
    expect(Object.values(delays)).toHaveLength(5)
    expect(Object.values(delays).every((value) => value === 0)).toBe(true)
  })

  it('does nothing when the warmup kill-switch is disabled', async () => {
    process.env.QUERY_INDEX_WARMUP_ENABLED = 'false'
    const { ctx, emit } = createContext()

    await handleWarmup({ tenantId: null }, ctx)

    expect(emit).not.toHaveBeenCalled()
  })

  it('skips entity types whose persisted coverage snapshot was refreshed within the throttle window', async () => {
    process.env.QUERY_INDEX_WARMUP_THROTTLE_MS = String(5 * 60 * 1000)
    const now = Date.now()
    const [freshEntity, ...rest] = mockFlattenSystemEntityIds()
    mockReadCoverageSnapshots.mockResolvedValueOnce(new Map([
      [freshEntity, { refreshed_at: new Date(now - 1000) }],
    ]))
    const { ctx, emit } = createContext()

    await handleWarmup({ tenantId: null }, ctx)

    expect(mockReadCoverageSnapshots).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityTypes: expect.arrayContaining([freshEntity, ...rest]) }),
    )
    const delays = delaysByEntity(emit)
    expect(Object.keys(delays)).not.toContain(freshEntity)
    expect(Object.keys(delays)).toHaveLength(rest.length)
  })

  it('re-emits entity types whose persisted snapshot is stale or missing, even across a simulated process restart', async () => {
    const entityIds = mockFlattenSystemEntityIds()
    process.env.QUERY_INDEX_WARMUP_THROTTLE_MS = String(5 * 60 * 1000)
    const now = Date.now()
    // Simulate a "restart": no in-memory throttle state exists, but the DB row for one
    // entity is old enough to be genuinely stale, so it must still be re-emitted.
    mockReadCoverageSnapshots.mockResolvedValueOnce(new Map([
      [entityIds[0], { refreshed_at: new Date(now - 10 * 60 * 1000) }],
    ]))
    const { ctx, emit } = createContext()

    await handleWarmup({ tenantId: null }, ctx)

    const delays = delaysByEntity(emit)
    expect(Object.keys(delays)).toHaveLength(entityIds.length)
  })

  it('falls back to emitting all candidates when the coverage snapshot lookup is unavailable (no em resolvable)', async () => {
    const emit = jest.fn(async () => undefined)
    const eventBus = { emit }
    const ctx = {
      resolve: jest.fn((name: string) => {
        if (name === 'eventBus') return eventBus
        throw new Error(`Unexpected token: ${name}`)
      }),
    }

    await handleWarmup({ tenantId: null }, ctx)

    expect(mockReadCoverageSnapshots).not.toHaveBeenCalled()
    expect(mockPrimeColumnCache).not.toHaveBeenCalled()
    const delays = delaysByEntity(emit)
    expect(Object.keys(delays)).toHaveLength(mockFlattenSystemEntityIds().length)
  })

  it('primes the shared column cache for every stale entity type plus vector_search, before dispatching any refresh', async () => {
    const entityIds = mockFlattenSystemEntityIds()
    const { ctx, emit } = createContext()

    await handleWarmup({ tenantId: null }, ctx)

    expect(mockPrimeColumnCache).toHaveBeenCalledTimes(1)
    const checks = mockPrimeColumnCache.mock.calls[0][1] as Array<{ table: string; column: string }>
    expect(checks).toContainEqual({ table: 'vector_search', column: 'entity_id' })
    for (const entityType of entityIds) {
      const table = `${entityType}_table`
      expect(checks).toContainEqual({ table, column: 'organization_id' })
      expect(checks).toContainEqual({ table, column: 'tenant_id' })
      expect(checks).toContainEqual({ table, column: 'deleted_at' })
    }
    // Priming must be awaited before any refresh is dispatched, not fired concurrently with it.
    const primeOrder = mockPrimeColumnCache.mock.invocationCallOrder[0]
    const firstEmitOrder = emit.mock.invocationCallOrder[0]
    expect(primeOrder).toBeLessThan(firstEmitOrder)
  })
})
