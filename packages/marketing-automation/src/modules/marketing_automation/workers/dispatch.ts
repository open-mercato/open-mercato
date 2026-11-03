import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { recordDeadLetter } from '../lib/dead-letter.js'
import { dispatchEvent } from '../lib/dispatcher.js'
import { findTrigger } from '../lib/trigger-catalog.js'
import type { DispatchJob } from '../lib/queue.js'
import { buildDispatchDeps, logger, readScope } from './shared.js'
import type { HandlerContext } from './shared.js'

// The queue name MUST be a literal here: the generator extracts it from the AST and cannot
// resolve an imported constant, so a worker referencing `lib/queues.ts` from `metadata` would
// silently vanish from the registry. A test asserts this string still equals that constant.
export const metadata: WorkerMeta = {
  queue: 'marketing-automation-dispatch',
  id: 'marketing_automation:dispatch',
  concurrency: 8,
}

export default async function handle(job: QueuedJob<DispatchJob>, ctx: HandlerContext): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const deps = buildDispatchDeps(ctx, scope)
  const trigger = findTrigger(job.payload.eventId)
  if (!trigger) {
    // The campaign was authored against an event this build no longer knows how to interpret.
    // Dead-lettered rather than retried, because retrying cannot make it resolvable.
    await recordDeadLetter(deps.em, {
      source: 'dispatch',
      error: new Error(`[internal] no trigger definition for ${job.payload.eventId}`),
      payload: job.payload.payload,
      eventId: job.payload.eventId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return
  }

  const { subjectEntityId, trigger: triggerContext } = await trigger.build(job.payload.payload, deps.em, scope)

  const result = await dispatchEvent(
    {
      eventId: job.payload.eventId,
      eventPayload: job.payload.payload,
      subjectEntityId,
      triggerContext,
      dispatchDepth: job.payload.dispatchDepth ?? 0,
      /**
       * Carried through from the emitted payload, and ONLY for this key.
       *
       * The inbound-hook endpoint sets it because its credential names one campaign; every other emitter leaves
       * it absent and dispatches to whoever listens, as before.
       */
      restrictToCampaignId: typeof job.payload.payload.restrictToCampaignId === 'string'
        ? job.payload.payload.restrictToCampaignId
        : null,
    },
    deps,
  )

  logger.info('marketing dispatch finished', { eventId: job.payload.eventId, ...result })
}
