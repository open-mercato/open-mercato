import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerActivity } from '../data/entities'
import { emitCustomersEvent } from '../events'

export const metadata: WorkerMeta = {
  queue: 'customers:interaction-overdue',
  id: 'interaction-overdue',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(_job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')

  const activities = await em.find(
    CustomerActivity,
    {
      dueAt: { $lt: new Date(), $ne: null },
      isOverdue: false,
      occurredAt: null,
    },
    { limit: 100 },
  )

  if (activities.length === 0) {
    return
  }

  for (const activity of activities) {
    activity.isOverdue = true

    await emitCustomersEvent('customers.activity.overdue', {
      activityId: activity.id,
      organizationId: activity.organizationId,
      tenantId: activity.tenantId,
      assignedToUserId: activity.assignedToUserId,
      dueAt: activity.dueAt,
      subject: activity.subject,
    })
  }

  await em.flush()

  console.log(`[interaction-overdue] Marked ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} as overdue`)
}
