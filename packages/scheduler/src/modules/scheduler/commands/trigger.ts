// =============================================================================
// Manual Schedule Trigger Command — Undo Policy
// =============================================================================
//
// `scheduler.jobs.trigger` is registered with `isUndoable: false` and defines no
// `undo`/`redo`. It mutates no domain state itself: it enqueues an execution job,
// and a worker picks that job up as soon as it is free. By the time an operator
// could reach for Undo the run has already started, and whatever it did is
// reversed through the action-log entries the run itself writes — the target
// command's own `undo`, or the target queue's domain-level counter-action.
//
// Minting an undo token here would therefore offer to reverse an enqueue that no
// longer exists, while leaving the run's real effects untouched. No `undo`
// handler also means no `undoToken`, hence no `x-om-operation` header — which is
// what `TC-UNDO-001 §4` pins.
//
// The command exists for the audit trail: manual triggering is an
// authorised-looking way to make an automated job run at a moment of the actor's
// choosing, so every authenticated attempt — refusals included — must leave an
// `ActionLog` row naming the caller.
// =============================================================================
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { createQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { resolveScheduleAccess } from '../lib/scheduleAccess.js'
import {
  assertSchedulerSafeCommandAuthorized,
  type SchedulerCommandRbacService,
} from '../lib/scheduler-safe-commands.js'
import { resolveScheduledCommandActorUserId } from '../lib/commandContext.js'
import { resolveCommandActorUserId } from './jobs.js'
import type { ScheduleTriggerInput } from '../data/validators.js'
import type { ExecuteSchedulePayload } from '../workers/execute-schedule.worker.js'

const logger = createLogger('scheduler').child({ component: 'trigger' })

/**
 * Outcome of a manual trigger attempt.
 *
 * `execute()` returns this for every *expected* refusal instead of throwing.
 * That is a hard requirement, not a style choice: `CommandBus.execute` has no
 * try/catch, so a handler that throws skips `captureAfter`, `buildLog` and
 * `persistLog` entirely and no `ActionLog` row is written — losing exactly the
 * entries this command exists to create. The route maps `outcome` to HTTP.
 */
export type TriggerScheduleResult = {
  scheduleId: string
  scheduleName: string | null
  targetType: 'queue' | 'command' | null
  target: string | null
  outcome: 'enqueued' | 'not_found' | 'forbidden' | 'strategy_unsupported' | 'failed'
  queueJobId: string | null
  error: string | null
}

/**
 * A refused attempt records the requested id and nothing else about the row.
 *
 * `resolveScheduleAccess` deliberately answers `not_found` rather than 403 for
 * another tenant's schedule, so that a caller cannot confirm an id exists.
 * Echoing that row's name or target into the audit log would hand back exactly
 * the fact the decision withholds, so schedule details are populated only once
 * access has been granted.
 */
function refusedTrigger(
  scheduleId: string,
  outcome: 'not_found' | 'forbidden',
): TriggerScheduleResult {
  return {
    scheduleId,
    scheduleName: null,
    targetType: null,
    target: null,
    outcome,
    queueJobId: null,
    error: null,
  }
}

const triggerScheduleCommand: CommandHandler<ScheduleTriggerInput, TriggerScheduleResult> = {
  id: 'scheduler.jobs.trigger',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')

    // Load by id alone, then apply isolation to the loaded row. Folding the actor's
    // tenant/org into the lookup would make every system-scoped schedule unmatchable.
    const schedule = await em.findOne(ScheduledJob, { id: input.id, deletedAt: null })
    if (!schedule) return refusedTrigger(input.id, 'not_found')

    // Single source of truth for schedule visibility, shared with update, delete,
    // list and executions. Its `not_found` vs `forbidden` split is deliberate.
    const access = resolveScheduleAccess(schedule, ctx.auth)
    if (access === 'not_found') return refusedTrigger(input.id, 'not_found')
    if (access === 'forbidden') return refusedTrigger(input.id, 'forbidden')

    const details = {
      scheduleId: schedule.id,
      scheduleName: schedule.name ?? null,
      targetType: schedule.targetType ?? null,
      target:
        (schedule.targetType === 'command' ? schedule.targetCommand : schedule.targetQueue) ?? null,
    }

    const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
    if (queueStrategy !== 'async') {
      return { ...details, outcome: 'strategy_unsupported', queueJobId: null, error: null }
    }

    // `resolveCommandActorUserId` resolves the bound user whenever the auth
    // context carries one — including an API key issued on a user's behalf — and
    // yields null only for a key-only context. That matters now that the worker
    // authorizes and runs a manual command schedule as this identity: a bare key
    // id is not a user id, so it falls back to the schedule's creator rather than
    // failing an RBAC lookup that could never succeed.
    const triggeredByUserId = resolveCommandActorUserId(ctx)

    // Decide a command schedule's authorization here, where the audit row is
    // written, rather than leaving it to the worker.
    //
    // The worker gates the run with the same assertion and throws when it refuses,
    // and a throw inside a retrying queue is invisible: the caller has already been
    // told the run was enqueued, the audit row already says `enqueued`, and BullMQ
    // keeps retrying a refusal that no attempt can turn into a success. Answering
    // `forbidden` now makes the refusal the caller's HTTP response and the audit
    // row's outcome. The worker keeps its own gate as the authority — this decision
    // can go stale between enqueue and execution — but the common case is decided
    // where it can be seen.
    //
    // Unlike `refusedTrigger`, this refusal carries the schedule's details: access
    // to the row has already been granted, so naming it discloses nothing new.
    if (schedule.targetType === 'command') {
      const actorUserId = resolveScheduledCommandActorUserId(schedule, { triggeredByUserId })
      try {
        await assertSchedulerSafeCommandAuthorized({
          commandId: schedule.targetCommand,
          actorUserId,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          rbacService: ctx.container.resolve<SchedulerCommandRbacService>('rbacService'),
        })
      } catch (error) {
        logger.info('Manual trigger refused by scheduled-command authorization', {
          scheduleId: schedule.id,
          commandId: schedule.targetCommand,
          err: error,
        })
        return {
          ...details,
          outcome: 'forbidden',
          queueJobId: null,
          error: error instanceof Error ? error.message : null,
        }
      }
    }

    const payload: ExecuteSchedulePayload = {
      scheduleId: schedule.id,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      scopeType: schedule.scopeType,
      triggerType: 'manual',
      triggeredByUserId,
    }

    let executionQueue: Queue<ExecuteSchedulePayload> | null = null
    try {
      executionQueue = createQueue<ExecuteSchedulePayload>('scheduler-execution', queueStrategy, {
        connection: { url: getRedisUrlOrThrow('QUEUE') },
      })
      const queueJobId = await executionQueue.enqueue(payload)

      logger.info('Manually triggered schedule', {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        jobId: queueJobId,
        triggeredBy: ctx.auth?.sub ?? null,
      })

      return { ...details, outcome: 'enqueued', queueJobId, error: null }
    } catch (error) {
      logger.error('Manual trigger failed', { err: error, scheduleId: schedule.id })
      return {
        ...details,
        outcome: 'failed',
        queueJobId: null,
        error: error instanceof Error ? error.message : null,
      }
    } finally {
      // Cleanup runs on the failure path too — the previous route-level code closed
      // the queue only after a successful enqueue, leaking a Redis connection
      // otherwise. A failure to close must not turn a completed enqueue into a
      // failed request, so it is reported rather than thrown.
      try {
        await executionQueue?.close()
      } catch (closeError) {
        logger.warn('Failed to close scheduler execution queue', { err: closeError })
      }
    }
  },

  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()

    return {
      // Keep the label free of create/update/delete/assign verbs: the action-log
      // projection derives `actionType` by string-matching it.
      actionLabel: translate('scheduler.audit.trigger', 'Trigger schedule'),
      resourceKind: 'scheduler.job',
      // The requested id, so that probing for ids that do not exist is traceable.
      resourceId: result.scheduleId,
      // The actor's scope on every outcome, unlike the sibling create/update/delete
      // handlers which log the schedule's. A refusal must never carry the target's
      // tenant: that would leak cross-tenant existence into the caller's trail and,
      // because the action-log reader filters organization_id by strict equality,
      // file the row where the caller's own auditors could never read it.
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: {
        scheduleName: result.scheduleName,
        targetType: result.targetType,
        target: result.target,
        outcome: result.outcome,
        queueJobId: result.queueJobId,
        error: result.error,
      },
    }
  },
}

registerCommand(triggerScheduleCommand)
