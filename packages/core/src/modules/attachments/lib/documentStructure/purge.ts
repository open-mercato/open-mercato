import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AttachmentDocumentExtraction, AttachmentDocumentSection } from '../../data/entities'
import { assertAttachmentScopeInvariant } from '../access'
import { enqueueDocumentSectionSearch, type DocumentStructureQueueContainer } from './queue'

export const SECTION_SEARCH_DELETE_CHUNK_SIZE = 500

const logger = createLogger('attachments').child({ component: 'document-structure-purge' })

type IndexedSectionDatabase = {
  attachment_document_sections: {
    id: string
    extraction_id: string
    attachment_id: string
    tenant_id: string | null
    organization_id: string | null
  }
  attachment_document_extractions: {
    id: string
    attachment_id: string
    tenant_id: string | null
    organization_id: string | null
    stats: unknown
  }
}

export type PurgeDocumentStructureInput = {
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
}

export type PurgeDocumentStructureOptions = {
  /**
   * `false` runs the scoped deletes on the passed entity manager so they join the caller's
   * ambient transaction; otherwise both deletes commit together in their own transaction.
   */
  flush?: boolean
}

export type PurgeDocumentStructureResult = {
  extractionCount: number
  sectionCount: number
  indexedSectionIds: string[]
}

type PurgeScope = { tenantId: string | null; organizationId: string | null }

async function selectIndexedSectionIds(
  em: EntityManager,
  attachmentId: string,
  scope: PurgeScope,
): Promise<string[]> {
  let query = em
    .getKysely<IndexedSectionDatabase>()
    .selectFrom('attachment_document_sections as section')
    .innerJoin('attachment_document_extractions as extraction', 'extraction.id', 'section.extraction_id')
    .select('section.id')
    .where('section.attachment_id', '=', attachmentId)
    .where('extraction.attachment_id', '=', attachmentId)
    .where(sql<boolean>`(${sql.ref('extraction.stats')} ->> 'searchIndexed') = 'true'`)
  query = scope.tenantId === null
    ? query.where('section.tenant_id', 'is', null).where('extraction.tenant_id', 'is', null)
    : query.where('section.tenant_id', '=', scope.tenantId).where('extraction.tenant_id', '=', scope.tenantId)
  query = scope.organizationId === null
    ? query.where('section.organization_id', 'is', null).where('extraction.organization_id', 'is', null)
    : query
      .where('section.organization_id', '=', scope.organizationId)
      .where('extraction.organization_id', '=', scope.organizationId)
  const rows = await query.orderBy('section.id').execute()
  return rows.map((row) => String(row.id))
}

/**
 * Enqueues `section-search` delete jobs for sections a purge removed. Call it only after the purge
 * committed. Failures are logged and reported, never thrown, so they cannot fail the delete.
 */
export async function enqueuePurgedSectionSearchDelete(
  scope: PurgeScope,
  sectionIds: readonly string[],
  container: DocumentStructureQueueContainer | null = null,
): Promise<void> {
  for (let start = 0; start < sectionIds.length; start += SECTION_SEARCH_DELETE_CHUNK_SIZE) {
    const chunk = sectionIds.slice(start, start + SECTION_SEARCH_DELETE_CHUNK_SIZE)
    try {
      await enqueueDocumentSectionSearch(container, {
        mode: 'delete',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        sectionIds: chunk,
      })
    } catch (error) {
      logger.error('Failed to enqueue section search cleanup after document structure purge', {
        err: error,
        sectionCount: chunk.length,
      })
      getTelemetryRuntime()?.reportError(error, {
        module: 'attachments',
        code: 'attachments.section_search_delete_enqueue_failed',
      })
    }
  }
}

export async function purgeDocumentStructure(
  em: EntityManager,
  input: PurgeDocumentStructureInput,
  options: PurgeDocumentStructureOptions = {},
): Promise<PurgeDocumentStructureResult> {
  const scope = { tenantId: input.tenantId ?? null, organizationId: input.organizationId ?? null }
  assertAttachmentScopeInvariant(scope)
  const where = {
    attachmentId: input.attachmentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  const deleteRows = async (target: EntityManager): Promise<PurgeDocumentStructureResult> => {
    const indexedSectionIds = await selectIndexedSectionIds(target, input.attachmentId, scope)
    const sectionCount = await target.nativeDelete(AttachmentDocumentSection, where)
    const extractionCount = await target.nativeDelete(AttachmentDocumentExtraction, where)
    return { extractionCount, sectionCount, indexedSectionIds }
  }
  if (options.flush === false) return deleteRows(em)
  return em.transactional((tx) => deleteRows(tx))
}
