import {
  clearSearchTokenPresenceCache,
  createSearchTokenAvailability,
  hasSearchFilter,
  isSearchFilterOp,
  type OrganizationScope,
} from '../availability'

beforeEach(() => {
  clearSearchTokenPresenceCache()
  delete process.env.OM_SEARCH_TOKEN_PRESENCE_CACHE_MS
})

afterAll(() => {
  delete process.env.OM_SEARCH_TOKEN_PRESENCE_CACHE_MS
})

type ProbeLog = { table: string; wheres: unknown[][] }

function createFakeDb(options?: { rowsByTable?: Record<string, unknown>; failTables?: string[] }) {
  const probes: ProbeLog[] = []
  const db = {
    selectFrom(table: string) {
      const log: ProbeLog = { table, wheres: [] }
      probes.push(log)
      const chain = {
        select: () => chain,
        where: (...args: unknown[]) => {
          log.wheres.push(args)
          return chain
        },
        limit: () => chain,
        executeTakeFirst: async () => {
          if (options?.failTables?.includes(table)) throw new Error(`probe failed for ${table}`)
          return options?.rowsByTable?.[table]
        },
      }
      return chain
    },
  }
  return { db, probes }
}

function buildAvailability(options?: Parameters<typeof createFakeDb>[0] & { enabled?: boolean }) {
  const { db, probes } = createFakeDb(options)
  const logDebug = jest.fn()
  const applyOrganizationScope = jest.fn((query: any) => query)
  const availability = createSearchTokenAvailability({
    getDb: () => db,
    getConfig: () => ({ enabled: options?.enabled ?? true }),
    applyOrganizationScope,
    logDebug,
  })
  return { availability, probes, logDebug, applyOrganizationScope }
}

const countProbes = (probes: ProbeLog[], table: string) => probes.filter((probe) => probe.table === table).length

describe('hasSearchFilter / isSearchFilterOp', () => {
  test('recognizes like and ilike only', () => {
    expect(isSearchFilterOp('like')).toBe(true)
    expect(isSearchFilterOp('ilike')).toBe(true)
    expect(isSearchFilterOp('eq')).toBe(false)
    expect(hasSearchFilter([{ op: 'eq' }, { op: 'in' }])).toBe(false)
    expect(hasSearchFilter([{ op: 'eq' }, { op: 'ilike' }])).toBe(true)
    expect(hasSearchFilter([])).toBe(false)
  })
})

