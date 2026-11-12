import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { inboundAttachmentIngestJobSchema } from '../data/validators'
import {
  handleAbandonedInboundAttachmentIngestJob,
  runInboundAttachmentIngest,
} from '../lib/inboundAttachmentIngest'

const logger = createLogger('inbox_ops').child({ component: 'attachment-ingest-worker' })

// `lockDuration` is a literal: the generator copies it into the registry at `yarn generate` time.
// It equals INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS, which caps INBOX_OPS_ATTACHMENT_LEASE_MS.
export const metadata: WorkerMeta = {
  queue: 'inbox-ops-attachment-ingest',
  id: 'inbox_ops:attachment-ingest',
  concurrency: 2,
  lockDuration: 1800000,
  onJobAbandoned: handleAbandonedInboundAttachmentIngestJob,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

function tryResolve<T>(ctx: HandlerContext, name: string): T | null {
  try {
    return ctx.resolve<T>(name) ?? null
  } catch {
    return null
  }
}

export default async function handle(job: QueuedJob<unknown>, ctx: HandlerContext): Promise<void> {
  const parsed = inboundAttachmentIngestJobSchema.safeParse(job.payload)
  if (!parsed.success) {
    logger.warn('Ignoring an inbound attachment ingest job with an invalid payload', { jobId: ctx.jobId })
    return
  }
  const em = ctx.resolve<EntityManager>('em').fork()
  const encryptionService = tryResolve<TenantDataEncryptionService>(ctx, 'tenantEncryptionService')
    ?? resolveTenantEncryptionService(em)
  if (!encryptionService) throw new Error('[internal] tenant encryption service unavailable')
  await runInboundAttachmentIngest(parsed.data, { attemptNumber: ctx.attemptNumber }, {
    em,
    attachmentService: tryResolve<AttachmentService>(ctx, 'attachmentService'),
    encryptionService,
  })
}
