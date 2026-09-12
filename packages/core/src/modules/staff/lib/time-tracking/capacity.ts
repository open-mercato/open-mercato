/**
 * EP-40 — the capacity / target provider.
 *
 * The timesheet's "target" is one flat number today: `targets.dailyHours` from
 * the tenant settings, applied to every working day of every person. The
 * built-in `staff.time_tracking.capacity.flat_daily_hours` reproduces exactly
 * that, including its two edge cases — a `null` setting means "no target", and a
 * day the caller did not mark as working contributes nothing.
 *
 * A contributed provider answers per day instead, which is what a contract-hours
 * or leave-aware capacity model needs. It is consulted only when the caller
 * supplies a complete tenant + organization scope.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'
import { selectScopedStrategy, type ScopedResolverContext } from './registries/scope'
import { runStrategy } from './registries/invoke'

export type CapacityDateRange = {
  /** `yyyy-mm-dd`, inclusive. */
  from: string
  /** `yyyy-mm-dd`, inclusive. */
  to: string
  /** The days the caller counts as working; the built-in targets only these. */
  workingDays: readonly string[]
}

export type CapacityContext = ScopedResolverContext & {
  /** The tenant's `targets.dailyHours`; `null` means the tenant set no target. */
  dailyHours: number | null
}

export type CapacityResult = {
  /** Target minutes per `yyyy-mm-dd`, for the working days that carry one. */
  targetMinutesByDate: Record<string, number>
  /** Sum of `targetMinutesByDate`, or `null` when the tenant set no target. */
  totalTargetMinutes: number | null
}

export type CapacityProvider = {
  id: string
  priority?: number
  resolve(
    staffMemberId: string | null,
    dateRange: CapacityDateRange,
    ctx: CapacityContext,
  ): CapacityResult
}

export const CAPACITY_PROVIDER_REGISTRY_ID = extensionPoints.hosts.capacityProviderRegistry.spotId

export const BUILT_IN_CAPACITY_PROVIDER_ID = 'staff.time_tracking.capacity.flat_daily_hours'

const registry = createStrategyRegistry<CapacityProvider>(CAPACITY_PROVIDER_REGISTRY_ID)

export function registerCapacityProvider(provider: CapacityProvider): () => void {
  return registry.register(provider)
}

export function listCapacityProviders(): CapacityProvider[] {
  return registry.list()
}

export function getCapacityProvider(id: string | null | undefined): CapacityProvider | null {
  return registry.get(id)
}

const builtInCapacityProvider: CapacityProvider = registry.registerBuiltIn({
  id: BUILT_IN_CAPACITY_PROVIDER_ID,
  priority: BUILT_IN_STRATEGY_PRIORITY,
  resolve: (_staffMemberId, dateRange, ctx) => {
    const dailyHours = ctx.dailyHours
    if (dailyHours === null || !Number.isFinite(dailyHours)) {
      return { targetMinutesByDate: {}, totalTargetMinutes: null }
    }
    const dailyMinutes = Math.round(dailyHours * 60)
    const targetMinutesByDate: Record<string, number> = {}
    for (const date of dateRange.workingDays ?? []) targetMinutesByDate[date] = dailyMinutes
    return {
      targetMinutesByDate,
      totalTargetMinutes: dailyMinutes * (dateRange.workingDays?.length ?? 0),
    }
  },
})

export function resolveCapacityProvider(ctx?: ScopedResolverContext | null): CapacityProvider {
  return selectScopedStrategy(registry.list(), builtInCapacityProvider, ctx)
}

function isCapacityResult(value: unknown): value is CapacityResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { targetMinutesByDate?: unknown; totalTargetMinutes?: unknown }
  if (!candidate.targetMinutesByDate || typeof candidate.targetMinutesByDate !== 'object') return false
  const total = candidate.totalTargetMinutes
  if (total !== null && (typeof total !== 'number' || !Number.isFinite(total))) return false
  return Object.values(candidate.targetMinutesByDate as Record<string, unknown>).every(
    (minutes) => typeof minutes === 'number' && Number.isFinite(minutes),
  )
}

/**
 * The targets the timesheet renders and compares logged minutes against. A provider
 * that throws, or that answers with something the caller cannot subtract from, falls
 * back to the flat daily target the module shipped — a timesheet showing the wrong
 * target reads as the person being behind, which is worse than showing the default.
 */
export function resolveTimesheetCapacity(
  staffMemberId: string | null,
  dateRange: CapacityDateRange,
  ctx: CapacityContext,
): CapacityResult {
  const provider = resolveCapacityProvider(ctx)
  const builtIn = () => builtInCapacityProvider.resolve(staffMemberId, dateRange, ctx)
  if (provider === builtInCapacityProvider) return builtIn()

  const answer = runStrategy(
    CAPACITY_PROVIDER_REGISTRY_ID,
    provider.id,
    () => provider.resolve(staffMemberId, dateRange, ctx) as unknown,
    () => null,
  )
  return isCapacityResult(answer) ? answer : builtIn()
}
