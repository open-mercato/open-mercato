import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment } from '../data/entities'
import type { StorageDriverFactory } from '../lib/drivers'
import {
  ATTACHMENT_OCR_QUEUE_NAME,
  ATTACHMENT_OCR_WORKER_ID,
  attachmentOcrJobSchema,
  resolveAttachmentOcrWorkerConcurrency,
  type AttachmentOcrJob,
} from '../lib/ocrJobQueue'
import { processAttachmentOcr } from '../lib/ocrQueue'

const logger = createLogger('attachments').child({ component: 'ocr-worker' })

export const metadata: WorkerMeta = {
  queue: ATTACHMENT_OCR_QUEUE_NAME,
  id: ATTACHMENT_OCR_WORKER_ID,
  concurrency: resolveAttachmentOcrWorkerConcurrency(),
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

export type AttachmentOcrWorkerDeps = {
  em: EntityManager
  storageDriverFactory: StorageDriverFactory
}

export async function runAttachmentOcrJob(rawPayload: AttachmentOcrJob, deps: AttachmentOcrWorkerDeps): Promise<void> {
  const parsed = attachmentOcrJobSchema.safeParse(rawPayload)
  if (!parsed.success) {
    logger.warn('Discarding malformed OCR job', { issues: parsed.error.issues.length })
    return
  }
  const job = parsed.data
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const attachment = await findOneWithDecryption(
    deps.em,
    Attachment,
    { id: job.attachmentId, tenantId: job.tenantId, organizationId: job.organizationId },
    undefined,
    scope,
  )
  if (!attachment) {
    logger.info('Attachment removed before OCR ran; skipping', { attachmentId: job.attachmentId })
    return
  }
  const driver = await deps.storageDriverFactory.resolveForPartition(attachment.partitionCode, {
    tenantId: attachment.tenantId ?? '',
    organizationId: attachment.organizationId ?? '',
  })
  await processAttachmentOcr(
    deps.em,
    {
      attachmentId: attachment.id,
      storagePath: attachment.storagePath,
      mimeType: attachment.mimeType,
      partitionCode: attachment.partitionCode,
      organizationId: attachment.organizationId ?? null,
      tenantId: attachment.tenantId ?? null,
    },
    driver,
  )
}

export default async function handle(job: QueuedJob<AttachmentOcrJob>, ctx: HandlerContext): Promise<void> {
  await runAttachmentOcrJob(job.payload, {
    em: ctx.resolve<EntityManager>('em'),
    storageDriverFactory: ctx.resolve<StorageDriverFactory>('storageDriverFactory'),
  })
}
