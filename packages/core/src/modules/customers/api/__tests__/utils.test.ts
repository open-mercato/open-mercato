import {
  withScopedPayload,
  findMatchingEntityIdsBySearchTokensAcrossSources,
  findMatchingEntityIdsWithQueryEngine,
} from '../utils'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const translate = (key: string, fallback?: string) => fallback ?? key

type FakeDbOptions = {
  customFieldDefs?: Array<Record<string, unknown>>
  searchTokenRowsByEntity?: Record<string, Array<{ entity_id: string }>>
  mapRowsByTable?: Record<string, Array<Record<string, unknown>>>
  onSearchTokenExecute?: () => Promise<void> | void
}

function createFakeDb(options: FakeDbOptions) {
  const {
    customFieldDefs = [],
    searchTokenRowsByEntity = {},
    mapRowsByTable = {},
    onSearchTokenExecute,
  } = options

  const makeBuilder = () => {
    const state: { table: string | null; conditions: Record<string, unknown> } = {
      table: null,
      conditions: {},
    }
    const builder: Record<string, unknown> = {
      selectFrom(table: string) {
        state.table = table
        return builder
      },
      select() {
        return builder
      },
      where(column: unknown, _op?: unknown, value?: unknown) {
        if (typeof column === 'string') state.conditions[column] = value
        return builder
      },
      groupBy() {
        return builder
      },
      having() {
        return builder
      },
      async execute() {
        if (state.table === 'custom_field_defs') return customFieldDefs
        if (state.table === 'search_tokens') {
          if (onSearchTokenExecute) await onSearchTokenExecute()
          const entityType = state.conditions['entity_type']
          return typeof entityType === 'string' ? searchTokenRowsByEntity[entityType] ?? [] : []
        }
        return mapRowsByTable[state.table ?? ''] ?? []
      },
    }
    return builder
  }

  return {
    selectFrom(table: string) {
      return makeBuilder().selectFrom(table)
    },
  }
}

function createCtxWithDb(db: unknown) {
  const em = { getKysely: () => db }
  return {
    auth: { tenantId: 'tenant-1' },
    selectedOrganizationId: 'org-1',
    container: { resolve: (key: string) => (key === 'em' ? em : undefined) },
  } as any
}

describe('customers api utils - withScopedPayload', () => {
  it('throws when tenant context cannot be resolved', () => {
    const ctx = { auth: { tenantId: null, orgId: null }, selectedOrganizationId: null }
    expect(() => withScopedPayload(null, ctx as any, translate)).toThrow(CrudHttpError)
    try {
      withScopedPayload(null, ctx as any, translate)
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(400)
    }
  })

  it('resolves tenant and organization from context when missing in payload', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'auth-org' },
      selectedOrganizationId: 'selected-org',
    }
    const scoped = withScopedPayload({ name: 'Ada' }, ctx as any, translate)
    expect(scoped).toMatchObject({
      name: 'Ada',
      tenantId: 'tenant-1',
      organizationId: 'selected-org',
    })
  })

  it('prefers payload organizationId when provided', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'auth-org' },
      selectedOrganizationId: 'selected-org',
    }
    const scoped = withScopedPayload(
      { organizationId: 'payload-org' },
      ctx as any,
      translate
    )
    expect(scoped.organizationId).toBe('payload-org')
  })

  it('allows missing organization when explicitly disabled', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: null,
    }
    const scoped = withScopedPayload(
      { name: 'Grace' },
      ctx as any,
      translate,
      { requireOrganization: false }
    )
    expect(scoped).toMatchObject({
      name: 'Grace',
      tenantId: 'tenant-1',
    })
    expect(scoped).not.toHaveProperty('organizationId')
  })
})

