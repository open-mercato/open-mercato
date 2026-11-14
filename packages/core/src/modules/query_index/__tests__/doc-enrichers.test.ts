import type { Kysely } from 'kysely'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import {
  applyIndexDocEnrichers,
  getIndexDocEnrichers,
  hasIndexDocEnrichers,
  isIndexDocEnrichedKey,
  registerIndexDocEnricher,
  resetIndexDocEnrichers,
  type IndexDocEnricher,
  type IndexDocEnrichmentTarget,
} from '../lib/doc-enrichers'
import { attachAggregateSearchField } from '../lib/document'
import { buildSearchTokenRows } from '../lib/search-tokens'
import { upsertIndexBatch } from '../lib/batch'
import { buildIndexDoc } from '../lib/indexer'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

const mockRecordIndexerError = recordIndexerError as jest.MockedFunction<typeof recordIndexerError>

const ENTITY = 'catalog:catalog_product'
const fakeDb = {} as Kysely<any>

function makeEnricher(overrides: Partial<IndexDocEnricher> = {}): IndexDocEnricher {
  return {
    id: 'catalog.scope_keys',
    entityType: ENTITY,
    keys: ['scope_keys'],
    enrich: jest.fn(async (records) => new Map(records.map((record) => [record.recordId, { scope_keys: [`cat:${record.recordId}`] }]))),
    ...overrides,
  }
}

function target(recordId: string, doc: Record<string, unknown> = {}, scope: { tenantId?: string | null; organizationId?: string | null } = {}): IndexDocEnrichmentTarget {
  return {
    recordId,
    doc: { id: recordId, ...doc },
    tenantId: scope.tenantId === undefined ? 'tenant-1' : scope.tenantId,
    organizationId: scope.organizationId === undefined ? 'org-1' : scope.organizationId,
  }
}

beforeEach(() => {
  resetIndexDocEnrichers()
  jest.clearAllMocks()
})

afterAll(() => {
  resetIndexDocEnrichers()
})

describe('index doc enricher registry', () => {
  it('registers, lists and unregisters an enricher', () => {
    const unregister = registerIndexDocEnricher(makeEnricher())
    expect(hasIndexDocEnrichers(ENTITY)).toBe(true)
    expect(getIndexDocEnrichers(ENTITY).map((entry) => entry.id)).toEqual(['catalog.scope_keys'])
    expect(isIndexDocEnrichedKey(ENTITY, 'scope_keys')).toBe(true)
    expect(isIndexDocEnrichedKey('example:todo', 'scope_keys')).toBe(false)
    unregister()
    expect(hasIndexDocEnrichers(ENTITY)).toBe(false)
    expect(isIndexDocEnrichedKey(ENTITY, 'scope_keys')).toBe(false)
  })

  it('replaces a registration with the same id instead of duplicating it', () => {
    registerIndexDocEnricher(makeEnricher())
    registerIndexDocEnricher(makeEnricher({ keys: ['scope_keys', 'scope_version'] }))
    const enrichers = getIndexDocEnrichers(ENTITY)
    expect(enrichers).toHaveLength(1)
    expect(enrichers[0].keys).toEqual(['scope_keys', 'scope_version'])
  })

  it.each([
    ['cf:scope_keys'],
    ['l10n:en:title'],
    ['ScopeKeys'],
    ['scope-keys'],
    [''],
  ])('rejects key %p outside the snake_case namespace', (key) => {
    expect(() => registerIndexDocEnricher(makeEnricher({ keys: [key] }))).toThrow('[internal]')
  })

  it.each([['id'], ['tenant_id'], ['organization_id'], ['search_text'], ['deleted_at']])('rejects reserved key %p', (key) => {
    expect(() => registerIndexDocEnricher(makeEnricher({ keys: [key] }))).toThrow(/reserved/)
  })

  it('rejects a key already contributed by another enricher of the same entity type', () => {
    registerIndexDocEnricher(makeEnricher())
    expect(() => registerIndexDocEnricher(makeEnricher({ id: 'other.enricher' }))).toThrow(/already contributed/)
    expect(() => registerIndexDocEnricher(makeEnricher({ id: 'other.enricher', entityType: 'catalog:catalog_offer' }))).not.toThrow()
  })

  it('rejects an enricher without keys, id or entity type', () => {
    expect(() => registerIndexDocEnricher(makeEnricher({ keys: [] }))).toThrow('[internal]')
    expect(() => registerIndexDocEnricher(makeEnricher({ id: ' ' }))).toThrow('[internal]')
    expect(() => registerIndexDocEnricher(makeEnricher({ entityType: 'catalog_product' }))).toThrow('[internal]')
  })
})

