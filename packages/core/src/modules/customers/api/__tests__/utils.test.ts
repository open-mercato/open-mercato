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