describe('customers api utils - findMatchingEntityIdsBySearchTokensAcrossSources', () => {
  it('returns null for a blank query', async () => {
    const ctx = createCtxWithDb(createFakeDb({}))
    const result = await findMatchingEntityIdsBySearchTokensAcrossSources({
      ctx,
      sources: [{ entityType: 'customers:person', fields: ['name'] }],
      query: '   ',
    })
    expect(result).toBeNull()
  })

  it('unions matched ids across sources and applies id mapping', async () => {
    const db = createFakeDb({
      searchTokenRowsByEntity: {
        'customers:person': [{ entity_id: 'person-1' }, { entity_id: 'person-2' }],
        'customers:address': [{ entity_id: 'address-9' }],
      },
      mapRowsByTable: {
        customer_addresses: [{ person_id: 'person-2' }, { person_id: 'person-3' }],
      },
    })
    const ctx = createCtxWithDb(db)

    const result = await findMatchingEntityIdsBySearchTokensAcrossSources({
      ctx,
      query: 'ada',
      sources: [
        { entityType: 'customers:person', fields: ['name'] },
        {
          entityType: 'customers:address',
          fields: ['city'],
          mapToEntityIds: { table: 'customer_addresses', targetColumn: 'person_id' },
        },
      ],
    })

    expect(result).not.toBeNull()
    expect(new Set(result as string[])).toEqual(new Set(['person-1', 'person-2', 'person-3']))
  })

  it('resolves token sources concurrently rather than sequentially', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const onSearchTokenExecute = () =>
      new Promise<void>((resolve) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        setTimeout(() => {
          inFlight -= 1
          resolve()
        }, 0)
      })

    const db = createFakeDb({
      searchTokenRowsByEntity: {
        'customers:person': [{ entity_id: 'person-1' }],
        'customers:address': [{ entity_id: 'address-1' }],
      },
      mapRowsByTable: { customer_addresses: [{ person_id: 'person-9' }] },
      onSearchTokenExecute,
    })
    const ctx = createCtxWithDb(db)

    await findMatchingEntityIdsBySearchTokensAcrossSources({
      ctx,
      query: 'ada',
      sources: [
        { entityType: 'customers:person', fields: ['name'] },
        {
          entityType: 'customers:address',
          fields: ['city'],
          mapToEntityIds: { table: 'customer_addresses', targetColumn: 'person_id' },
        },
      ],
    })

    expect(maxInFlight).toBe(2)
  })
})

describe('customers api utils - search organization scope (#9007)', () => {
  type RecordedQuery = { table: string; conditions: Record<string, unknown> }

  function createRecordingDb(rows: Record<string, Array<Record<string, unknown>>>) {
    const queries: RecordedQuery[] = []
    const db = {
      selectFrom(table: string) {
        const recorded: RecordedQuery = { table, conditions: {} }
        queries.push(recorded)
        const builder: Record<string, unknown> = {
          select: () => builder,
          groupBy: () => builder,
          having: () => builder,
          where(column: unknown, _op?: unknown, value?: unknown) {
            if (typeof column === 'string') recorded.conditions[column] = value
            return builder
          },
          async execute() {
            return rows[table] ?? []
          },
        }
        return builder
      },
    }
    return { db, queries }
  }

  function createScopedCtx(db: unknown, scope: { selectedOrganizationId: string | null; organizationIds: string[] | null }) {
    const em = { getKysely: () => db }
    return {
      auth: { tenantId: 'tenant-1' },
      ...scope,
      container: { resolve: (key: string) => (key === 'em' ? em : undefined) },
    } as any
  }

  const personSources = [
    { entityType: 'customers:customer_entity', fields: ['display_name'] },
    {
      entityType: 'customers:customer_person_profile',
      fields: ['first_name'],
      mapToEntityIds: { table: 'customer_people', targetColumn: 'entity_id' },
    },
  ]

  it('searches the selected organization and its descendants when a parent is selected', async () => {
    const { db, queries } = createRecordingDb({
      search_tokens: [{ entity_id: 'record-in-child' }],
      customer_people: [{ entity_id: 'person-in-child' }],
    })
    const ctx = createScopedCtx(db, {
      selectedOrganizationId: 'org-parent',
      organizationIds: ['org-parent', 'org-child'],
    })

    const result = await findMatchingEntityIdsBySearchTokensAcrossSources({ ctx, query: 'alpha', sources: personSources })

    expect(new Set(result as string[])).toEqual(new Set(['record-in-child', 'person-in-child']))
    const tokenQueries = queries.filter((query) => query.table === 'search_tokens')
    expect(tokenQueries).toHaveLength(2)
    for (const query of tokenQueries) {
      expect(query.conditions.organization_id).toEqual(['org-parent', 'org-child'])
    }
    const mapQuery = queries.find((query) => query.table === 'customer_people')
    expect(mapQuery?.conditions.organization_id).toEqual(['org-parent', 'org-child'])
  })

  it('falls back to the selected organization when no organization list is resolved', async () => {
    const { db, queries } = createRecordingDb({ search_tokens: [{ entity_id: 'record-1' }] })
    const ctx = createScopedCtx(db, { selectedOrganizationId: 'org-1', organizationIds: null })

    await findMatchingEntityIdsBySearchTokensAcrossSources({ ctx, query: 'alpha', sources: [personSources[0]] })

    const tokenQuery = queries.find((query) => query.table === 'search_tokens')
    expect(tokenQuery?.conditions.organization_id).toEqual(['org-1'])
  })

  it('leaves organization unrestricted only for an unrestricted ("All organizations") scope', async () => {
    const { db, queries } = createRecordingDb({ search_tokens: [{ entity_id: 'record-1' }] })
    const ctx = createScopedCtx(db, { selectedOrganizationId: null, organizationIds: null })

    const result = await findMatchingEntityIdsBySearchTokensAcrossSources({ ctx, query: 'alpha', sources: [personSources[0]] })

    expect(result).toEqual(['record-1'])
    const tokenQuery = queries.find((query) => query.table === 'search_tokens')
    expect(tokenQuery).toBeDefined()
    expect(tokenQuery?.conditions).not.toHaveProperty('organization_id')
  })

  it('matches nothing for an explicitly empty organization scope instead of searching tenant-wide', async () => {
    const { db, queries } = createRecordingDb({
      search_tokens: [{ entity_id: 'record-elsewhere' }],
      customer_people: [{ entity_id: 'person-elsewhere' }],
    })
    const ctx = createScopedCtx(db, { selectedOrganizationId: null, organizationIds: [] })

    const result = await findMatchingEntityIdsBySearchTokensAcrossSources({ ctx, query: 'alpha', sources: personSources })

    expect(result).toEqual([])
    expect(queries.some((query) => query.table === 'search_tokens')).toBe(false)
    expect(queries.some((query) => query.table === 'customer_people')).toBe(false)
  })
})

