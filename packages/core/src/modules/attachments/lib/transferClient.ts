import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
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
  unconfirmedCount: number
  errors: string[]
}

export function chunkAttachmentIds(attachmentIds: string[], size = ATTACHMENT_TRANSFER_MAX_IDS): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < attachmentIds.length; index += size) {
    chunks.push(attachmentIds.slice(index, index + size))
  }
  return chunks
}

function stopsRemainingChunks(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
  return name === 'AbortError' || name === 'UnauthorizedError'
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

export async function transferAttachmentsInChunks({
  entityId,
  attachmentIds,
  fromRecordId,
  toRecordId,
}: TransferAttachmentsInput): Promise<TransferAttachmentsResult> {
  const result: TransferAttachmentsResult = { transferredCount: 0, failedIds: [], unconfirmedCount: 0, errors: [] }
  const chunks = chunkAttachmentIds(attachmentIds)
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]
    try {
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
      if (!call.ok) {
        result.failedIds.push(...chunk)
        if (call.result?.error) result.errors.push(call.result.error)
        continue
      }
      const updated = call.result?.updated
      const confirmed = typeof updated === 'number' && Number.isFinite(updated)
        ? Math.min(Math.max(Math.trunc(updated), 0), chunk.length)
        : 0
      result.transferredCount += confirmed
      result.unconfirmedCount += chunk.length - confirmed
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, {
        module: 'attachments',
        code: 'attachments.transfer_chunk_failed',
        attributes: { chunkSize: chunk.length },
      })
      result.errors.push(describeError(error))
      if (stopsRemainingChunks(error)) {
        result.failedIds.push(...chunks.slice(chunkIndex).flat())
        break
      }
      result.failedIds.push(...chunk)
    }
  }
  return result
}
