import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AttachmentQuotaService } from '../lib/quota-service'
import type { StorageDriverFactory } from '../lib/drivers'
import { scheduleAttachmentQuotaRecovery, type AttachmentQuotaRecoveryJob } from '../lib/quota-recovery-queue'

export const metadata: WorkerMeta = {
  queue: 'attachments-quota-recovery',
  id: 'attachments:quota-recovery',
  concurrency: 2,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

type AttachmentLookupDatabase = {
  attachments: {
    id: string
    tenant_id: string
    storage_driver: string
    storage_path: string
  }
}

export default async function handle(
  job: QueuedJob<AttachmentQuotaRecoveryJob>,
  ctx: HandlerContext,
): Promise<void> {
  const quotaService = ctx.resolve<AttachmentQuotaService>('attachmentQuotaService')
  const scope = {
    tenantId: job.payload.tenantId,
    organizationId: job.payload.organizationId,
  }
  const record = await quotaService.getReservation(job.payload.reservationId, scope)
  if (!record || record.status === 'committed') return
  if (record.expiresAt && record.expiresAt.getTime() > Date.now()) {
    await scheduleAttachmentQuotaRecovery(job.payload, record.expiresAt.getTime() - Date.now())
    return
  }

  const claimed = await quotaService.claimExpired(record.id, scope)
  if (!claimed) return
  try {
    const em = ctx.resolve<EntityManager>('em')
    const existingAttachment = await em.getKysely<AttachmentLookupDatabase>()
      .selectFrom('attachments')
      .select('id')
      .where('tenant_id', '=', claimed.tenantId)
      .where('storage_driver', '=', claimed.storageDriver)
      .where('storage_path', '=', claimed.storagePath)
      .executeTakeFirst()
    if (!existingAttachment) {
      if (!claimed.partitionCode) throw new Error('Attachment quota recovery is missing its partition code.')
      const factory = ctx.resolve<StorageDriverFactory>('storageDriverFactory')
      const driver = await factory.resolveForPartition(claimed.partitionCode, {
        tenantId: claimed.tenantId,
        organizationId: claimed.organizationId,
      })
      await (driver.deleteStrict?.(claimed.partitionCode, claimed.storagePath)
        ?? driver.delete(claimed.partitionCode, claimed.storagePath))
    }
    await quotaService.release(claimed.id, claimed.leaseToken)
  } catch (error) {
    if (claimed.expiresAt) {
      await scheduleAttachmentQuotaRecovery(job.payload, claimed.expiresAt.getTime() - Date.now())
    }
    throw error
  }
}
