import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { lockSignInDevice } from '../lib/sign-in-activity-locks'
import { readSignInActivityConfig } from '../lib/sign-in-activity-config'

export const metadata: WorkerMeta = {
  queue: 'security-sign-in-retention',
  id: 'security:sign-in-retention',
  concurrency: 1,
}

const batchSize = 5000

const retentionDeletes = [
  `delete from security_sign_in_attempts where id in (
     select id from security_sign_in_attempts where occurred_at < ? order by occurred_at, id limit ?
   ) returning id`,
  `delete from security_sign_in_mfa_receipts where id in (
     select id from security_sign_in_mfa_receipts where created_at < ? order by created_at, id limit ?
   ) returning id`,
  `delete from security_sign_in_notification_intents where id in (
     select id from security_sign_in_notification_intents
       where status <> 'pending' and created_at < ? order by created_at, id limit ?
   ) returning id`,
]

async function pruneKnownDevices(em: EntityManager, cutoff: Date) {
  type ExpiredDevice = { id: string; tenant_id: string; user_id: string }
  while (true) {
    const devices = await em.execute<ExpiredDevice[]>(
      `select id, tenant_id, user_id from security_known_devices as device
       where last_seen_at < ? and not exists (
         select 1 from security_sign_in_notification_intents as intent
         where intent.tenant_id = device.tenant_id and intent.known_device_id = device.id and intent.status = 'pending'
       ) order by last_seen_at, id limit ?`,
      [cutoff, batchSize],
    )
    for (const device of devices) {
      await em.transactional(async (transaction) => {
        await lockSignInDevice(transaction, device.tenant_id, device.user_id)
        await transaction.execute(
          `delete from security_known_devices as device
           where device.id = ? and device.tenant_id = ? and device.user_id = ? and device.last_seen_at < ?
           and not exists (
             select 1 from security_sign_in_notification_intents as intent
             where intent.tenant_id = device.tenant_id and intent.known_device_id = device.id and intent.status = 'pending'
           )`,
          [device.id, device.tenant_id, device.user_id, cutoff],
        )
      })
    }
    if (devices.length < batchSize) return
  }
}

export default async function handle(_job: QueuedJob) {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  const cutoff = new Date(Date.now() - readSignInActivityConfig().retentionMs)
  for (const statement of retentionDeletes) {
    let rows: { id: string }[]
    do {
      rows = await em.execute<{ id: string }[]>(statement, [cutoff, batchSize])
    } while (rows.length === batchSize)
  }
  await pruneKnownDevices(em, cutoff)
}
