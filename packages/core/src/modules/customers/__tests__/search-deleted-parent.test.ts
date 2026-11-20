jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import type { SearchBuildContext } from '@open-mercato/shared/modules/search'
import { searchConfig } from '../search'

const encryptionPolicyContainer = { resolve: () => ({ getEncryptedFieldNames: async () => [] }) }

type ParentState = 'active' | 'soft-deleted' | 'missing' | 'first-lookup-empty'

function makeQueryEngine(state: ParentState) {
  const calls: QueryOptions[] = []
  const engine: QueryEngine = {
    query: jest.fn(async (_entity: string, opts: QueryOptions = {}) => {
      calls.push(opts)
      const parent = { id: 'parent-1', kind: 'person', display_name: 'Ghost Person', deleted_at: state === 'soft-deleted' ? '2026-11-01T00:00:00Z' : null }
      const visible = state === 'active' || ((state === 'soft-deleted' || state === 'first-lookup-empty') && opts.withDeleted === true)
      const items = visible ? [parent] : []
      return { items, page: 1, pageSize: 1, total: items.length } as QueryResult<Record<string, unknown>>
    }) as QueryEngine['query'],
  }
  return { engine, calls }
}

function makeContext(kind: 'person' | 'company', queryEngine?: QueryEngine): SearchBuildContext {
  return {
    container: encryptionPolicyContainer,
    tenantId: 'tenant-ghost',
    organizationId: 'org-ghost',
    record: { id: `profile-${kind}`, entity_id: 'parent-1', first_name: 'Ghost', brand_name: 'Ghost Co' },
    customFields: {},
    queryEngine,
  }
}

describe.each(['person', 'company'] as const)('customers %s profile search with a deleted parent (#8638)', (kind) => {
  const config = searchConfig.entities.find((entity) => entity.entityId === `customers:customer_${kind}_profile`)!

  it.each(['soft-deleted', 'missing'] as const)('rejects the profile in shouldIndex and builds no source when the parent is %s', async (state) => {
    const { engine, calls } = makeQueryEngine(state)

    await expect(config.shouldIndex!(makeContext(kind, engine))).resolves.toBe(false)
    await expect(config.buildSource!(makeContext(kind, engine))).resolves.toBeNull()
    expect(calls.some((opts) => opts.withDeleted === true)).toBe(true)
  })

  it('keeps the profile searchable while the parent is active', async () => {
    const { engine } = makeQueryEngine('active')

    await expect(config.shouldIndex!(makeContext(kind, engine))).resolves.toBe(true)
    await expect(config.buildSource!(makeContext(kind, engine))).resolves.toEqual(expect.objectContaining({ text: expect.any(Array) }))
  })

  it('checks the parent without adding keys to the record it gates', async () => {
    const { engine } = makeQueryEngine('active')
    const ctx = makeContext(kind, engine)
    const before = { ...ctx.record }

    await expect(config.shouldIndex!(ctx)).resolves.toBe(true)
    expect(ctx.record).toEqual(before)
  })

  it('indexes the profile when the withDeleted lookup finds an active parent', async () => {
    const { engine, calls } = makeQueryEngine('first-lookup-empty')

    await expect(config.shouldIndex!(makeContext(kind, engine))).resolves.toBe(true)
    expect(calls.some((opts) => opts.withDeleted === true)).toBe(true)
  })

  it('runs the withDeleted lookup once per record across shouldIndex and buildSource', async () => {
    const { engine, calls } = makeQueryEngine('soft-deleted')
    const ctx = makeContext(kind, engine)

    await expect(config.shouldIndex!(ctx)).resolves.toBe(false)
    await expect(config.buildSource!(ctx)).resolves.toBeNull()
    expect(calls.filter((opts) => opts.withDeleted === true)).toHaveLength(1)
  })

  it('does not build the source when the parent check fails, and builds it once the check recovers', async () => {
    const failing: QueryEngine = {
      query: jest.fn(async (_entity: string, opts: QueryOptions = {}) => {
        if (opts.withDeleted === true) throw new Error('[internal] lookup failed')
        return { items: [], page: 1, pageSize: 1, total: 0 } as QueryResult<Record<string, unknown>>
      }) as QueryEngine['query'],
    }

    await expect(config.shouldIndex!(makeContext(kind, failing))).rejects.toThrow('lookup failed')
    await expect(config.buildSource!(makeContext(kind, failing))).rejects.toThrow('lookup failed')

    const { engine } = makeQueryEngine('first-lookup-empty')
    const retryCtx = makeContext(kind, engine)
    await expect(config.shouldIndex!(retryCtx)).resolves.toBe(true)
    await expect(config.buildSource!(retryCtx)).resolves.toEqual(expect.objectContaining({ text: expect.any(Array) }))
  })

  it('resolves the parent through the profile row when the record carries no entity id, without mutating it', async () => {
    const calls: Array<{ entity: string; opts: QueryOptions }> = []
    const engine: QueryEngine = {
      query: jest.fn(async (entity: string, opts: QueryOptions = {}) => {
        calls.push({ entity, opts })
        const items = entity.endsWith('_profile')
          ? [{ id: `profile-${kind}`, entity_id: 'parent-1' }]
          : opts.withDeleted === true
            ? [{ id: 'parent-1', deleted_at: '2026-11-01T00:00:00Z' }]
            : []
        return { items, page: 1, pageSize: 1, total: items.length } as QueryResult<Record<string, unknown>>
      }) as QueryEngine['query'],
    }
    const ctx = makeContext(kind, engine)
    delete ctx.record.entity_id
    const before = { ...ctx.record }

    await expect(config.shouldIndex!(ctx)).resolves.toBe(false)
    expect(ctx.record).toEqual(before)
    expect(calls.map((call) => call.entity)).toEqual([`customers:customer_${kind}_profile`, 'customers:customer_entity'])
    expect(calls[1].opts.withDeleted).toBe(true)
  })

  it('fails closed when the profile lookup for a record without an entity id throws', async () => {
    const failing: QueryEngine = {
      query: jest.fn(async () => {
        throw new Error('[internal] profile lookup failed')
      }) as QueryEngine['query'],
    }
    const ctx = makeContext(kind, failing)
    delete ctx.record.entity_id

    await expect(config.shouldIndex!(ctx)).rejects.toThrow('profile lookup failed')
  })

  it('indexes the profile when no query engine is available', async () => {
    await expect(config.shouldIndex!(makeContext(kind))).resolves.toBe(true)
  })
})
