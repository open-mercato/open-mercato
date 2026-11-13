import { z } from 'zod'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { assertAttachmentScopeInvariant } from './access'
import { resolveOcrMaxConcurrency } from './ocrLimits'

export const ATTACHMENT_OCR_QUEUE_NAME = 'attachments-ocr'
export const ATTACHMENT_OCR_WORKER_ID = 'attachments:ocr'

const MAX_WORKER_CONCURRENCY = 20

export const attachmentOcrJobSchema = z.object({
  attachmentId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
})
export type AttachmentOcrJob = z.infer<typeof attachmentOcrJobSchema>

export function resolveAttachmentOcrWorkerConcurrency(): number {
  return Math.min(MAX_WORKER_CONCURRENCY, resolveOcrMaxConcurrency())
}

let defaultQueue: Queue<AttachmentOcrJob> | null = null

function getAttachmentOcrQueue(): Queue<AttachmentOcrJob> {
  if (!defaultQueue) {
    defaultQueue = createModuleQueue<AttachmentOcrJob>(ATTACHMENT_OCR_QUEUE_NAME, {
      concurrency: resolveAttachmentOcrWorkerConcurrency(),
      coalesceBy: (payload) => `attachment:${payload.attachmentId}`,
    })
  }
  return defaultQueue
}

export async function enqueueAttachmentOcr(input: AttachmentOcrJob): Promise<string> {
  assertAttachmentScopeInvariant({ tenantId: input.tenantId, organizationId: input.organizationId })
  const payload = attachmentOcrJobSchema.parse(input)
  return getAttachmentOcrQueue().enqueue(payload)
}