describe('applyIndexDocEnrichers', () => {
  it('leaves documents untouched when no enricher is registered', async () => {
    const targets = [target('p1', { title: 'A' })]
    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)
    expect(targets[0].doc).toEqual({ id: 'p1', title: 'A' })
  })

  it('calls each enricher once per tenant/organization scope and merges the declared keys', async () => {
    const enricher = makeEnricher()
    registerIndexDocEnricher(enricher)
    const targets = [
      target('p1'),
      target('p2'),
      target('p3', {}, { organizationId: 'org-2' }),
    ]

    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)

    const enrich = enricher.enrich as jest.Mock
    expect(enrich).toHaveBeenCalledTimes(2)
    expect(enrich.mock.calls[0][0].map((record: { recordId: string }) => record.recordId)).toEqual(['p1', 'p2'])
    expect(enrich.mock.calls[0][1]).toEqual({ db: fakeDb, entityType: ENTITY, tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(enrich.mock.calls[1][1]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-2' })
    expect(targets.map((entry) => entry.doc.scope_keys)).toEqual([['cat:p1'], ['cat:p2'], ['cat:p3']])
  })

  it('writes null for a record the enricher returned nothing for', async () => {
    registerIndexDocEnricher(makeEnricher({
      enrich: async () => new Map([['p1', { scope_keys: [] }]]),
    }))
    const targets = [target('p1'), target('p2')]
    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)
    expect(targets[0].doc.scope_keys).toEqual([])
    expect(targets[1].doc.scope_keys).toBeNull()
  })

  it('fails closed with null keys and records the error when the enricher throws', async () => {
    registerIndexDocEnricher(makeEnricher({
      keys: ['scope_keys', 'scope_version'],
      enrich: async () => { throw new Error('assignments unavailable') },
    }))
    const targets = [target('p1', { title: 'A' })]

    await expect(applyIndexDocEnrichers(fakeDb, ENTITY, targets)).resolves.toBeUndefined()

    expect(targets[0].doc).toEqual({ id: 'p1', title: 'A', scope_keys: null, scope_version: null })
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'query_index',
      code: 'query_index.doc_enricher_failed',
    })
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      { db: fakeDb },
      expect.objectContaining({
        source: 'query_index',
        handler: 'query_index:doc-enricher',
        entityType: ENTITY,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('treats a non-Map result as a failure', async () => {
    registerIndexDocEnricher(makeEnricher({
      enrich: async () => ({ p1: { scope_keys: ['cat:x'] } }) as unknown as Map<string, Record<string, unknown>>,
    }))
    const targets = [target('p1')]
    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)
    expect(targets[0].doc.scope_keys).toBeNull()
    expect(mockRecordIndexerError).toHaveBeenCalledTimes(1)
  })

  it('never overwrites a base document key and reports the collision', async () => {
    registerIndexDocEnricher(makeEnricher())
    const targets = [target('p1', { scope_keys: 'base-column-value' })]
    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)
    expect(targets[0].doc.scope_keys).toBe('base-column-value')
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      { db: fakeDb },
      expect.objectContaining({ handler: 'query_index:doc-enricher:collision', recordId: 'p1' }),
    )
  })

  it('reports a collision once per enricher key for the whole batch with a count and sample of ids', async () => {
    registerIndexDocEnricher(makeEnricher())
    const targets = ['p1', 'p2', 'p3'].map((id) => target(id, { scope_keys: `base-${id}` }))
    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)
    expect(targets.map((entry) => entry.doc.scope_keys)).toEqual(['base-p1', 'base-p2', 'base-p3'])
    expect(mockRecordIndexerError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      { db: fakeDb },
      expect.objectContaining({
        handler: 'query_index:doc-enricher:collision',
        recordId: null,
        payload: {
          enricherId: 'catalog.scope_keys',
          collidingKey: 'scope_keys',
          collidingRecordCount: 3,
          sampleRecordIds: ['p1', 'p2', 'p3'],
        },
      }),
    )
  })

  it('ignores keys the enricher did not declare', async () => {
    registerIndexDocEnricher(makeEnricher({
      enrich: async () => new Map([['p1', { scope_keys: ['tag:t1'], title: 'hijacked' }]]),
    }))
    const targets = [target('p1', { title: 'A' })]
    await applyIndexDocEnrichers(fakeDb, ENTITY, targets)
    expect(targets[0].doc).toEqual({ id: 'p1', title: 'A', scope_keys: ['tag:t1'] })
  })
})

