/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AttachmentDocumentExtraction,
  AttachmentDocumentSection,
  AttachmentPartition,
} from '../../../data/entities'
import handle from '../../../workers/document-structure'
import {
  DOCUMENT_STRUCTURE_QUEUE_DI_KEY,
  documentSectionSearchJobSchema,
  documentStructureJobSchema,
  documentStructureQueueJobSchema,
  enqueueDocumentSectionSearch,
  isDocumentSectionSearchJob,
  type DocumentStructureQueueJob,
  type EnqueueDocumentSectionSearchInput,
} from '../queue'
import {
  DOCUMENT_SECTION_SEARCH_ENTITY_TYPE,
  runDocumentSectionSearchSync,
  type DocumentSectionSearchSyncDeps,
} from '../sectionSearchSync'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
  findWithDecryption: jest.fn(async () => []),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const EXTRACTION_ID = '33333333-3333-4333-8333-333333333333'
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444'

type SectionRow = {
  id: string
  ordinal: number
  extractionId: string
  tenantId: string | null
  organizationId: string | null
}

type Where = {
  id?: { $in: string[] }
  extractionId?: string
  tenantId?: string | null
  organizationId?: string | null
  ordinal?: { $gt: number }
}

type FindOptions = { limit?: number }

const findWithDecryptionMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

function sectionId(index: number): string {
  return `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`
}

function buildSections(count: number, overrides: Partial<SectionRow> = {}): SectionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: sectionId(index + 1),
    ordinal: index,
    extractionId: EXTRACTION_ID,
    tenantId: TENANT,
    organizationId: ORG,
    ...overrides,
  }))
}

function installSectionStore(rows: SectionRow[]): void {
  findWithDecryptionMock.mockImplementation((async (
    _em: unknown,
    entity: unknown,
    where: Where,
    options?: FindOptions,
  ) => {
    if (entity !== AttachmentDocumentSection) return []
    const matching = rows
      .filter((row) => (where.extractionId === undefined ? true : row.extractionId === where.extractionId))
      .filter((row) => (where.id === undefined ? true : where.id.$in.includes(row.id)))
      .filter((row) => row.tenantId === where.tenantId && row.organizationId === where.organizationId)
      .filter((row) => (where.ordinal === undefined ? true : row.ordinal > where.ordinal.$gt))
      .sort((left, right) => left.ordinal - right.ordinal)
    return options?.limit !== undefined ? matching.slice(0, options.limit) : matching
  }) as unknown as typeof findWithDecryption)
}

function createDeps(overrides: Partial<DocumentSectionSearchSyncDeps> = {}) {
  const emitEvent = jest.fn(async (_event: string, _payload: Record<string, unknown>) => undefined)
  const enqueue = jest.fn(async (_input: EnqueueDocumentSectionSearchInput) => 'job-id')
  const deps: DocumentSectionSearchSyncDeps = {
    em: {} as EntityManager,
    eventBus: { emitEvent },
    enqueue,
    ...overrides,
  }
  return { deps, emitEvent, enqueue }
}

beforeEach(() => {
  jest.clearAllMocks()
  findWithDecryptionMock.mockImplementation((async () => []) as unknown as typeof findWithDecryption)
  findOneWithDecryptionMock.mockImplementation((async () => null) as unknown as typeof findOneWithDecryption)
})

