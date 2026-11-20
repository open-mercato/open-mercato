import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AttachmentDocumentExtraction, AttachmentDocumentSection, AttachmentPartition } from '../../data/entities'
import type { ExtractionStatus } from './types'
import {
  documentSectionSearchJobSchema,
  type DocumentSectionSearchJob,
  type EnqueueDocumentSectionSearchInput,
} from './queue'

export const DOCUMENT_SECTION_SEARCH_ENTITY_TYPE = 'attachments:attachment_document_section'
export const DOCUMENT_SECTION_SEARCH_PAGE_SIZE = 200
export const DOCUMENT_SECTION_SEARCH_PARTITION_PAGE_SIZE = 100

const PARTITION_FANOUT_STATUSES: ExtractionStatus[] = ['completed', 'partial']

const UPSERT_EVENT = 'query_index.upsert_one'
const DELETE_EVENT = 'query_index.delete_one'

const logger = createLogger('attachments').child({ component: 'document-section-search-sync' })

export type DocumentSectionSearchEventBus = {
  emitEvent(event: string, payload: Record<string, unknown>): Promise<unknown>
}

export type DocumentSectionSearchSyncDeps = {
  em: EntityManager
  eventBus: DocumentSectionSearchEventBus
  enqueue: (input: EnqueueDocumentSectionSearchInput) => Promise<string>
  pageSize?: number
  partitionPageSize?: number
}

export type DocumentSectionSearchSyncOutcome =
  | { kind: 'synced'; emitted: number; continuation: boolean }
  | { kind: 'fanned_out'; enqueued: number; skippedTenantless: number; continuation: boolean }
  | { kind: 'skipped'; reason: 'tenantless' | 'partition_not_found' | 'partition_state_mismatch' | 'partition_scope_mismatch' }
  | { kind: 'failed' }

type Scope = { tenantId: string; organizationId: string }

export type PartitionSectionSearchFanOutInput = {
  em: EntityManager
  enqueue: (input: EnqueueDocumentSectionSearchInput) => Promise<string>
  mode?: DocumentSectionSearchJob['mode']
  partitionCode: string
  tenantId: string | null
  organizationId: string | null
  afterExtractionId?: string | null
  pageSize?: number
  maxPages?: number | null
  dryRun?: boolean
}

export type PartitionSectionSearchFanOutResult =
  | {
      kind: 'fanned_out'
      mode: DocumentSectionSearchJob['mode']
      scanned: number
      enqueued: number
      skippedTenantless: number
      nextCursor: string | null
    }
  | { kind: 'partition_not_found' }
  | { kind: 'partition_state_mismatch'; indexDocumentSections: boolean }
  | { kind: 'partition_scope_mismatch' }

type ExtractionScopeFilter = { tenantId: unknown; organizationId: unknown }

function resolvePartitionExtractionScope(
  partition: AttachmentPartition,
  tenantId: string | null,
  organizationId: string | null,
): ExtractionScopeFilter | null {
  const partitionTenantId = partition.tenantId ?? null
  if (partitionTenantId !== null && tenantId !== null && partitionTenantId !== tenantId) return null
  const effectiveTenantId = tenantId ?? partitionTenantId
  if (effectiveTenantId === null) return { tenantId: { $ne: null }, organizationId: { $ne: null } }
  return organizationId !== null
    ? { tenantId: effectiveTenantId, organizationId }
    : { tenantId: effectiveTenantId, organizationId: { $ne: null } }
}

export async function fanOutPartitionSectionSearch(
  input: PartitionSectionSearchFanOutInput,
): Promise<PartitionSectionSearchFanOutResult> {
  const partition = await findOneWithDecryption(input.em, AttachmentPartition, { code: input.partitionCode })
  if (!partition) return { kind: 'partition_not_found' }
  const indexDocumentSections = partition.indexDocumentSections === true
  const mode = input.mode ?? (indexDocumentSections ? 'index' : 'delete')
  if (indexDocumentSections !== (mode === 'index')) {
    return { kind: 'partition_state_mismatch', indexDocumentSections }
  }
  const scopeFilter = resolvePartitionExtractionScope(partition, input.tenantId, input.organizationId)
  if (!scopeFilter) return { kind: 'partition_scope_mismatch' }
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? DOCUMENT_SECTION_SEARCH_PARTITION_PAGE_SIZE))
  const maxPages = input.maxPages ?? null
  const searchIndexed = mode === 'index'
  const result = { kind: 'fanned_out' as const, mode, scanned: 0, enqueued: 0, skippedTenantless: 0, nextCursor: null as string | null }
  let cursor = input.afterExtractionId ?? null
  for (let pageIndex = 0; maxPages === null || pageIndex < maxPages; pageIndex += 1) {
    const where: Record<string, unknown> = {
      partitionCode: input.partitionCode,
      deletedAt: null,
      status: { $in: PARTITION_FANOUT_STATUSES },
      ...scopeFilter,
    }
    if (cursor) where.id = { $gt: cursor }
    const page: AttachmentDocumentExtraction[] = await findWithDecryption(
      input.em,
      AttachmentDocumentExtraction,
      where,
      { fields: ['id', 'tenantId', 'organizationId', 'stats'], orderBy: { id: 'asc' }, limit: pageSize },
    )
    result.scanned += page.length
    for (const extraction of page) {
      const tenantId = extraction.tenantId ?? null
      const organizationId = extraction.organizationId ?? null
      if (tenantId === null || organizationId === null) {
        result.skippedTenantless += 1
        continue
      }
      if (input.dryRun) {
        result.enqueued += 1
        continue
      }
      await input.em.nativeUpdate(
        AttachmentDocumentExtraction,
        { id: extraction.id, tenantId, organizationId },
        { stats: { ...(extraction.stats ?? {}), searchIndexed } },
      )
      await input.enqueue({ mode, tenantId, organizationId, extractionId: extraction.id })
      result.enqueued += 1
    }
    const last = page[page.length - 1]
    if (page.length < pageSize || last === undefined) {
      result.nextCursor = null
      return result
    }
    cursor = last.id
    result.nextCursor = cursor
  }
  return result
}

