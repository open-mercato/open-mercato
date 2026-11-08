/** @jest-environment node */
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '../../data/entities'
import { DefaultAttachmentService } from '../attachment-service'
import type { StorageDriverFactory } from '../drivers'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args),
  findWithDecryption: async (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args),
}))

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const mockClearThumbnailCache = jest.fn(async (_partitionCode: string, _attachmentId: string) => undefined)
jest.mock('../thumbnailCache', () => ({
  clearAttachmentThumbnailCache: (partitionCode: string, attachmentId: string) => mockClearThumbnailCache(partitionCode, attachmentId),
}))

type Row = {
  id: string
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
  partitionCode: string
  storagePath: string
  storageMetadata: Record<string, unknown> | null
}

const EMAIL = { entityId: 'inbox_ops:inbox_email', recordId: 'email-1' }
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    entityId: EMAIL.entityId,
    recordId: EMAIL.recordId,
    ...scope,
    partitionCode: 'privateAttachments',
    storagePath: `objects/${id}`,
    storageMetadata: { assignments: [{ type: EMAIL.entityId, id: EMAIL.recordId }] },
    ...overrides,
  }
}

function hasAssignment(metadata: Row['storageMetadata'], probe: unknown): boolean {
  const target = (probe as { assignments: unknown }).assignments
  const stored = metadata?.assignments
  const same = (left: unknown, right: unknown) => {
    const a = left as Record<string, unknown> | null
    const b = right as Record<string, unknown>
    return Boolean(a) && a!.type === b.type && a!.id === b.id
  }
  if (Array.isArray(target)) return Array.isArray(stored) && target.every((wanted) => stored.some((entry) => same(entry, wanted)))
  return !Array.isArray(stored) && same(stored, target)
}

/**
 * A database double behind a real Kysely compiler: the service's queries are compiled to
 * PostgreSQL exactly as in production, then answered from `committed` rows. Changes made through
 * the ORM double become visible only on flush, as in a real transaction.
 */
function createHarness(initial: Row[], options: { afterQuery?: (query: CompiledQuery, committed: Map<string, Row>) => void } = {}) {
  const committed = new Map(initial.map((entry) => [entry.id, structuredClone(entry)]))
  const queries: CompiledQuery[] = []
  const events: string[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      try {
        return answer<R>(query)
      } finally {
        options.afterQuery?.(query, committed)
      }
    },
    async *streamQuery() { /* not used */ },
  }
  function answer<R>(query: CompiledQuery): QueryResult<R> {
    queries.push(query)
    const params = query.parameters as unknown[]
    const rows = [...committed.values()].sort((left, right) => (left.id < right.id ? -1 : 1))
    const ownedBy = () => {
      const [tenantId, organizationId, entityId, recordId, arrayProbe, objectProbe] = params as [string, string, string, string, string, string]
      return rows.filter((entry) => entry.tenantId === tenantId && entry.organizationId === organizationId && (
        (entry.entityId === entityId && entry.recordId === recordId)
        || hasAssignment(entry.storageMetadata, JSON.parse(arrayProbe))
        || hasAssignment(entry.storageMetadata, JSON.parse(objectProbe))
      ))
    }
    if (query.sql.includes('select distinct "partition_code"')) {
      const codes = [...new Set(ownedBy().map((entry) => entry.partitionCode))]
      return { rows: codes.map((code) => ({ partition_code: code })) as R[] }
    }
    if (query.sql.includes('"storage_metadata" @>')) {
      const owned = ownedBy()
      // Storage siblings of any scope are locked in the same statement.
      const matched = rows.filter((entry) => owned.some((candidate) => (
        candidate.id === entry.id
        || (candidate.partitionCode === entry.partitionCode && candidate.storagePath === entry.storagePath)
      )))
      return { rows: matched.map((entry) => ({ id: entry.id })) as R[] }
    }
    const [partitionCode, storagePath] = params as [string, string]
    return {
      rows: rows
        .filter((entry) => entry.partitionCode === partitionCode && entry.storagePath === storagePath)
        .map((entry) => ({ id: entry.id })) as R[],
    }
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() { return connection },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  let loaded = new Map<string, Row>()
  let pendingRemovals = new Set<string>()
  const tx = {
    getKysely: () => db,
    find: jest.fn(async (entity: unknown, where: { id: { $in: string[] }; tenantId: string; organizationId: string }) => {
      expect(entity).toBe(Attachment)
      return where.id.$in
        .map((id) => committed.get(id))
        .filter((entry): entry is Row => Boolean(entry) && entry!.tenantId === where.tenantId && entry!.organizationId === where.organizationId)
        .map((entry) => {
          const copy = structuredClone(entry)
          loaded.set(copy.id, copy)
          return copy
        })
    }),
    remove: jest.fn((entry: Row) => { pendingRemovals.add(entry.id) }),
    flush: jest.fn(async () => {
      for (const [id, entry] of loaded) committed.set(id, structuredClone(entry))
      for (const id of pendingRemovals) committed.delete(id)
      events.push('flush')
    }),
  }
  let inTransaction = false
  const em = {
    getKysely: () => db,
    isInTransaction: jest.fn(() => inTransaction),
    transactional: jest.fn(async (work: (inner: typeof tx) => Promise<void>) => {
      loaded = new Map()
      pendingRemovals = new Set()
      inTransaction = true
      try {
        await work(tx)
        events.push('commit')
      } catch (error) {
        loaded = new Map()
        pendingRemovals = new Set()
        events.push('rollback')
        throw error
      } finally {
        inTransaction = false
      }
    }),
  }
  const providerDelete = jest.fn(async (partitionCode: string, storagePath: string) => {
    events.push(`delete:${partitionCode}/${storagePath}`)
  })
  const factory = { resolveForPartition: jest.fn(async () => ({ delete: providerDelete })) }
  const service = new DefaultAttachmentService(em as unknown as EntityManager, factory as unknown as StorageDriverFactory)
  const release = () => service.releaseOwnedScoped({ owner: EMAIL, ...scope })
  return { service, release, committed, queries, events, providerDelete, factory, em, tx }
}