describe('document structure queue job schema', () => {
  it('keeps parsing legacy extract payloads without a kind', () => {
    const legacy = { attachmentId: ATTACHMENT_ID, tenantId: TENANT, organizationId: ORG, force: true }
    expect(documentStructureJobSchema.parse(legacy)).toEqual(legacy)
    expect(documentStructureQueueJobSchema.parse(legacy)).toEqual(legacy)
    expect(isDocumentSectionSearchJob(legacy)).toBe(false)
  })

  it('accepts a section-search job targeting one extraction', () => {
    const job = { kind: 'section-search', mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: EXTRACTION_ID }
    expect(documentStructureQueueJobSchema.parse(job)).toEqual(job)
    expect(isDocumentSectionSearchJob(job)).toBe(true)
  })

  it('rejects unknown keys, missing or multiple targets and stray afterOrdinal', () => {
    const base = { kind: 'section-search', mode: 'delete', tenantId: TENANT, organizationId: ORG }
    expect(documentSectionSearchJobSchema.safeParse(base).success).toBe(false)
    expect(
      documentSectionSearchJobSchema.safeParse({ ...base, extractionId: EXTRACTION_ID, sectionIds: [sectionId(1)] }).success,
    ).toBe(false)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, extractionId: EXTRACTION_ID, extra: 1 }).success).toBe(false)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, sectionIds: [sectionId(1)], afterOrdinal: 3 }).success).toBe(false)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, sectionIds: ['not-a-uuid'] }).success).toBe(false)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, mode: 'reindex', extractionId: EXTRACTION_ID }).success).toBe(false)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, partitionCode: 'contracts' }).success).toBe(true)
  })

  it('accepts partition jobs scoped to all tenants or one tenant and rejects stray cursors', () => {
    const base = { kind: 'section-search', mode: 'index', partitionCode: 'contracts' }
    expect(documentSectionSearchJobSchema.safeParse({ ...base, tenantId: null, organizationId: null }).success).toBe(true)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, tenantId: TENANT, organizationId: null }).success).toBe(true)
    expect(documentSectionSearchJobSchema.safeParse({ ...base, tenantId: null, organizationId: ORG }).success).toBe(false)
    expect(
      documentSectionSearchJobSchema.safeParse({ ...base, tenantId: TENANT, organizationId: ORG, afterExtractionId: EXTRACTION_ID })
        .success,
    ).toBe(true)
    expect(
      documentSectionSearchJobSchema.safeParse({
        kind: 'section-search',
        mode: 'index',
        tenantId: TENANT,
        organizationId: ORG,
        extractionId: EXTRACTION_ID,
        afterExtractionId: EXTRACTION_ID,
      }).success,
    ).toBe(false)
  })
})

describe('enqueueDocumentSectionSearch', () => {
  it('enqueues a validated payload on the registered queue', async () => {
    const enqueue = jest.fn(async () => 'job-1')
    const container = {
      hasRegistration: (name: string) => name === DOCUMENT_STRUCTURE_QUEUE_DI_KEY,
      resolve: <T,>() => ({ enqueue }) as T,
    }
    const jobId = await enqueueDocumentSectionSearch(container, {
      mode: 'index',
      tenantId: TENANT,
      organizationId: ORG,
      extractionId: EXTRACTION_ID,
      afterOrdinal: 199,
    })
    expect(jobId).toBe('job-1')
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'section-search',
      mode: 'index',
      tenantId: TENANT,
      organizationId: ORG,
      extractionId: EXTRACTION_ID,
      afterOrdinal: 199,
    })
  })

  it('accepts a tenant-wide partition job', async () => {
    const enqueue = jest.fn(async () => 'job-2')
    const container = { hasRegistration: () => true, resolve: <T,>() => ({ enqueue }) as T }
    await enqueueDocumentSectionSearch(container, { mode: 'delete', tenantId: TENANT, organizationId: null, partitionCode: 'contracts' })
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'section-search',
      mode: 'delete',
      tenantId: TENANT,
      organizationId: null,
      partitionCode: 'contracts',
    })
  })

  it('rejects half-scoped payloads', async () => {
    const container = { hasRegistration: () => true, resolve: <T,>() => ({ enqueue: jest.fn() }) as T }
    await expect(
      enqueueDocumentSectionSearch(container, { mode: 'index', tenantId: TENANT, organizationId: null, extractionId: EXTRACTION_ID }),
    ).rejects.toThrow('[internal]')
  })
})