describe('enriched keys stay out of search', () => {
  it('excludes enriched keys from the search_text aggregate and the token rows', () => {
    registerIndexDocEnricher(makeEnricher())
    const doc = { id: 'p1', title: 'Garden chair', scope_keys: ['cat:abc', 'tag:def'] }
    const config = { ...resolveSearchConfig(), enabled: true }

    const aggregated = attachAggregateSearchField({ ...doc }, { entityType: ENTITY, config })
    expect(String(aggregated.search_text)).not.toContain('cat:abc')
    expect(String(aggregated.search_text)).toContain('Garden chair')

    const rows = buildSearchTokenRows({ entityType: ENTITY, recordId: 'p1', organizationId: 'org-1', tenantId: 'tenant-1', doc, config })
    expect(rows.some((row) => row.field === 'scope_keys')).toBe(false)
    expect(rows.some((row) => row.field === 'title')).toBe(true)
  })
})

describe('indexer integration', () => {
  it('upsertIndexBatch enriches the whole batch with one call and writes the keys', async () => {
    const enricher = makeEnricher()
    registerIndexDocEnricher(enricher)
    const insertedDocs: Array<Record<string, unknown>> = []
    const chain = {
      select: () => chain,
      selectAll: () => chain,
      where: () => chain,
      execute: async () => [],
      executeTakeFirst: async () => undefined,
    }
    const insertChain = {
      values: (values: Array<{ doc: { toOperationNode: () => { parameters: Array<{ value: unknown }> } } }>) => {
        for (const value of values) {
          const serialized = value.doc.toOperationNode().parameters[0].value
          insertedDocs.push(JSON.parse(String(serialized)))
        }
        return insertChain
      },
      onConflict: () => insertChain,
      execute: async () => [],
    }
    const db = {
      selectFrom: () => chain,
      insertInto: () => insertChain,
      updateTable: () => chain,
      deleteFrom: () => chain,
    } as unknown as Kysely<any>

    const rows = ['p1', 'p2', 'p3'].map((id) => ({ id, title: `Product ${id}`, organization_id: 'org-1', tenant_id: 'tenant-1' }))
    const result = await upsertIndexBatch(db, ENTITY, rows, { orgId: 'org-1', tenantId: 'tenant-1' })

    expect(result.written).toBe(3)
    expect(enricher.enrich).toHaveBeenCalledTimes(1)
    expect(insertedDocs.map((doc) => doc.scope_keys)).toEqual([['cat:p1'], ['cat:p2'], ['cat:p3']])
    expect(insertedDocs.every((doc) => !String(doc.search_text ?? '').includes('cat:'))).toBe(true)
  })

  it('buildIndexDoc adds the enriched keys for a single record', async () => {
    registerIndexDocEnricher(makeEnricher())
    const chain = {
      select: () => chain,
      selectAll: () => chain,
      where: () => chain,
      execute: async () => [],
      executeTakeFirst: async () => ({ id: 'p1', title: 'Chair', organization_id: 'org-1', tenant_id: 'tenant-1' }),
    }
    const db = { selectFrom: () => chain }
    const em = { getKysely: () => db } as unknown as Parameters<typeof buildIndexDoc>[0]

    const doc = await buildIndexDoc(em, { entityType: ENTITY, recordId: 'p1', organizationId: 'org-1', tenantId: 'tenant-1' })

    expect(doc?.scope_keys).toEqual(['cat:p1'])
    expect(String(doc?.search_text)).not.toContain('cat:p1')
  })
})