describe('customers api utils - findMatchingEntityIdsWithQueryEngine', () => {
  const PAGE_SIZE = 100

  function makeRows(count: number, offset = 0): Array<{ id: string }> {
    return Array.from({ length: count }, (_, index) => ({ id: `id-${offset + index}` }))
  }

  function createCtxWithQueryEngine(pages: Array<Array<{ id: string }>>, total: number) {
    const calls: number[] = []
    const qe = {
      async query(_entity: string, opts: { page?: { page?: number } }) {
        const page = opts.page?.page ?? 1
        calls.push(page)
        return { items: pages[page - 1] ?? [], total }
      },
    }
    const ctx = {
      auth: { tenantId: 'tenant-1' },
      selectedOrganizationId: 'org-1',
      container: { resolve: (key: string) => (key === 'queryEngine' ? qe : undefined) },
    } as any
    return { ctx, calls }
  }

  it('enumerates every page even when total under-reports the result set', async () => {
    const pages = [makeRows(PAGE_SIZE), makeRows(PAGE_SIZE, PAGE_SIZE), makeRows(10, PAGE_SIZE * 2)]
    const { ctx, calls } = createCtxWithQueryEngine(pages, 5)

    const ids = await findMatchingEntityIdsWithQueryEngine({
      ctx,
      entityId: 'customers:customer_entity' as any,
      filters: {},
    })

    expect(ids).toHaveLength(PAGE_SIZE * 2 + 10)
    expect(calls).toEqual([1, 2, 3])
  })

  it('terminates on a short final page instead of trusting an inflated total', async () => {
    const pages = [makeRows(PAGE_SIZE), makeRows(3, PAGE_SIZE)]
    const { ctx, calls } = createCtxWithQueryEngine(pages, 10_000)

    const ids = await findMatchingEntityIdsWithQueryEngine({
      ctx,
      entityId: 'customers:customer_entity' as any,
      filters: {},
    })

    expect(ids).toHaveLength(PAGE_SIZE + 3)
    expect(calls).toEqual([1, 2])
  })

  it('terminates when pages repeat duplicate ids (previously an infinite loop)', async () => {
    // Old shape looped `while (ids.size < total)`: duplicates keep the Set's size below
    // an inflated total forever, so only an empty page could stop it. Full pages of the
    // same 100 ids now stop at the page ceiling by throwing instead of spinning.
    const repeated = makeRows(PAGE_SIZE)
    const pages = Array.from({ length: 2000 }, () => repeated)
    const { ctx, calls } = createCtxWithQueryEngine(pages, PAGE_SIZE * 2000)

    await expect(
      findMatchingEntityIdsWithQueryEngine({
        ctx,
        entityId: 'customers:customer_entity' as any,
        filters: {},
      }),
    ).rejects.toThrow(/exceeded 1000 pages/)
    expect(calls).toHaveLength(1000)
  })

  it('throws at the page ceiling rather than returning a partial id set', async () => {
    const pages = Array.from({ length: 2000 }, (_, index) => makeRows(PAGE_SIZE, index * PAGE_SIZE))
    const { ctx } = createCtxWithQueryEngine(pages, PAGE_SIZE * 2000)

    await expect(
      findMatchingEntityIdsWithQueryEngine({
        ctx,
        entityId: 'customers:customer_entity' as any,
        filters: {},
      }),
    ).rejects.toThrow(/refusing to return a partial id set/)
  })
})
