import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ATTACHMENT_TRANSFER_MAX_IDS } from './transferLimits'

export type TransferAttachmentsInput = {
  entityId: string
  attachmentIds: string[]
  fromRecordId?: string | null
  toRecordId: string
}

export type TransferAttachmentsResult = {
  transferredCount: number
  failedIds: string[]
  errors: string[]
}

export function chunkAttachmentIds(attachmentIds: string[], size = ATTACHMENT_TRANSFER_MAX_IDS): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < attachmentIds.length; index += size) {
    chunks.push(attachmentIds.slice(index, index + size))
  }
  return chunks
}

export async function transferAttachmentsInChunks({
  entityId,
  attachmentIds,
  fromRecordId,
  toRecordId,
}: TransferAttachmentsInput): Promise<TransferAttachmentsResult> {
  const result: TransferAttachmentsResult = { transferredCount: 0, failedIds: [], errors: [] }
  for (const chunk of chunkAttachmentIds(attachmentIds)) {
    const call = await apiCall<{ ok?: boolean; updated?: number; error?: string }>(
      '/api/attachments/transfer',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId,
          attachmentIds: chunk,
          ...(fromRecordId ? { fromRecordId } : {}),
          toRecordId,
        }),
      },
      { fallback: null },
    )
    if (call.ok) {
      result.transferredCount += typeof call.result?.updated === 'number' ? call.result.updated : chunk.length
    } else {
      result.failedIds.push(...chunk)
      if (call.result?.error) result.errors.push(call.result.error)
    }
  }
  return result
}
