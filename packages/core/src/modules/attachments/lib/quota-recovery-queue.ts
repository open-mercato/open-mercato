import { createModuleQueue } from '@open-mercato/queue'

export type AttachmentQuotaRecoveryJob = { reservationId: string }

const queue = createModuleQueue<AttachmentQuotaRecoveryJob>('attachments-quota-recovery', { concurrency: 2 })

export async function scheduleAttachmentQuotaRecovery(reservationId: string, delayMs: number): Promise<void> {
  await queue.enqueue({ reservationId }, { delayMs: Math.max(1_000, delayMs) })
}
