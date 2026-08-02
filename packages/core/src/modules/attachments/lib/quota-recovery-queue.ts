import { createModuleQueue } from '@open-mercato/queue'

export type AttachmentQuotaRecoveryJob = {
  reservationId: string
  tenantId: string
  organizationId: string
}

const queue = createModuleQueue<AttachmentQuotaRecoveryJob>('attachments-quota-recovery', { concurrency: 2 })

export async function scheduleAttachmentQuotaRecovery(
  payload: AttachmentQuotaRecoveryJob,
  delayMs: number,
): Promise<void> {
  await queue.enqueue(payload, { delayMs: Math.max(1_000, delayMs) })
}