beforeEach(() => {
  mockClearThumbnailCache.mockClear()
  mockReportError.mockClear()
})

describe('DefaultAttachmentService.releaseOwnedScoped', () => {
  it('locks owner references and their storage siblings in one id-ordered, index-friendly statement', async () => {
    const { release, queries } = createHarness([row('a')])
    await release()
    const lookup = queries.find((query) => /for update/.test(query.sql))!
    const normalized = lookup.sql.replace(/\s+/g, ' ')
    expect(normalized).toContain(
      'with "owned" as ( select "id", "partition_code", "storage_path" from "attachments" where "tenant_id" = $1 and "organization_id" = $2 '
      + 'and (("entity_id" = $3 and "record_id" = $4) or "storage_metadata" @> $5::jsonb or "storage_metadata" @> $6::jsonb) )',
    )
    expect(normalized).toContain('join "owned" on "sibling"."partition_code" = "owned"."partition_code" and "sibling"."storage_path" = "owned"."storage_path"')
    expect(normalized).toMatch(/order by "attachments"\."id" for update of "attachments"$/)
    expect(lookup.parameters).toEqual([
      'tenant-1', 'org-1', EMAIL.entityId, EMAIL.recordId,
      JSON.stringify({ assignments: [{ type: EMAIL.entityId, id: EMAIL.recordId }] }),
      JSON.stringify({ assignments: { type: EMAIL.entityId, id: EMAIL.recordId } }),
    ])
  })

  it('keeps the bytes for a sibling committed after the combined lock, reading references without a second lock', async () => {
    const { release, committed, providerDelete, queries } = createHarness([row('m', { storagePath: 'objects/shared' })], {
      // A copy of the stored object commits right after the id-ordered lock statement.
      afterQuery: (query, rows) => {
        if (query.sql.includes('"storage_metadata" @>') && !rows.has('a-late')) {
          rows.set('a-late', row('a-late', { storagePath: 'objects/shared', entityId: 'messages:message', recordId: 'message-1', storageMetadata: null }))
        }
      },
    })

    await expect(release()).resolves.toEqual({ deleted: 1, repointed: 0, detached: 0 })

    expect([...committed.keys()]).toEqual(['a-late'])
    expect(providerDelete).not.toHaveBeenCalled()
    const lockIndex = queries.findIndex((query) => /for update/.test(query.sql))
    const referenceReads = queries.slice(lockIndex + 1)
    expect(referenceReads).toHaveLength(1)
    expect(referenceReads[0].sql).not.toMatch(/for update/i)
  })

  it('leaves a locked storage sibling of another owner or scope untouched', async () => {
    const { release, committed, providerDelete } = createHarness([
      row('a', { storagePath: 'objects/shared' }),
      row('z', { storagePath: 'objects/shared', organizationId: 'org-2', entityId: 'documents:document', recordId: 'document-9', storageMetadata: { assignments: [{ type: 'documents:document', id: 'document-9' }] } }),
    ])
    await expect(release()).resolves.toEqual({ deleted: 1, repointed: 0, detached: 0 })
    expect([...committed.keys()]).toEqual(['z'])
    expect(committed.get('z')).toMatchObject({ entityId: 'documents:document', organizationId: 'org-2' })
    expect(providerDelete).not.toHaveBeenCalled()
  })

  it('deletes email-owned rows without other assignments and releases bytes only with the last reference', async () => {
    const { release, committed, providerDelete, events } = createHarness([
      row('a'),
      row('b1', { storagePath: 'objects/shared' }),
      row('b2', { storagePath: 'objects/shared' }),
      row('c', { storagePath: 'objects/kept' }),
      row('d', { storagePath: 'objects/kept', entityId: 'documents:document', recordId: 'document-1', storageMetadata: { assignments: [{ type: 'documents:document', id: 'document-1' }] } }),
      row('e', { storageMetadata: null }),
    ])

    await expect(release()).resolves.toEqual({ deleted: 5, repointed: 0, detached: 0 })

    expect([...committed.keys()]).toEqual(['d'])
    expect(providerDelete.mock.calls).toEqual([
      ['privateAttachments', 'objects/a'],
      ['privateAttachments', 'objects/shared'],
      ['privateAttachments', 'objects/e'],
    ])
    expect(events.indexOf('commit')).toBeLessThan(events.findIndex((event) => event.startsWith('delete:')))
    expect(mockClearThumbnailCache.mock.calls.map(([, id]) => id)).toEqual(['a', 'b1', 'b2', 'c', 'e'])
  })

  it('resolves the storage driver once per partition within one call', async () => {
    const { release, factory, providerDelete } = createHarness([
      row('a'),
      row('b'),
      row('c', { partitionCode: 'otherPartition' }),
    ])

    await expect(release()).resolves.toEqual({ deleted: 3, repointed: 0, detached: 0 })

    expect(providerDelete).toHaveBeenCalledTimes(3)
    expect(factory.resolveForPartition.mock.calls).toEqual([
      ['privateAttachments', scope],
      ['otherPartition', scope],
    ])
  })

  it('resolves the drivers of the owner\'s partitions before the transaction, and a partition first seen under the lock inside it', async () => {
    const { release, factory, em, events, providerDelete } = createHarness([row('a'), row('c', { partitionCode: 'otherPartition' })], {
      afterQuery: (query, rows) => {
        // A row in a new partition gains the email assignment between the pre-read and the lock.
        if (query.sql.includes('select distinct "partition_code"')) rows.set('n', row('n', { partitionCode: 'latePartition' }))
      },
    })
    const resolvedInTransaction: boolean[] = []
    factory.resolveForPartition.mockImplementation(async () => {
      resolvedInTransaction.push(em.isInTransaction())
      return { delete: providerDelete }
    })

    await expect(release()).resolves.toEqual({ deleted: 3, repointed: 0, detached: 0 })

    expect(factory.resolveForPartition.mock.calls.map(([code]) => code)).toEqual(['privateAttachments', 'otherPartition', 'latePartition'])
    expect(resolvedInTransaction).toEqual([false, false, true])
    expect(events.filter((event) => event.startsWith('delete:'))).toHaveLength(3)
  })

  it('does not fail the release when a pre-resolved partition is only re-pointed, and retries a failed resolution under the lock', async () => {
    const { release, factory, providerDelete } = createHarness([
      row('a'),
      row('k', { partitionCode: 'brokenPartition', storageMetadata: { assignments: [{ type: EMAIL.entityId, id: EMAIL.recordId }, { type: 'documents:document', id: 'document-1' }] } }),
    ])
    factory.resolveForPartition.mockImplementation((async (code: string) => {
      if (code === 'brokenPartition') throw new Error('vault down')
      return { delete: providerDelete }
    }) as never)

    await expect(release()).resolves.toEqual({ deleted: 1, repointed: 1, detached: 0 })
    expect(providerDelete).toHaveBeenCalledTimes(1)
  })

  it('re-points an email-owned row with other assignments to the first remaining one in stored order', async () => {
    const { release, committed, providerDelete } = createHarness([
      row('a', { storageMetadata: { tags: ['offer'], assignments: [
        { type: EMAIL.entityId, id: EMAIL.recordId },
        { type: 'messages:message', id: 'message-1' },
        { type: 'documents:document', id: 'document-1' },
      ] } }),
      row('b', { storageMetadata: { assignments: [
        { type: 'sales:sales_order', id: 'order-1' },
        { type: EMAIL.entityId, id: EMAIL.recordId },
      ] } }),
    ])

    await expect(release()).resolves.toEqual({ deleted: 0, repointed: 2, detached: 0 })

    expect(committed.get('a')).toMatchObject({
      entityId: 'messages:message', recordId: 'message-1',
      storageMetadata: { tags: ['offer'], assignments: [{ type: 'messages:message', id: 'message-1' }, { type: 'documents:document', id: 'document-1' }] },
    })
    expect(committed.get('b')).toMatchObject({
      entityId: 'sales:sales_order', recordId: 'order-1',
      storageMetadata: { assignments: [{ type: 'sales:sales_order', id: 'order-1' }] },
    })
    expect(providerDelete).not.toHaveBeenCalled()
    expect(mockClearThumbnailCache).not.toHaveBeenCalled()
  })

  it('only removes the email assignment from a row owned by something else, legacy object shape included', async () => {
    const { release, committed, providerDelete } = createHarness([
      row('library', { entityId: 'attachments:library', recordId: 'library', storageMetadata: { assignments: [
        { type: 'documents:document', id: 'document-1' },
        { type: EMAIL.entityId, id: EMAIL.recordId },
      ] } }),
      row('legacy', { entityId: 'sync_excel:upload', recordId: 'upload-1', storageMetadata: { assignments: { type: EMAIL.entityId, id: EMAIL.recordId } } }),
    ])

    await expect(release()).resolves.toEqual({ deleted: 0, repointed: 0, detached: 2 })

    expect(committed.get('library')).toMatchObject({
      entityId: 'attachments:library', recordId: 'library',
      storageMetadata: { assignments: [{ type: 'documents:document', id: 'document-1' }] },
    })
    expect(committed.get('legacy')).toMatchObject({ entityId: 'sync_excel:upload', storageMetadata: { assignments: [] } })
    expect(providerDelete).not.toHaveBeenCalled()
  })

  it('leaves rows of another email or another organization untouched', async () => {
    const { release, committed } = createHarness([
      row('other-email', { recordId: 'email-2', storageMetadata: { assignments: [{ type: EMAIL.entityId, id: 'email-2' }] } }),
      row('other-org', { organizationId: 'org-2' }),
    ])

    await expect(release()).resolves.toEqual({ deleted: 0, repointed: 0, detached: 0 })

    expect([...committed.keys()].sort()).toEqual(['other-email', 'other-org'])
  })

  it('is idempotent: a retry after success changes nothing and deletes no bytes', async () => {
    const { release, committed, providerDelete } = createHarness([
      row('a'),
      row('b', { storageMetadata: { assignments: [{ type: EMAIL.entityId, id: EMAIL.recordId }, { type: 'messages:message', id: 'message-1' }] } }),
      row('c', { entityId: 'attachments:library', recordId: 'library', storageMetadata: { assignments: [{ type: EMAIL.entityId, id: EMAIL.recordId }] } }),
    ])

    await expect(release()).resolves.toEqual({ deleted: 1, repointed: 1, detached: 1 })
    const afterFirst = structuredClone([...committed.entries()])
    providerDelete.mockClear()

    await expect(release()).resolves.toEqual({ deleted: 0, repointed: 0, detached: 0 })

    expect([...committed.entries()]).toEqual(afterFirst)
    expect(providerDelete).not.toHaveBeenCalled()
  })

  it('deletes no bytes when the transaction rolls back', async () => {
    const { release, committed, providerDelete, tx } = createHarness([row('a')])
    tx.flush.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(release()).rejects.toThrow('database unavailable')

    expect(committed.has('a')).toBe(true)
    expect(providerDelete).not.toHaveBeenCalled()
    expect(mockClearThumbnailCache).not.toHaveBeenCalled()
  })

  it('attempts every provider cleanup after commit and reports a failure instead of throwing', async () => {
    const { release, committed, providerDelete } = createHarness([row('a'), row('b')])
    const failure = new Error('provider down')
    providerDelete.mockRejectedValueOnce(failure)

    await expect(release()).resolves.toEqual({ deleted: 2, repointed: 0, detached: 0 })

    expect(committed.size).toBe(0)
    expect(providerDelete).toHaveBeenCalledTimes(2)
    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      module: 'attachments',
      code: 'attachments.release_cleanup_failed',
      attributes: { attachmentId: 'a' },
    }))
  })

  it('refuses to run inside an ambient transaction', async () => {
    const { service, em } = createHarness([row('a')])
    em.isInTransaction.mockReturnValue(true)

    await expect(service.releaseOwnedScoped({ owner: EMAIL, ...scope })).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 500 })
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('refuses an owner or scope that is missing', async () => {
    const { service, em } = createHarness([row('a')])

    await expect(service.releaseOwnedScoped({ owner: { entityId: EMAIL.entityId, recordId: ' ' }, ...scope })).rejects.toMatchObject({ status: 500 })
    await expect(service.releaseOwnedScoped({ owner: EMAIL, tenantId: 'tenant-1', organizationId: '' })).rejects.toMatchObject({ status: 500 })
    expect(em.transactional).not.toHaveBeenCalled()
  })
})