async function syncPartition(
  job: DocumentSectionSearchJob & { partitionCode: string },
  deps: DocumentSectionSearchSyncDeps,
): Promise<DocumentSectionSearchSyncOutcome> {
  const fanOut = await fanOutPartitionSectionSearch({
    em: deps.em,
    enqueue: deps.enqueue,
    mode: job.mode,
    partitionCode: job.partitionCode,
    tenantId: job.tenantId,
    organizationId: job.organizationId,
    afterExtractionId: job.afterExtractionId ?? null,
    pageSize: deps.partitionPageSize,
    maxPages: 1,
  })
  if (fanOut.kind !== 'fanned_out') {
    logger.info('Partition section search sync skipped', { partitionCode: job.partitionCode, reason: fanOut.kind })
    return { kind: 'skipped', reason: fanOut.kind }
  }
  if (fanOut.nextCursor !== null) {
    await deps.enqueue({
      mode: job.mode,
      tenantId: job.tenantId,
      organizationId: job.organizationId,
      partitionCode: job.partitionCode,
      afterExtractionId: fanOut.nextCursor,
    })
  }
  return {
    kind: 'fanned_out',
    enqueued: fanOut.enqueued,
    skippedTenantless: fanOut.skippedTenantless,
    continuation: fanOut.nextCursor !== null,
  }
}

async function emitForIds(
  eventBus: DocumentSectionSearchEventBus,
  mode: DocumentSectionSearchJob['mode'],
  scope: Scope,
  recordIds: string[],
): Promise<number> {
  const event = mode === 'index' ? UPSERT_EVENT : DELETE_EVENT
  for (const recordId of recordIds) {
    await eventBus.emitEvent(event, {
      entityType: DOCUMENT_SECTION_SEARCH_ENTITY_TYPE,
      recordId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }
  return recordIds.length
}

async function syncExtractionPage(
  job: DocumentSectionSearchJob & { extractionId: string },
  scope: Scope,
  deps: DocumentSectionSearchSyncDeps,
  pageSize: number,
): Promise<DocumentSectionSearchSyncOutcome> {
  const sections = await findWithDecryption(
    deps.em,
    AttachmentDocumentSection,
    {
      extractionId: job.extractionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(job.afterOrdinal !== undefined ? { ordinal: { $gt: job.afterOrdinal } } : {}),
    },
    { fields: ['id', 'ordinal'], orderBy: { ordinal: 'asc' }, limit: pageSize },
    scope,
  )
  const emitted = await emitForIds(
    deps.eventBus,
    job.mode,
    scope,
    sections.map((section) => section.id),
  )
  const lastSection = sections[sections.length - 1]
  const continuation = sections.length >= pageSize && lastSection !== undefined
  if (continuation) {
    await deps.enqueue({
      mode: job.mode,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      extractionId: job.extractionId,
      afterOrdinal: lastSection.ordinal,
    })
  }
  return { kind: 'synced', emitted, continuation }
}

async function syncExplicitIds(
  job: DocumentSectionSearchJob & { sectionIds: string[] },
  scope: Scope,
  deps: DocumentSectionSearchSyncDeps,
  pageSize: number,
): Promise<DocumentSectionSearchSyncOutcome> {
  const uniqueIds = Array.from(new Set(job.sectionIds))
  let emitted = 0
  for (let offset = 0; offset < uniqueIds.length; offset += pageSize) {
    const chunk = uniqueIds.slice(offset, offset + pageSize)
    if (job.mode === 'delete') {
      emitted += await emitForIds(deps.eventBus, 'delete', scope, chunk)
      continue
    }
    const sections = await findWithDecryption(
      deps.em,
      AttachmentDocumentSection,
      { id: { $in: chunk }, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { fields: ['id', 'ordinal'], orderBy: { ordinal: 'asc' } },
      scope,
    )
    emitted += await emitForIds(
      deps.eventBus,
      'index',
      scope,
      sections.map((section) => section.id),
    )
  }
  return { kind: 'synced', emitted, continuation: false }
}

export async function runDocumentSectionSearchSync(
  rawPayload: unknown,
  deps: DocumentSectionSearchSyncDeps,
): Promise<DocumentSectionSearchSyncOutcome> {
  try {
    const job = documentSectionSearchJobSchema.parse(rawPayload)
    if (job.partitionCode !== undefined) {
      return await syncPartition({ ...job, partitionCode: job.partitionCode }, deps)
    }
    if (job.tenantId === null || job.organizationId === null) {
      return { kind: 'skipped', reason: 'tenantless' }
    }
    const scope: Scope = { tenantId: job.tenantId, organizationId: job.organizationId }
    const pageSize = Math.max(1, Math.floor(deps.pageSize ?? DOCUMENT_SECTION_SEARCH_PAGE_SIZE))
    if (job.extractionId !== undefined) {
      return await syncExtractionPage({ ...job, extractionId: job.extractionId }, scope, deps, pageSize)
    }
    return await syncExplicitIds({ ...job, sectionIds: job.sectionIds ?? [] }, scope, deps, pageSize)
  } catch (error) {
    logger.error('Document section search sync failed', { err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'attachments',
      code: 'attachments.document_structure_search_failed',
    })
    return { kind: 'failed' }
  }
}
