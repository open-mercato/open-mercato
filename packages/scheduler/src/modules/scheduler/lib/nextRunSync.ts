import type { EntityManager } from '@mikro-orm/core'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { readBullmqNextRun, type BullmqNextRun } from './bullmqNextRun.js'
import { parseInterval, resolveScheduleIntervalMs } from './intervalParser.js'

const logger = createLogger('scheduler').child({ component: 'next-run-sync' })

/**
 * The schedule's timing configuration as an execution loaded it, captured
 * before the target runs.
 */
export type ScheduleTimingSnapshot = {
  scheduleId: string
  tenantId: string | null
  organizationId: string | null
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
}

const UPDATE_NEXT_RUN_AT_SQL = `update scheduled_jobs
   set next_run_at = ?
 where id = ?
   and tenant_id is not distinct from ?
   and organization_id is not distinct from ?
   and deleted_at is null
   and is_enabled = true
   and schedule_type = ?
   and schedule_value = ?
   and timezone = ?
   and ? > now()
   and next_run_at is distinct from ?`

function intervalCandidates(scheduleValue: string): number[] {
  try {
    return [resolveScheduleIntervalMs(scheduleValue), parseInterval(scheduleValue)]
  } catch {
    return []
  }
}

/**
 * True when the BullMQ scheduler was registered from the same timing
 * configuration the execution loaded. A scheduler registered before the
 * minimum-interval clamp keeps the unclamped `every`, so both forms match.
 */
export function bullmqNextRunMatchesTiming(next: BullmqNextRun, timing: ScheduleTimingSnapshot): boolean {
  if (timing.scheduleType === 'cron') {
    return next.pattern === timing.scheduleValue
      && (next.timezone ?? 'UTC') === (timing.timezone || 'UTC')
  }
  return typeof next.every === 'number' && intervalCandidates(timing.scheduleValue).includes(next.every)
}

/**
 * Mirrors BullMQ's next fire time into `scheduled_jobs.next_run_at` after an
 * execution under the async strategy, where BullMQ — not this row — decides
 * when a schedule fires.
 *
 * The row is matched by id and by the tenant and organization the execution
 * verified against its job payload, so a write can only land on that scope.
 *
 * The value is written only while it is still true: the BullMQ scheduler and
 * the row must both still carry the timing configuration this execution
 * loaded (an edit in flight writes its own `nextRunAt`), and the instant must
 * still be ahead of the database clock (an execution holding an older slot,
 * or a slot that is due but not picked up, writes nothing). When BullMQ has no
 * usable value nothing is written: a locally computed time would show a run
 * BullMQ is not going to perform.
 *
 * The statement is raw so that `updated_at` stays untouched — skipped and
 * failed executions must not invalidate an editor's optimistic-lock version —
 * and it runs on a pooled connection, outside the per-job unit of work, which
 * may hold whatever a failed target left behind.
 *
 * Never throws: this is bookkeeping awaited from the worker's `finally`, so a
 * failure here must neither fail a successful execution nor replace the
 * target's own error.
 */
export async function syncScheduleNextRunAt(
  resolveEm: () => EntityManager,
  timing: ScheduleTimingSnapshot,
): Promise<void> {
  if (process.env.QUEUE_STRATEGY !== 'async') return

  try {
    const next = await readBullmqNextRun(timing.scheduleId)
    if (!next) return

    if (!bullmqNextRunMatchesTiming(next, timing)) {
      logger.debug('Skipping nextRunAt sync: BullMQ scheduler does not match the loaded schedule timing', {
        scheduleId: timing.scheduleId,
        scheduleType: timing.scheduleType,
        scheduleValue: timing.scheduleValue,
        timezone: timing.timezone,
        bullmqPattern: next.pattern,
        bullmqEvery: next.every,
        bullmqTimezone: next.timezone,
      })
      return
    }

    await resolveEm().getConnection().execute(
      UPDATE_NEXT_RUN_AT_SQL,
      [
        next.nextRunAt,
        timing.scheduleId,
        timing.tenantId,
        timing.organizationId,
        timing.scheduleType,
        timing.scheduleValue,
        timing.timezone,
        next.nextRunAt,
        next.nextRunAt,
      ],
      'run',
    )
  } catch (error) {
    logger.warn('Failed to sync nextRunAt from BullMQ', { scheduleId: timing.scheduleId, err: error })
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'scheduler',
        code: 'scheduler.next_run_sync_failed',
        attributes: { scheduleId: timing.scheduleId },
      })
    } catch (telemetryError) {
      logger.warn('Failed to report a nextRunAt sync error to telemetry', { err: telemetryError })
    }
  }
}