describe('runDocumentSectionSearchSync', () => {
  it('emits upserts for one page and enqueues a continuation when the page is full', async () => {
    installSectionStore(buildSections(5))
    const { deps, emitEvent, enqueue } = createDeps({ pageSize: 2 })
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: EXTRACTION_ID },
      deps,
    )
    expect(outcome).toEqual({ kind: 'synced', emitted: 2, continuation: true })
    expect(emitEvent).toHaveBeenNthCalledWith(1, 'query_index.upsert_one', {
      entityType: DOCUMENT_SECTION_SEARCH_ENTITY_TYPE,
      recordId: sectionId(1),
      tenantId: TENANT,
      organizationId: ORG,
    })
    expect(emitEvent).toHaveBeenNthCalledWith(2, 'query_index.upsert_one', expect.objectContaining({ recordId: sectionId(2) }))
    expect(enqueue).toHaveBeenCalledWith({
      mode: 'index',
      tenantId: TENANT,
      organizationId: ORG,
      extractionId: EXTRACTION_ID,
      afterOrdinal: 1,
    })
  })

  it('resumes after the given ordinal and stops on a short page', async () => {
    installSectionStore(buildSections(5))
    const { deps, emitEvent, enqueue } = createDeps({ pageSize: 2 })
    const outcome = await runDocumentSectionSearchSync(
      {
        kind: 'section-search',
        mode: 'delete',
        tenantId: TENANT,
        organizationId: ORG,
        extractionId: EXTRACTION_ID,
        afterOrdinal: 3,
      },
      deps,
    )
    expect(outcome).toEqual({ kind: 'synced', emitted: 1, continuation: false })
    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledWith('query_index.delete_one', expect.objectContaining({ recordId: sectionId(5) }))
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('never reads sections of another tenant', async () => {
    installSectionStore(buildSections(3, { tenantId: '66666666-6666-4666-8666-666666666666' }))
    const { deps, emitEvent } = createDeps()
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: EXTRACTION_ID },
      deps,
    )
    expect(outcome).toEqual({ kind: 'synced', emitted: 0, continuation: false })
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('deletes explicit ids in chunks without reading the database', async () => {
    const ids = [sectionId(1), sectionId(2), sectionId(3), sectionId(1)]
    const { deps, emitEvent, enqueue } = createDeps({ pageSize: 2 })
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'delete', tenantId: TENANT, organizationId: ORG, sectionIds: ids },
      deps,
    )
    expect(outcome).toEqual({ kind: 'synced', emitted: 3, continuation: false })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(emitEvent.mock.calls.map((call) => call[1])).toEqual(
      [sectionId(1), sectionId(2), sectionId(3)].map((recordId) => ({
        entityType: DOCUMENT_SECTION_SEARCH_ENTITY_TYPE,
        recordId,
        tenantId: TENANT,
        organizationId: ORG,
      })),
    )
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('indexes only explicit ids that exist in the job scope', async () => {
    installSectionStore([
      ...buildSections(2),
      { id: sectionId(9), ordinal: 9, extractionId: EXTRACTION_ID, tenantId: null, organizationId: null },
    ])
    const { deps, emitEvent } = createDeps()
    const outcome = await runDocumentSectionSearchSync(
      {
        kind: 'section-search',
        mode: 'index',
        tenantId: TENANT,
        organizationId: ORG,
        sectionIds: [sectionId(2), sectionId(9)],
      },
      deps,
    )
    expect(outcome).toEqual({ kind: 'synced', emitted: 1, continuation: false })
    expect(emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ recordId: sectionId(2) }))
  })

  it('skips tenant-less scopes', async () => {
    const { deps, emitEvent } = createDeps()
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: null, organizationId: null, extractionId: EXTRACTION_ID },
      deps,
    )
    expect(outcome).toEqual({ kind: 'skipped', reason: 'tenantless' })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('reports failures instead of throwing', async () => {
    installSectionStore(buildSections(1))
    const { deps } = createDeps({
      eventBus: { emitEvent: jest.fn(async () => { throw new Error('bus down') }) },
    })
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: EXTRACTION_ID },
      deps,
    )
    expect(outcome).toEqual({ kind: 'failed' })
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'attachments',
      code: 'attachments.document_structure_search_failed',
    })
  })

  it('reports invalid payloads', async () => {
    const { deps } = createDeps()
    const outcome = await runDocumentSectionSearchSync({ kind: 'section-search', mode: 'index' }, deps)
    expect(outcome).toEqual({ kind: 'failed' })
    expect(mockReportError).toHaveBeenCalledTimes(1)
  })
})

