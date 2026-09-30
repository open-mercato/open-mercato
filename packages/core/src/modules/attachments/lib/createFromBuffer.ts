import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { Attachment, AttachmentPartition } from '../data/entities'
import { StorageDriverFactory } from './drivers'
import { ensureDefaultPartitions, resolveDefaultPartitionCode } from './partitions'
import { buildAttachmentFileUrl } from './imageUrls'
import { mergeAttachmentMetadata, upsertAssignment } from './metadata'
import { assertAttachmentScopeInvariant } from './access'
import { attachmentCrudEvents, attachmentCrudIndexer } from './crud'

/** DataEngine handle whose exact type is derived from `emitCrudSideEffects` (no `any`). */
type CrudDataEngine = Parameters<typeof emitCrudSideEffects>[0]['dataEngine']

export type CreateAttachmentFromBufferInput = {
  em: EntityManager
  /** When provided, fires CRUD side effects (events + indexing). Omit to skip. */
  dataEngine?: CrudDataEngine
  tenantId: string
  organizationId: string
  /** Domain entity this attachment is linked to (e.g. 'customers:deal'). */
  entityId: string
  recordId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  /** Storage partition; defaults to the entity's default partition. */
  partitionCode?: string | null
}

export type CreatedAttachment = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  url: string
}

/**
 * Create a durable `Attachment` from an in-memory buffer, linked to a domain
 * record. Additive reusable seam extracted from the upload route's store block so
 * server-side producers (e.g. the agent file-plane artifact-promotion effector,
 * #12) can materialize an attachment without going through the multipart HTTP
 * route. Resolves the partition + driver, stores the bytes, persists the row
 * atomically, and (when a `dataEngine` is passed) fires CRUD side effects so the
 * attachment is indexed and its events emitted — exactly like an uploaded file.
 */
export async function createAttachmentFromBuffer(input: CreateAttachmentFromBufferInput): Promise<CreatedAttachment> {
  const { em } = input
  const code = (input.partitionCode && input.partitionCode.length > 0)
    ? input.partitionCode
    : resolveDefaultPartitionCode(input.entityId)

  let partition = await em.findOne(AttachmentPartition, { code })
  if (!partition) {
    await ensureDefaultPartitions(em)
    partition = await em.findOne(AttachmentPartition, { code })
  }
  if (!partition) throw new Error(`[internal] attachment partition "${code}" is not available`)

  const driver = await new StorageDriverFactory(em).resolveForPartition(partition.code, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  const stored = await driver.store({
    partitionCode: partition.code,
    orgId: input.organizationId,
    tenantId: input.tenantId,
    fileName: input.fileName,
    buffer: input.buffer,
  })

  const metadata = mergeAttachmentMetadata(null, {
    assignments: upsertAssignment([], { type: input.entityId, id: input.recordId }),
  })
  const attachmentId = randomUUID()
  assertAttachmentScopeInvariant({ tenantId: input.tenantId, organizationId: input.organizationId })
  const attachment = em.create(Attachment, {
    id: attachmentId,
    entityId: input.entityId,
    recordId: input.recordId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSize: input.buffer.length,
    partitionCode: partition.code,
    storageDriver: partition.storageDriver || 'local',
    storagePath: stored.storagePath,
    url: buildAttachmentFileUrl(attachmentId),
    content: null,
    storageMetadata: metadata,
  })
  await em.transactional(async (tx) => {
    await tx.persist(attachment).flush()
  })

  if (input.dataEngine) {
    await emitCrudSideEffects({
      dataEngine: input.dataEngine,
      action: 'created',
      entity: attachment,
      identifiers: {
        id: attachment.id,
        organizationId: attachment.organizationId ?? null,
        tenantId: attachment.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
  }

  return {
    id: attachmentId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSize: input.buffer.length,
    url: attachment.url,
  }
}
