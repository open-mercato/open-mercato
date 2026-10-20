import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  createCausationEnvelope,
  getAmbientCausation,
  isCausationEnabled,
  primaryCause,
  type CausationEnvelope,
  type CausationFrame,
} from '@open-mercato/shared/lib/causation/server'

const SCHEDULER_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

export function buildScheduleCausationFrame(scheduleId: string): CausationFrame {
  return { kind: 'schedule', id: scheduleId }
}

/**
 * The causation a scheduled run's command executes under. Inside the run's own
 * `schedule` frame (stacked by the worker on the envelope restored from the job,
 * or seeded as the entry frame by the local poller) the ambient envelope is
 * reused, so the command, the scheduler's lifecycle events and any enqueued
 * follow-up jobs share one correlation id. Outside it, a fresh `schedule` entry
 * envelope is created rather than inheriting unrelated context.
 */
export function resolveScheduledCommandCausation(scheduleId: string): CausationEnvelope {
  const ambient = getAmbientCausation()
  const primary = primaryCause(ambient)
  if (ambient && primary.kind === 'schedule' && primary.id === scheduleId) return ambient
  return createCausationEnvelope([buildScheduleCausationFrame(scheduleId)])
}

type ScheduledCommandContextSchedule = {
  id: string
  tenantId?: string | null
  organizationId?: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  createdByUserId?: string | null
}

export type ScheduledCommandActorOptions = {
  /**
   * The user who manually triggered this run, when there is one. Unattended runs
   * pass null/undefined and keep falling back to the schedule's creator.
   */
  triggeredByUserId?: string | null
}

/**
 * Resolve the real user a scheduled run acts as: the person who triggered it,
 * else the schedule's creator, else nobody.
 *
 * This is the single definition of that precedence, and it deliberately returns
 * `null` rather than the system actor when neither id is usable. Callers that
 * need an identity for the command context substitute the system actor
 * themselves; the RBAC gate must instead keep rejecting an actor-less schedule
 * with its own clear error, rather than running an RBAC lookup against the
 * all-zeros system id.
 */
export function resolveScheduledCommandActorUserId(
  schedule: Pick<ScheduledCommandContextSchedule, 'createdByUserId'>,
  options?: ScheduledCommandActorOptions,
): string | null {
  const candidates = [options?.triggeredByUserId, schedule.createdByUserId]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function buildScheduledCommandAuth(
  schedule: ScheduledCommandContextSchedule,
  options?: ScheduledCommandActorOptions,
): Exclude<AuthContext, null> {
  const actorId = resolveScheduledCommandActorUserId(schedule, options) || SCHEDULER_SYSTEM_ACTOR_ID
  return {
    sub: actorId,
    userId: actorId,
    tenantId: schedule.tenantId ?? null,
    orgId: schedule.organizationId ?? null,
    isSuperAdmin: false,
  }
}

export function buildScheduledCommandContext(
  schedule: ScheduledCommandContextSchedule,
  container: AppContainer,
  options?: ScheduledCommandActorOptions,
): CommandRuntimeContext {
  const tenantId = schedule.tenantId ?? null
  const organizationId = schedule.organizationId ?? null
  const organizationIds = organizationId ? [organizationId] : null

  return {
    container,
    auth: buildScheduledCommandAuth(schedule, options),
    organizationScope:
      schedule.scopeType === 'organization' && organizationId
        ? {
            selectedId: organizationId,
            filterIds: [organizationId],
            allowedIds: [organizationId],
            tenantId,
          }
        : {
            selectedId: null,
            filterIds: null,
            allowedIds: null,
            tenantId,
          },
    selectedOrganizationId: organizationId,
    organizationIds,
    request: undefined,
    ...(isCausationEnabled() ? { causation: resolveScheduledCommandCausation(schedule.id) } : {}),
  }
}
