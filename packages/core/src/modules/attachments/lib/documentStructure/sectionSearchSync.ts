import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AttachmentDocumentSection } from '../../data/entities'
import {
  documentSectionSearchJobSchema,
  type DocumentSectionSearchJob,
  type EnqueueDocumentSectionSearchInput,
} from './queue'

export const DOCUMENT_SECTION_SEARCH_ENTITY_TYPE = 'attachments:attachment_document_section'
export const DOCUMENT_SECTION_SEARCH_PAGE_SIZE = 200

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
}

export type DocumentSectionSearchSyncOutcome =
  | { kind: 'synced'; emitted: number; continuation: boolean }
  | { kind: 'skipped'; reason: 'tenantless' | 'partition_fanout_not_handled' }
  | { kind: 'failed' }

type Scope = { tenantId: string; organizationId: string }

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
    if (job.tenantId === null || job.organizationId === null) {
      return { kind: 'skipped', reason: 'tenantless' }
    }
    const scope: Scope = { tenantId: job.tenantId, organizationId: job.organizationId }
    const pageSize = Math.max(1, Math.floor(deps.pageSize ?? DOCUMENT_SECTION_SEARCH_PAGE_SIZE))
    if (job.extractionId !== undefined) {
      return await syncExtractionPage({ ...job, extractionId: job.extractionId }, scope, deps, pageSize)
    }
    if (job.sectionIds !== undefined) {
      return await syncExplicitIds({ ...job, sectionIds: job.sectionIds }, scope, deps, pageSize)
    }
    logger.warn('Partition-wide section search sync is not handled by this job handler', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { kind: 'skipped', reason: 'partition_fanout_not_handled' }
  } catch (error) {
    logger.error('Document section search sync failed', { err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'attachments',
      code: 'attachments.document_structure_search_failed',
    })
    return { kind: 'failed' }
  }
}
