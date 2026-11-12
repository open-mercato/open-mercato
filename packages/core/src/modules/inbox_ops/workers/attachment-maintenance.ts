import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { runInboundAttachmentMaintenance } from '../lib/inboundAttachmentMaintenance'
import type { InboundAttachmentReleaseService } from '../lib/inboundAttachmentRelease'

export const metadata: WorkerMeta = {
  queue: 'inbox-ops-attachment-maintenance',
  id: 'inbox_ops:attachment-maintenance',
  concurrency: 1,
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

export default async function handle(_job: QueuedJob<unknown>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em').fork()
  await runInboundAttachmentMaintenance({
    em,
    attachmentService: tryResolve<InboundAttachmentReleaseService>(ctx, 'attachmentService'),
    encryptionService: tryResolve<TenantDataEncryptionService>(ctx, 'tenantEncryptionService') ?? resolveTenantEncryptionService(em),
  })
}
