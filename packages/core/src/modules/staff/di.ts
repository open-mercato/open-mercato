import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveAvailabilityWriteAccess,
  type AvailabilityAccessContext,
  type AvailabilityWriteAccess,
} from './lib/availabilityAccess'
import {
  resolveProjectAccess,
  type ProjectAccess,
  type ProjectAccessContext,
} from './lib/time-tracking/access'
import {
  resolveTimeRoundingStrategy,
  roundMinutes,
  type RoundingSettings,
  type TimeRoundingStrategy,
} from './lib/time-tracking/rounding'
import {
  resolveTimeRate,
  type TimeRateContext,
} from './lib/time-tracking/cost'
import {
  resolveBillability,
  type BillabilityContext,
} from './lib/time-tracking/billability'
import {
  resolveTimesheetCapacity,
  type CapacityContext,
  type CapacityDateRange,
  type CapacityResult,
} from './lib/time-tracking/capacity'
import {
  evaluateOverlapPolicies,
  type Overlap,
  type OverlapDecision,
  type OverlapPolicyContext,
} from './lib/time-tracking/overlap'
import {
  deriveProjectCode,
  type ProjectCodeContext,
} from './lib/time-tracking/projectCode'
import type { ScopedResolverContext } from './lib/time-tracking/registries/scope'

export type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

export type TimeTrackingAccessResolver = {
  resolveProjectAccess(ctx: ProjectAccessContext): Promise<ProjectAccess>
}

/**
 * EP-32…EP-41 keep their registries in plain module scope so the browser bundle
 * can reach them (four of the strategies back client previews that cannot
 * resolve DI). These DI keys are the SERVER entry point to the same registries:
 * they exist so an app can replace a resolver wholesale through `entry.overrides`
 * DI without patching the module, and so server code follows the "never `new` a
 * resolver" rule. Resolving one and calling the module function are equivalent.
 */
export type TimeRoundingResolver = {
  resolveStrategy(ctx?: ScopedResolverContext | null): TimeRoundingStrategy
  roundMinutes(raw: number, settings: RoundingSettings, ctx?: ScopedResolverContext | null): number
}

export type TimeRateResolverService = {
  resolveRate(ctx: TimeRateContext): number | null
}

export type BillabilityResolverService = {
  resolveBillability(ctx: BillabilityContext): boolean
}

export type TimeCapacityResolver = {
  resolveCapacity(
    staffMemberId: string | null,
    dateRange: CapacityDateRange,
    ctx: CapacityContext,
  ): CapacityResult
}

export type OverlapPolicyResolver = {
  evaluate(spans: readonly Overlap[], ctx: OverlapPolicyContext): OverlapDecision
}

export type ProjectCodeResolver = {
  generate(name: string, taken: Set<string>, ctx?: ProjectCodeContext | null): string
}

export function register(container: AppContainer) {
  const resolver: AvailabilityAccessResolver = { resolveAvailabilityWriteAccess }
  const timeTrackingResolver: TimeTrackingAccessResolver = { resolveProjectAccess }
  const timeRoundingResolver: TimeRoundingResolver = {
    resolveStrategy: resolveTimeRoundingStrategy,
    roundMinutes,
  }
  const timeRateResolver: TimeRateResolverService = { resolveRate: resolveTimeRate }
  const timeBillabilityResolver: BillabilityResolverService = { resolveBillability }
  const timeCapacityResolver: TimeCapacityResolver = { resolveCapacity: resolveTimesheetCapacity }
  const timeOverlapPolicyResolver: OverlapPolicyResolver = { evaluate: evaluateOverlapPolicies }
  const timeProjectCodeResolver: ProjectCodeResolver = {
    generate: (name, taken, ctx) => deriveProjectCode(name, taken, ctx ?? undefined),
  }
  container.register({
    availabilityAccessResolver: asValue(resolver),
    timeTrackingAccessResolver: asValue(timeTrackingResolver),
    timeRoundingResolver: asValue(timeRoundingResolver),
    timeRateResolver: asValue(timeRateResolver),
    timeBillabilityResolver: asValue(timeBillabilityResolver),
    timeCapacityResolver: asValue(timeCapacityResolver),
    timeOverlapPolicyResolver: asValue(timeOverlapPolicyResolver),
    timeProjectCodeResolver: asValue(timeProjectCodeResolver),
  })
}
