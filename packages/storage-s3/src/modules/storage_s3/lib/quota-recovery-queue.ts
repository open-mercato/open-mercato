import { createModuleQueue } from '@open-mercato/queue'

export type StorageS3QuotaRecoveryJob = { reservationId: string; absenceCheck?: number }

const queue = createModuleQueue<StorageS3QuotaRecoveryJob>('storage-s3-quota-recovery', { concurrency: 2 })

export async function scheduleStorageS3QuotaRecovery(
  reservationId: string,
  delayMs: number,
  absenceCheck = 0,
): Promise<void> {
  await queue.enqueue({ reservationId, absenceCheck }, { delayMs: Math.max(1_000, delayMs) })
}
