import { transferAttachmentsInChunks } from '@open-mercato/core/modules/attachments/lib/transferClient'
import type { ProductMediaItem } from './ProductMediaManager'

export type DraftMediaTransferInput = {
  entityId: string
  draftId?: string | null
  recordId: string
  mediaItems: ProductMediaItem[]
}

export type DraftMediaTransferResult = {
  requestedCount: number
  failedCount: number
  errors: string[]
}

export async function transferDraftMedia({
  entityId,
  draftId,
  recordId,
  mediaItems,
}: DraftMediaTransferInput): Promise<DraftMediaTransferResult> {
  const attachmentIds = mediaItems
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!draftId || !recordId || !attachmentIds.length) {
    return { requestedCount: 0, failedCount: 0, errors: [] }
  }
  const result = await transferAttachmentsInChunks({
    entityId,
    attachmentIds,
    fromRecordId: draftId,
    toRecordId: recordId,
  })
  return {
    requestedCount: attachmentIds.length,
    failedCount: result.failedIds.length + result.unconfirmedCount,
    errors: result.errors,
  }
}
