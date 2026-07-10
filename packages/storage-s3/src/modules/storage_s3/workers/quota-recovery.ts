import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { S3StorageDriver } from '../lib/s3-driver'
import { scheduleStorageS3QuotaRecovery, type StorageS3QuotaRecoveryJob } from '../lib/quota-recovery-queue'

export const metadata: WorkerMeta = {
  queue: 'storage-s3-quota-recovery',
  id: 'storage_s3:quota-recovery',
  concurrency: 2,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

type IntegrationCredentialsService = {
  resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
}

export default async function handle(
  job: QueuedJob<StorageS3QuotaRecoveryJob>,
  ctx: HandlerContext,
): Promise<void> {
  const quotaService = ctx.resolve<AttachmentQuotaService>('attachmentQuotaService')
  const record = await quotaService.getReservation(job.payload.reservationId)
  if (!record || record.status === 'committed') return
  if (record.expiresAt && record.expiresAt.getTime() > Date.now()) {
    await scheduleStorageS3QuotaRecovery(record.id, record.expiresAt.getTime() - Date.now())
    return
  }

  const claimed = await quotaService.claimExpired(record.id)
  if (!claimed) return
  try {
    const credentialsService = ctx.resolve<IntegrationCredentialsService>('integrationCredentialsService')
    const credentials = await credentialsService.resolve('storage_s3', {
      tenantId: claimed.tenantId,
      organizationId: claimed.organizationId,
    })
    if (!credentials) throw new Error('S3 integration is not configured for quota recovery.')
    const driver = new S3StorageDriver(credentials)

    if (claimed.source === 'storage_s3_signed') {
      const listed = await driver.listObjects(claimed.storagePath, 1)
      const object = listed.files.find((file) => file.key === claimed.storagePath)
      if (!object) {
        if (record.status === 'storing' && (job.payload.absenceCheck ?? 0) === 0 && claimed.expiresAt) {
          await scheduleStorageS3QuotaRecovery(
            claimed.id,
            claimed.expiresAt.getTime() - Date.now(),
            1,
          )
          return
        }
        await quotaService.release(claimed.id, claimed.leaseToken)
        return
      }
      const validSize = claimed.uploadTokenHash
        ? object.size <= claimed.reservedBytes
        : object.size === claimed.reservedBytes
      if (validSize) {
        await quotaService.commitRecoveredStandalone(claimed.id, claimed.leaseToken, object.size)
        return
      }
    }

    await driver.deleteStrict('', claimed.storagePath)
    await quotaService.release(claimed.id, claimed.leaseToken)
  } catch (error) {
    if (claimed.expiresAt) {
      await scheduleStorageS3QuotaRecovery(claimed.id, claimed.expiresAt.getTime() - Date.now())
    }
    throw error
  }
}
