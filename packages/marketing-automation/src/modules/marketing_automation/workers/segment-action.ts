import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { reportError } from '@open-mercato/telemetry'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingSegment } from '../data/entities.js'
import { JOB_MAX_CHECKED, resolveSegmentMembers } from '../lib/segment-members.js'
import { addScoreEntry } from '../lib/scores.js'
import { isErasedSubject } from '../lib/gdpr.js'
import { recordJobRun } from '../lib/job-runs.js'
import type { SegmentActionJob } from '../lib/queue.js'
import { logger, readScope } from './shared.js'
import type { HandlerContext } from './shared.js'

// See the note in dispatch.ts: this string must stay a literal.
export const metadata: WorkerMeta = {
  queue: 'marketing-automation-segment-action',
  id: 'marketing_automation:segment-action',
  concurrency: 1,
}

/** How often progress is written: often enough to watch, rarely enough not to be the work. */
const PROGRESS_EVERY = 25

/**
 * Applies one action to everybody in a segment.
 *
 * **Membership is resolved HERE, not when the action was requested.** A job that carried a list of ids would
 * act on who was in the segment when somebody pressed the button, and the gap between pressing and running is
 * exactly where a customer leaves the segment — which is the one case where acting is wrong.
 *
 * Progress is a real `ProgressJob`, so the work survives navigation and shows in the shared top bar; the
 * alternative, a browser loop, ends when the operator closes the tab halfway through tagging ten thousand
 * people.
 */
export default async function handle(job: QueuedJob<SegmentActionJob>, ctx: HandlerContext): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const em = ctx.resolve<EntityManager>('em')
  const container = (ctx.container ?? { resolve: ctx.resolve }) as unknown as AwilixContainer
  const progressContext = { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: job.payload.actorId ?? null }

  let progress: ProgressService | null = null
  try {
    progress = ctx.resolve<ProgressService>('progressService')
  } catch {
    // A trimmed installation without the progress module must still be able to run the action; what it loses
    // is the ability to watch it.
    progress = null
  }

  try {
    await recordJobRun(em, scope, { kind: 'dispatch' }, async () => {
      const segment = await em.findOne(MarketingSegment, { id: job.payload.segmentId, ...scope, deletedAt: null })
      if (!segment) {
        await progress?.failJob(job.payload.progressJobId, { errorMessage: 'The segment no longer exists' }, progressContext)
        return { counters: { applied: 0, skipped: 0, checked: 0 } }
      }

      await progress?.startJob(job.payload.progressJobId, progressContext)

      const resolution = await resolveSegmentMembers(
        em,
        container,
        scope,
        (segment.expression ?? null) as ConditionExpression | null,
        { maxChecked: JOB_MAX_CHECKED },
      )

      await progress?.updateProgress(
        job.payload.progressJobId,
        { totalCount: resolution.ids.length, processedCount: 0 },
        progressContext,
      )

      const commandBus = ctx.resolve<CommandBus>('commandBus')
      let applied = 0
      let skipped = 0

      for (const [index, subjectEntityId] of resolution.ids.entries()) {
        // Cancellation is checked per customer, because the point of a cancellable bulk action is to stop it
        // part-way — after the next ten thousand would not be cancelling.
        const cancelled = await progress?.isCancellationRequested(
          job.payload.progressJobId,
          scope.tenantId,
          scope.organizationId,
        )
        if (cancelled) {
          await progress?.markCancelled(job.payload.progressJobId, progressContext)
          return { counters: { applied, skipped, checked: resolution.checked } }
        }

        try {
          // Membership comes from the customer record, which erasure does not touch; the erasure record is what says no.
          if (await isErasedSubject(em, subjectEntityId, scope)) {
            skipped += 1
          } else if (job.payload.action.kind === 'add_tag') {
            /**
             * Through the COMMAND, like the campaign step: the tag write carries audit, events and cache
             * invalidation, and a direct insert would skip all three.
             */
            await commandBus.execute('customers.tags.assign', {
              input: {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                entityId: subjectEntityId,
                tagId: job.payload.action.tagId,
              },
              ctx: {
                container,
                auth: null,
                organizationScope: null,
                selectedOrganizationId: scope.organizationId,
                organizationIds: [scope.organizationId],
              },
            })
            applied += 1
          } else {
            await addScoreEntry(em, {
              scope,
              subjectEntityId,
              points: job.payload.action.points,
              reason: job.payload.action.reason ?? 'segment action',
              // `manual` because a person asked for it, over a set they chose; nothing about this came from a
              // campaign, and labelling it `campaign` would make the score history claim a journey awarded it.
              source: 'manual',
              /**
               * The progress job stands in for a run and the customer for a step.
               *
               * That is exactly the shape the ledger's unique index already enforces, so a redelivered queue
               * job cannot award the same points twice — without inventing a second idempotency scheme.
               */
              runId: job.payload.progressJobId,
              stepId: subjectEntityId,
              now: new Date(),
            })
            applied += 1
          }
        } catch (error) {
          // One customer's failure never stops the batch; the counters report it and the log says why.
          skipped += 1
          logger.warn('[internal] marketing segment action failed for one subject', {
            segmentId: segment.id,
            subjectEntityId,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        if ((index + 1) % PROGRESS_EVERY === 0) {
          await progress?.updateProgress(job.payload.progressJobId, { processedCount: index + 1 }, progressContext)
        }
      }

      await progress?.completeJob(
        job.payload.progressJobId,
        { resultSummary: { applied, skipped } },
        progressContext,
      )
      return { counters: { applied, skipped, checked: resolution.checked } }
    })
  } catch (error) {
    logger.error('[internal] marketing segment action failed', {
      segmentId: job.payload.segmentId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.segment_action_failed',
      attributes: { segmentId: job.payload.segmentId },
    })
    await progress?.failJob(
      job.payload.progressJobId,
      { errorMessage: 'The action did not finish' },
      progressContext,
    ).catch(() => undefined)
    // Re-thrown so the queue's retry and dead-lettering stay truthful.
    throw error
  }
}
