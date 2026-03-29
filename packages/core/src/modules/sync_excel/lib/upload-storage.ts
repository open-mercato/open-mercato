import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../../attachments/data/entities'
import { buildAttachmentFileUrl } from '../../attachments/lib/imageUrls'
import { ensureDefaultPartitions } from '../../attachments/lib/partitions'
import { resolveAttachmentAbsolutePath, storePartitionFile } from '../../attachments/lib/storage'

const SYNC_EXCEL_ATTACHMENT_ENTITY_ID = 'sync_excel:upload'
const SYNC_EXCEL_PARTITION_CODE = 'privateAttachments'

export async function createSyncExcelUploadAttachment(input: {
  em: EntityManager
  uploadId: string
  organizationId: string
  tenantId: string
  fileName: string
  mimeType: string
  buffer: Buffer
}): Promise<Attachment> {
  await ensureDefaultPartitions(input.em)

  const partition = await input.em.findOne(AttachmentPartition, { code: SYNC_EXCEL_PARTITION_CODE })
  if (!partition) {
    throw new Error('Storage partition is not configured.')
  }

  const stored = await storePartitionFile({
    partitionCode: partition.code,
    orgId: input.organizationId,
    tenantId: input.tenantId,
    fileName: input.fileName,
    buffer: input.buffer,
  })

  const attachmentId = randomUUID()
  const attachment = input.em.create(Attachment, {
    id: attachmentId,
    entityId: SYNC_EXCEL_ATTACHMENT_ENTITY_ID,
    recordId: input.uploadId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    partitionCode: partition.code,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSize: input.buffer.length,
    storageDriver: partition.storageDriver || 'local',
    storagePath: stored.storagePath,
    url: buildAttachmentFileUrl(attachmentId),
    storageMetadata: {
      module: 'sync_excel',
      temporary: true,
      uploadId: input.uploadId,
    },
  })

  input.em.persist(attachment)
  await input.em.flush()

  return attachment
}

export async function readSyncExcelUploadBuffer(attachment: Attachment): Promise<Buffer> {
  const absolutePath = resolveAttachmentAbsolutePath(
    attachment.partitionCode,
    attachment.storagePath,
    attachment.storageDriver,
  )
  return fs.readFile(absolutePath)
}
