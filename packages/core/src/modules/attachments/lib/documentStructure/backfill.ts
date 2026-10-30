import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment, AttachmentDocumentExtraction, AttachmentPartition } from '../../data/entities'
import type { ExtractionStatus } from './types'
import type { EnqueueDocumentStructureInput } from './queue'

export const DOCUMENT_STRUCTURE_BACKFILL_PAGE_SIZE = 100

const SETTLED_STATUSES: ReadonlySet<ExtractionStatus> = new Set(['completed', 'partial', 'skipped', 'pending'])

export type DocumentStructureBackfillOptions = {
  em: EntityManager
  enqueue: (input: EnqueueDocumentStructureInput) => Promise<string>
  tenantId: string
  organizationId?: string | null
  partitionCode?: string | null
  belowEngineVersion?: number | null
  limit?: number | null
  dryRun?: boolean
  pageSize?: number
}

export type DocumentStructureBackfillTarget = {
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
  partitionCode: string
  force: boolean
}

export type DocumentStructureBackfillResult = {
  partitions: string[]
  scanned: number
  targets: DocumentStructureBackfillTarget[]
  enqueued: number
}

function partitionAppliesToScope(partition: AttachmentPartition, tenantId: string, organizationId: string | null): boolean {
  const partitionTenantId = partition.tenantId ?? null
  const partitionOrganizationId = partition.organizationId ?? null
  if (partitionTenantId === null && partitionOrganizationId === null) return true
  if (partitionTenantId !== tenantId) return false
  return organizationId === null || partitionOrganizationId === organizationId
}

function partitionAppliesToAttachment(partition: AttachmentPartition, attachment: Attachment): boolean {
  const partitionTenantId = partition.tenantId ?? null
  const partitionOrganizationId = partition.organizationId ?? null
  if (partitionTenantId === null && partitionOrganizationId === null) return true
  return partitionTenantId === (attachment.tenantId ?? null) && partitionOrganizationId === (attachment.organizationId ?? null)
}

function needsExtraction(
  liveExtractions: AttachmentDocumentExtraction[],
  belowEngineVersion: number | null,
): { selected: boolean; force: boolean } {
  if (belowEngineVersion !== null) {
    const outdated = liveExtractions.some(
      (extraction) => extraction.status !== 'pending' && extraction.engineVersion < belowEngineVersion,
    )
    return { selected: outdated, force: true }
  }
  const settled = liveExtractions.some((extraction) => SETTLED_STATUSES.has(extraction.status))
  return { selected: !settled, force: false }
}

export async function runDocumentStructureBackfill(
  options: DocumentStructureBackfillOptions,
): Promise<DocumentStructureBackfillResult> {
  const { em, tenantId } = options
  const organizationId = options.organizationId ?? null
  const belowEngineVersion = options.belowEngineVersion ?? null
  const limit = options.limit ?? null
  const pageSize = Math.max(1, Math.min(options.pageSize ?? DOCUMENT_STRUCTURE_BACKFILL_PAGE_SIZE, 1000))

  const partitionWhere: Record<string, unknown> = { extractDocumentStructure: true }
  if (options.partitionCode) partitionWhere.code = options.partitionCode
  const partitions = (await findWithDecryption(em, AttachmentPartition, partitionWhere))
    .filter((partition) => partitionAppliesToScope(partition, tenantId, organizationId))
  const partitionsByCode = new Map(partitions.map((partition) => [partition.code, partition]))
  const result: DocumentStructureBackfillResult = {
    partitions: Array.from(partitionsByCode.keys()),
    scanned: 0,
    targets: [],
    enqueued: 0,
  }
  if (partitionsByCode.size === 0) return result

  let cursor: string | null = null
  while (limit === null || result.targets.length < limit) {
    const where: Record<string, unknown> = {
      tenantId,
      partitionCode: { $in: result.partitions },
    }
    if (organizationId) where.organizationId = organizationId
    if (cursor) where.id = { $gt: cursor }
    const page: Attachment[] = await findWithDecryption(
      em,
      Attachment,
      where,
      { fields: ['id', 'tenantId', 'organizationId', 'partitionCode'], orderBy: { id: 'asc' }, limit: pageSize },
      { tenantId, organizationId },
    )
    if (page.length === 0) break
    cursor = page[page.length - 1].id
    result.scanned += page.length

    const eligible = page.filter((attachment) => {
      const partition = partitionsByCode.get(attachment.partitionCode)
      return partition ? partitionAppliesToAttachment(partition, attachment) : false
    })
    const extractions = eligible.length
      ? await findWithDecryption(
          em,
          AttachmentDocumentExtraction,
          { attachmentId: { $in: eligible.map((attachment) => attachment.id) }, deletedAt: null },
          { fields: ['id', 'attachmentId', 'status', 'engineVersion'] },
          { tenantId, organizationId },
        )
      : []
    const extractionsByAttachment = new Map<string, AttachmentDocumentExtraction[]>()
    for (const extraction of extractions) {
      const bucket = extractionsByAttachment.get(extraction.attachmentId) ?? []
      bucket.push(extraction)
      extractionsByAttachment.set(extraction.attachmentId, bucket)
    }

    for (const attachment of eligible) {
      if (limit !== null && result.targets.length >= limit) break
      const decision = needsExtraction(extractionsByAttachment.get(attachment.id) ?? [], belowEngineVersion)
      if (!decision.selected) continue
      const target: DocumentStructureBackfillTarget = {
        attachmentId: attachment.id,
        tenantId: attachment.tenantId ?? null,
        organizationId: attachment.organizationId ?? null,
        partitionCode: attachment.partitionCode,
        force: decision.force,
      }
      result.targets.push(target)
      if (options.dryRun) continue
      await options.enqueue({
        attachmentId: target.attachmentId,
        tenantId: target.tenantId,
        organizationId: target.organizationId,
        force: target.force,
      })
      result.enqueued += 1
    }
    if (page.length < pageSize) break
  }
  return result
}
