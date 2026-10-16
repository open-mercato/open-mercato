/**
 * The server side of EP-40: how a route turns "this person, this period" into the
 * target the timesheet footer and the My Work KPIs show.
 *
 * Resolution goes through the `timeCapacityResolver` DI key rather than the
 * registry directly, so an app that replaced the resolver through
 * `entry.overrides` is honoured. A replacement that only implements (or only
 * replaces) the synchronous `resolveCapacity` still answers; it is reported as a
 * contributed provider because the module can no longer vouch for its numbers.
 * Every override answer is validated like a registry answer, and an unusable one
 * falls back to the registry rather than reaching the screens.
 */

import { eachDayIso, isWeekendIso, type TimesheetDateRange } from '../time-tracking-ui/timesheetPeriod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  normalizeCapacityResult,
  resolveTimesheetCapacity,
  resolveTimesheetCapacityAsync,
  type CapacityContext,
  type CapacityDateRange,
  type CapacityResult,
  type ResolvedCapacity,
} from './capacity'

export const CAPACITY_RESOLVER_DI_KEY = 'timeCapacityResolver'
export const CAPACITY_RESOLVER_OVERRIDE_ID = 'timeCapacityResolver'

const logger = createLogger('staff').child({ component: 'time-tracking/capacityService' })

type CapacityResolverLike = {
  resolveCapacity?: (
    staffMemberId: string | null,
    dateRange: CapacityDateRange,
    ctx: CapacityContext,
  ) => CapacityResult
  resolveCapacityAsync?: (
    staffMemberId: string | null,
    dateRange: CapacityDateRange,
    ctx: CapacityContext,
  ) => Promise<ResolvedCapacity>
}

type ContainerLike = { resolve: (name: string) => unknown }

export function buildCapacityDateRange(range: TimesheetDateRange): CapacityDateRange {
  return {
    from: range.from,
    to: range.to,
    workingDays: eachDayIso(range).filter((iso) => !isWeekendIso(iso)),
  }
}

function readResolver(container: ContainerLike): CapacityResolverLike | null {
  try {
    const resolver = container.resolve(CAPACITY_RESOLVER_DI_KEY)
    return resolver && typeof resolver === 'object' ? (resolver as CapacityResolverLike) : null
  } catch {
    return null
  }
}

export async function resolveCapacityForRange(input: {
  container: ContainerLike
  staffMemberId: string | null
  range: TimesheetDateRange
  tenantId: string
  organizationId: string
  dailyHours: number | null
}): Promise<ResolvedCapacity> {
  const dateRange = buildCapacityDateRange(input.range)
  const ctx: CapacityContext = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    dailyHours: input.dailyHours,
  }
  const fallback = () => resolveTimesheetCapacityAsync(input.staffMemberId, dateRange, ctx)
  const resolver = readResolver(input.container)
  if (!resolver) return fallback()

  const replacedSyncOnly =
    typeof resolver.resolveCapacity === 'function' &&
    resolver.resolveCapacity !== resolveTimesheetCapacity &&
    (!resolver.resolveCapacityAsync || resolver.resolveCapacityAsync === resolveTimesheetCapacityAsync)
  try {
    if (resolver.resolveCapacityAsync && !replacedSyncOnly) {
      if (resolver.resolveCapacityAsync === resolveTimesheetCapacityAsync) return fallback()
      const answer: unknown = await resolver.resolveCapacityAsync(input.staffMemberId, dateRange, ctx)
      const normalized = normalizeCapacityResult(answer, dateRange)
      const meta = answer as { providerId?: unknown; isBuiltIn?: unknown } | null
      if (normalized && typeof meta?.providerId === 'string' && typeof meta.isBuiltIn === 'boolean') {
        return { ...normalized, providerId: meta.providerId, isBuiltIn: meta.isBuiltIn }
      }
    } else if (resolver.resolveCapacity && resolver.resolveCapacity !== resolveTimesheetCapacity) {
      const answer: unknown = resolver.resolveCapacity(input.staffMemberId, dateRange, ctx)
      if (answer instanceof Promise) answer.catch(() => undefined)
      const normalized = normalizeCapacityResult(answer, dateRange)
      if (normalized) return { ...normalized, providerId: CAPACITY_RESOLVER_OVERRIDE_ID, isBuiltIn: false }
    } else {
      return fallback()
    }
  } catch (err) {
    logger.error('the timeCapacityResolver override threw; using the registry', { err })
    return fallback()
  }
  logger.error('the timeCapacityResolver override answered an unusable result; using the registry')
  return fallback()
}