describe('partition section search fan-out', () => {
  const OTHER_TENANT = '77777777-7777-4777-8777-777777777777'
  const OTHER_ORG = '88888888-8888-4888-8888-888888888888'

  type ExtractionRow = {
    id: string
    tenantId: string | null
    organizationId: string | null
    partitionCode: string
    status: string
    deletedAt: Date | null
    stats: Record<string, unknown> | null
  }

  type PartitionRow = { code: string; tenantId: string | null; organizationId: string | null; indexDocumentSections: boolean }

  function extractionId(index: number): string {
    return `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`
  }

  function extraction(index: number, overrides: Partial<ExtractionRow> = {}): ExtractionRow {
    return {
      id: extractionId(index),
      tenantId: TENANT,
      organizationId: ORG,
      partitionCode: 'contracts',
      status: 'completed',
      deletedAt: null,
      stats: { pages: 1 },
      ...overrides,
    }
  }

  function matchesScope(actual: string | null, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && '$ne' in expected) return true
    return actual === expected
  }

  const extractionQueries: Record<string, unknown>[] = []

  function installPartitionStore(partitions: PartitionRow[], extractions: ExtractionRow[]): void {
    extractionQueries.length = 0
    findOneWithDecryptionMock.mockImplementation((async (_em: unknown, entity: unknown, where: { code?: string }) => {
      if (entity !== AttachmentPartition) return null
      return partitions.find((row) => row.code === where.code) ?? null
    }) as unknown as typeof findOneWithDecryption)
    findWithDecryptionMock.mockImplementation((async (
      _em: unknown,
      entity: unknown,
      where: Record<string, unknown>,
      options?: FindOptions,
    ) => {
      if (entity !== AttachmentDocumentExtraction) return []
      extractionQueries.push(where)
      const statuses = (where.status as { $in: string[] }).$in
      const after = (where.id as { $gt?: string } | undefined)?.$gt
      const matching = extractions
        .filter((row) => row.partitionCode === where.partitionCode && row.deletedAt === null)
        .filter((row) => statuses.includes(row.status))
        .filter((row) => matchesScope(row.tenantId, where.tenantId) && matchesScope(row.organizationId, where.organizationId))
        .filter((row) => (after === undefined ? true : row.id > after))
        .sort((left, right) => left.id.localeCompare(right.id))
      return options?.limit !== undefined ? matching.slice(0, options.limit) : matching
    }) as unknown as typeof findWithDecryption)
  }

  function createFanOutDeps(partitionPageSize?: number) {
    const nativeUpdate = jest.fn(async () => 1)
    const { deps, emitEvent, enqueue } = createDeps({
      em: { nativeUpdate } as unknown as EntityManager,
      ...(partitionPageSize !== undefined ? { partitionPageSize } : {}),
    })
    return { deps, emitEvent, enqueue, nativeUpdate }
  }

  const globalIndexing: PartitionRow = { code: 'contracts', tenantId: null, organizationId: null, indexDocumentSections: true }

  it('fans out one page of a global partition across tenants, flags extractions and enqueues a continuation', async () => {
    installPartitionStore(
      [globalIndexing],
      [
        extraction(1),
        extraction(2, { tenantId: OTHER_TENANT, organizationId: OTHER_ORG }),
        extraction(3),
        extraction(4, { status: 'failed' }),
        extraction(5, { deletedAt: new Date(0) }),
      ],
    )
    const { deps, emitEvent, enqueue, nativeUpdate } = createFanOutDeps(2)
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: null, organizationId: null, partitionCode: 'contracts' },
      deps,
    )
    expect(outcome).toEqual({ kind: 'fanned_out', enqueued: 2, skippedTenantless: 0, continuation: true })
    expect(extractionQueries[0]).toEqual(
      expect.objectContaining({ tenantId: { $ne: null }, organizationId: { $ne: null }, deletedAt: null }),
    )
    expect(nativeUpdate).toHaveBeenCalledWith(
      AttachmentDocumentExtraction,
      { id: extractionId(1), tenantId: TENANT, organizationId: ORG },
      { stats: { pages: 1, searchIndexed: true } },
    )
    expect(nativeUpdate).toHaveBeenCalledWith(
      AttachmentDocumentExtraction,
      { id: extractionId(2), tenantId: OTHER_TENANT, organizationId: OTHER_ORG },
      { stats: { pages: 1, searchIndexed: true } },
    )
    expect(enqueue.mock.calls.map((call) => call[0])).toEqual([
      { mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: extractionId(1) },
      { mode: 'index', tenantId: OTHER_TENANT, organizationId: OTHER_ORG, extractionId: extractionId(2) },
      {
        mode: 'index',
        tenantId: null,
        organizationId: null,
        partitionCode: 'contracts',
        afterExtractionId: extractionId(2),
      },
    ])
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('resumes after the cursor, skips tenant-less extractions and stops on a short page', async () => {
    installPartitionStore(
      [globalIndexing],
      [extraction(1), extraction(2), extraction(3), extraction(4, { tenantId: null, organizationId: null })],
    )
    const { deps, enqueue, nativeUpdate } = createFanOutDeps(5)
    const outcome = await runDocumentSectionSearchSync(
      {
        kind: 'section-search',
        mode: 'index',
        tenantId: null,
        organizationId: null,
        partitionCode: 'contracts',
        afterExtractionId: extractionId(2),
      },
      deps,
    )
    expect(outcome).toEqual({ kind: 'fanned_out', enqueued: 1, skippedTenantless: 1, continuation: false })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith({ mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: extractionId(3) })
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('limits a tenant partition to its own tenant and clears the flag on delete', async () => {
    installPartitionStore(
      [{ code: 'contracts', tenantId: TENANT, organizationId: ORG, indexDocumentSections: false }],
      [
        extraction(1, { stats: { searchIndexed: true } }),
        extraction(2, { tenantId: OTHER_TENANT, organizationId: OTHER_ORG, stats: { searchIndexed: true } }),
      ],
    )
    const { deps, enqueue, nativeUpdate } = createFanOutDeps()
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'delete', tenantId: TENANT, organizationId: null, partitionCode: 'contracts' },
      deps,
    )
    expect(outcome).toEqual({ kind: 'fanned_out', enqueued: 1, skippedTenantless: 0, continuation: false })
    expect(extractionQueries[0]).toEqual(expect.objectContaining({ tenantId: TENANT, organizationId: { $ne: null } }))
    expect(nativeUpdate).toHaveBeenCalledWith(
      AttachmentDocumentExtraction,
      { id: extractionId(1), tenantId: TENANT, organizationId: ORG },
      { stats: { searchIndexed: false } },
    )
    expect(enqueue).toHaveBeenCalledWith({ mode: 'delete', tenantId: TENANT, organizationId: ORG, extractionId: extractionId(1) })
  })

  it('skips when the partition indexing state no longer matches the job mode', async () => {
    installPartitionStore([{ ...globalIndexing, indexDocumentSections: false }], [extraction(1)])
    const { deps, enqueue, nativeUpdate } = createFanOutDeps()
    const outcome = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: null, organizationId: null, partitionCode: 'contracts' },
      deps,
    )
    expect(outcome).toEqual({ kind: 'skipped', reason: 'partition_state_mismatch' })
    expect(enqueue).not.toHaveBeenCalled()
    expect(nativeUpdate).not.toHaveBeenCalled()
  })

  it('skips unknown partitions and partitions owned by another tenant', async () => {
    installPartitionStore(
      [{ code: 'contracts', tenantId: OTHER_TENANT, organizationId: OTHER_ORG, indexDocumentSections: true }],
      [extraction(1)],
    )
    const { deps, enqueue } = createFanOutDeps()
    const missing = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: null, organizationId: null, partitionCode: 'unknown' },
      deps,
    )
    const foreign = await runDocumentSectionSearchSync(
      { kind: 'section-search', mode: 'index', tenantId: TENANT, organizationId: null, partitionCode: 'contracts' },
      deps,
    )
    expect(missing).toEqual({ kind: 'skipped', reason: 'partition_not_found' })
    expect(foreign).toEqual({ kind: 'skipped', reason: 'partition_scope_mismatch' })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('document structure worker dispatch', () => {
  function createContext() {
    const emitEvent = jest.fn(async () => undefined)
    const em = { fork: () => em }
    const services: Record<string, unknown> = {
      em,
      eventBus: { emitEvent },
      storageDriverFactory: { resolveForPartition: jest.fn() },
    }
    const ctx = {
      jobId: 'job',
      attemptNumber: 1,
      queueName: 'attachments-document-structure',
      resolve: <T,>(name: string): T => {
        if (!(name in services)) throw new Error(`missing ${name}`)
        return services[name] as T
      },
    }
    return { ctx, emitEvent }
  }

  function queued(payload: DocumentStructureQueueJob): QueuedJob<DocumentStructureQueueJob> {
    return { id: 'job', payload, createdAt: new Date(0).toISOString() }
  }

  it('routes section-search jobs to the search sync', async () => {
    installSectionStore(buildSections(1))
    const { ctx, emitEvent } = createContext()
    await handle(
      queued({ kind: 'section-search', mode: 'index', tenantId: TENANT, organizationId: ORG, extractionId: EXTRACTION_ID }),
      ctx,
    )
    expect(emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ recordId: sectionId(1) }))
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('routes legacy payloads to the extraction run', async () => {
    const { ctx, emitEvent } = createContext()
    await handle(queued({ attachmentId: ATTACHMENT_ID, tenantId: TENANT, organizationId: ORG }), ctx)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
