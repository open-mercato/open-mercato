import { createModuleQueue } from '@open-mercato/queue'

export type StorageS3QuotaRecoveryJob = {
  reservationId: string
  tenantId: string
  organizationId: string
  absenceCheck?: number
}

const queue = createModuleQueue<StorageS3QuotaRecoveryJob>('storage-s3-quota-recovery', { concurrency: 2 })

export async function scheduleStorageS3QuotaRecovery(
  payload: StorageS3QuotaRecoveryJob,
  delayMs: number,
): Promise<void> {
  await queue.enqueue(payload, { delayMs: Math.max(1_000, delayMs) })
}