describe('createSearchTokenAvailability', () => {
  test('staticEnabled probes the table once per instance and rechecks config each call', async () => {
    const { availability, probes } = buildAvailability({
      rowsByTable: { 'information_schema.tables': { one: 1 } },
    })
    await expect(availability.staticEnabled()).resolves.toBe(true)
    await expect(availability.staticEnabled()).resolves.toBe(true)
    expect(countProbes(probes, 'information_schema.tables')).toBe(1)
  })

  test('staticEnabled short-circuits on disabled config without probing', async () => {
    const { availability, probes } = buildAvailability({ enabled: false })
    await expect(availability.staticEnabled()).resolves.toBe(false)
    expect(probes).toHaveLength(0)
  })

  test('staticEnabled retries after a failed table probe instead of caching the rejection', async () => {
    const options = { rowsByTable: { 'information_schema.tables': { one: 1 } }, failTables: ['information_schema.tables'] }
    const { availability, probes } = buildAvailability(options)
    await expect(availability.staticEnabled()).rejects.toThrow('probe failed')
    options.failTables.length = 0
    await expect(availability.staticEnabled()).resolves.toBe(true)
    expect(countProbes(probes, 'information_schema.tables')).toBe(2)
  })

  test('hasTokens memoizes per (entity, tenant, org) key', async () => {
    const { availability, probes } = buildAvailability({ rowsByTable: { search_tokens: { one: 1 } } })
    const orgScope: OrganizationScope = { ids: ['org1'], includeNull: false }

    await expect(availability.hasTokens('example:todo', 't1', orgScope)).resolves.toBe(true)
    await expect(availability.hasTokens('example:todo', 't1', orgScope)).resolves.toBe(true)
    expect(countProbes(probes, 'search_tokens')).toBe(1)

    await availability.hasTokens('example:todo', 't2', orgScope)
    await availability.hasTokens('example:other', 't1', orgScope)
    await availability.hasTokens('example:todo', 't1', { ids: ['org2'], includeNull: false })
    expect(countProbes(probes, 'search_tokens')).toBe(4)
  })

  test('hasTokens applies the injected organization scope', async () => {
    const { availability, applyOrganizationScope } = buildAvailability()
    const orgScope: OrganizationScope = { ids: ['org1'], includeNull: true }
    await availability.hasTokens('example:todo', 't1', orgScope)
    expect(applyOrganizationScope).toHaveBeenCalledWith(expect.anything(), 'search_tokens.organization_id', orgScope)

    applyOrganizationScope.mockClear()
    await availability.hasTokens('example:todo', 't1', null)
    expect(applyOrganizationScope).not.toHaveBeenCalled()
  })

  test('hasTokens resolves false and logs search:has-tokens-error on probe failure', async () => {
    const { availability, logDebug } = buildAvailability({ failTables: ['search_tokens'] })
    await expect(availability.hasTokens('example:todo', 't1', null)).resolves.toBe(false)
    expect(logDebug).toHaveBeenCalledWith('search:has-tokens-error', expect.objectContaining({
      entity: 'example:todo',
      tenantId: 't1',
      error: expect.stringContaining('probe failed'),
    }))
  })

  test('anySourceHasTokens stops at the first source with tokens and logs each probed source', async () => {
    const { availability, probes, logDebug } = buildAvailability({ rowsByTable: { search_tokens: { one: 1 } } })
    const result = await availability.anySourceHasTokens(
      [
        { entity: 'example:todo', recordIdColumn: 'b.id' },
        { entity: 'example:other', recordIdColumn: 'cfs0.entity_id' },
      ],
      't1',
      null,
    )
    expect(result).toBe(true)
    expect(countProbes(probes, 'search_tokens')).toBe(1)
    expect(logDebug).toHaveBeenCalledTimes(1)
    expect(logDebug).toHaveBeenCalledWith('search:source-has-tokens', expect.objectContaining({
      entity: 'example:todo',
      recordIdColumn: 'b.id',
      hasTokens: true,
    }))
  })

  test('process-level TTL cache serves later resolver instances without re-probing', async () => {
    const first = buildAvailability({ rowsByTable: { search_tokens: { one: 1 } } })
    await expect(first.availability.hasTokens('example:todo', 't1', null)).resolves.toBe(true)
    expect(countProbes(first.probes, 'search_tokens')).toBe(1)

    const second = buildAvailability()
    await expect(second.availability.hasTokens('example:todo', 't1', null)).resolves.toBe(true)
    expect(countProbes(second.probes, 'search_tokens')).toBe(0)
  })

  test('process-level TTL cache expires and can be disabled', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const first = buildAvailability()
      await first.availability.hasTokens('example:todo', 't1', null)

      nowSpy.mockReturnValue(1_000_000 + 30_001)
      const second = buildAvailability()
      await second.availability.hasTokens('example:todo', 't1', null)
      expect(countProbes(second.probes, 'search_tokens')).toBe(1)

      process.env.OM_SEARCH_TOKEN_PRESENCE_CACHE_MS = '0'
      const third = buildAvailability()
      await third.availability.hasTokens('example:todo', 't1', null)
      expect(countProbes(third.probes, 'search_tokens')).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  test('error-driven false results are not TTL-cached', async () => {
    const first = buildAvailability({ failTables: ['search_tokens'] })
    await expect(first.availability.hasTokens('example:todo', 't1', null)).resolves.toBe(false)

    const second = buildAvailability({ rowsByTable: { search_tokens: { one: 1 } } })
    await expect(second.availability.hasTokens('example:todo', 't1', null)).resolves.toBe(true)
    expect(countProbes(second.probes, 'search_tokens')).toBe(1)
  })

  test('probe uses index-friendly tenant predicates instead of IS NOT DISTINCT FROM', async () => {
    const { availability, probes } = buildAvailability()
    await availability.hasTokens('example:todo', 't1', null)
    await availability.hasTokens('example:todo', null, null)
    const [scoped, global] = probes.filter((probe) => probe.table === 'search_tokens')
    expect(scoped.wheres).toContainEqual(['tenant_id', '=', 't1'])
    expect(global.wheres).toContainEqual(['tenant_id', 'is', null])
  })

  test('anySourceHasTokens sweeps all sources when none has tokens, sharing the memo with hasTokens', async () => {
    const { availability, probes } = buildAvailability()
    const sources = [
      { entity: 'example:todo', recordIdColumn: 'b.id' },
      { entity: 'example:other', recordIdColumn: 'cfs0.entity_id' },
    ]
    await expect(availability.anySourceHasTokens(sources, 't1', null)).resolves.toBe(false)
    expect(countProbes(probes, 'search_tokens')).toBe(2)

    await expect(availability.hasTokens('example:todo', 't1', null)).resolves.toBe(false)
    expect(countProbes(probes, 'search_tokens')).toBe(2)
  })
})
