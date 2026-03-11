import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerActivity } from '../data/entities'
import { emitCustomersEvent } from '../events'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata: WorkerMeta = {
  queue: 'customers:interaction-reminders',
  id: 'interaction-reminder',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

interface ReminderJobPayload {
  tenantId: string
  organizationId: string
}

export default async function handle(job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const payload = job.payload as ReminderJobPayload

  if (!payload?.tenantId || !payload?.organizationId) {
    console.warn('[interaction-reminder] Missing tenantId or organizationId in job payload, skipping')
    return
  }

  const activities = await findWithDecryption(
    em,
    CustomerActivity,
    {
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
      reminderAt: { $lte: new Date() },
      reminderSent: false,
      dueAt: { $ne: null },
    },
    { limit: 100 },
    { tenantId: payload.tenantId, organizationId: payload.organizationId },
  )

  if (activities.length === 0) {
    return
  }

  for (const activity of activities) {
    activity.reminderSent = true
  }

  await em.flush()

  for (const activity of activities) {
    await emitCustomersEvent('customers.activity.reminder.sent', {
      activityId: activity.id,
      organizationId: activity.organizationId,
      tenantId: activity.tenantId,
      assignedToUserId: activity.assignedToUserId,
      dueAt: activity.dueAt,
      subject: activity.subject,
    })
  }
}
