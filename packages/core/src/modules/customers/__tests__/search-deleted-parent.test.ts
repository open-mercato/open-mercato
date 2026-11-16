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

type ParentState = 'active' | 'soft-deleted' | 'missing'

function makeQueryEngine(state: ParentState) {
  const calls: QueryOptions[] = []
  const engine: QueryEngine = {
    query: jest.fn(async (_entity: string, opts: QueryOptions = {}) => {
      calls.push(opts)
      const parent = { id: 'parent-1', kind: 'person', display_name: 'Ghost Person', deleted_at: state === 'soft-deleted' ? '2026-11-01T00:00:00Z' : null }
      const visible = state === 'active' || (state === 'soft-deleted' && opts.withDeleted === true)
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

  it.each(['soft-deleted', 'missing'] as const)('excludes the profile and builds no source when the parent is %s', async (state) => {
    const { engine, calls } = makeQueryEngine(state)

    await expect(config.isRecordExcluded!(makeContext(kind, engine))).resolves.toBe(true)
    await expect(config.buildSource!(makeContext(kind, engine))).resolves.toBeNull()
    expect(calls.some((opts) => opts.withDeleted === true)).toBe(true)
  })

  it('keeps the profile searchable while the parent is active, without an extra lookup', async () => {
    const { engine, calls } = makeQueryEngine('active')

    await expect(config.isRecordExcluded!(makeContext(kind, engine))).resolves.toBe(false)
    await expect(config.buildSource!(makeContext(kind, engine))).resolves.toEqual(expect.objectContaining({ text: expect.any(Array) }))
    expect(calls.some((opts) => opts.withDeleted === true)).toBe(false)
  })

  it('does not exclude the profile when no query engine is available', async () => {
    await expect(config.isRecordExcluded!(makeContext(kind))).resolves.toBe(false)
  })
})
