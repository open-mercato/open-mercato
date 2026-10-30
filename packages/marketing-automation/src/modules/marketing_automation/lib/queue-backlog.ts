import { getQueuePendingProbe } from '@open-mercato/queue'
import { MARKETING_QUEUES } from './queues.js'

export type QueueBacklogEntry =
  | { queueName: string; known: false }
  | { queueName: string; known: true; ready: number; active: number; delayed: number }

/**
 * How much work is sitting in this module's queues — gated on the caller, not on the tenant.
 *
 * `getQueuePendingProbe` counts the whole shared queue, not this tenant's slice of it: the jobs
 * waiting in it are not tagged by tenant, so there is no per-tenant count to return instead. Reporting
 * it to every tenant holding `marketing_automation.campaigns.view` would tell them about every OTHER
 * tenant's dispatch backlog on a shared installation — including how much mail somebody else is
 * sending. `mayReadQueueDepth` is the caller's own answer to whether they hold the platform-level
 * feature that is allowed to see that; an empty list here, like an omitted field elsewhere in this
 * module, says nothing rather than denying the rest of the readiness screen.
 *
 * Kept apart from the route so the gating decision is testable without a request, a container, or a
 * live queue connection.
 */
export async function loadQueueBacklog(mayReadQueueDepth: boolean): Promise<QueueBacklogEntry[]> {
  if (!mayReadQueueDepth) return []
  return Promise.all(
    MARKETING_QUEUES.map(async (queueName): Promise<QueueBacklogEntry> => {
      try {
        const probe = await getQueuePendingProbe(queueName)
        return probe.error
          ? { queueName, known: false }
          : { queueName, known: true, ready: probe.ready, active: probe.active, delayed: probe.delayedFuture }
      } catch {
        // A probe that throws must never fail the readiness answer: the question it helps with is
        // secondary to every other check on the screen that calls this.
        return { queueName, known: false }
      }
    }),
  )
}
