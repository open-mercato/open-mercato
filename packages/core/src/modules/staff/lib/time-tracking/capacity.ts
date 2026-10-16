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
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff').child({ component: 'time-tracking/capacity' })

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
  /** Optional caption the timesheet footer shows instead of the neutral "Target". */
  label?: string
  /** Optional i18n key for the caption; `label` is its fallback. */
  labelKey?: string
}

/** A resolved target plus the provider that answered it. */
export type ResolvedCapacity = CapacityResult & {
  providerId: string
  isBuiltIn: boolean
}

export type CapacityProvider = {
  id: string
  priority?: number
  resolve(
    staffMemberId: string | null,
    dateRange: CapacityDateRange,
    ctx: CapacityContext,
  ): CapacityResult
  /**
   * Optional asynchronous answer for a provider that reads its own data (contract
   * hours, approved leave). Preferred by `resolveTimesheetCapacityAsync`; the
   * synchronous `resolve` remains the answer for synchronous callers.
   */
  resolveAsync?(
    staffMemberId: string | null,
    dateRange: CapacityDateRange,
    ctx: CapacityContext,
  ): Promise<CapacityResult>
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

function resolveFlatDailyHours(dateRange: CapacityDateRange, ctx: CapacityContext): CapacityResult {
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
}

const builtInCapacityProvider: CapacityProvider = registry.registerBuiltIn({
  id: BUILT_IN_CAPACITY_PROVIDER_ID,
  priority: BUILT_IN_STRATEGY_PRIORITY,
  resolve: (_staffMemberId, dateRange, ctx) => resolveFlatDailyHours(dateRange, ctx),
})

export function resolveCapacityProvider(ctx?: ScopedResolverContext | null): CapacityProvider {
  return selectScopedStrategy(registry.list(), builtInCapacityProvider, ctx)
}

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function isCalendarDay(value: string): boolean {
  const match = ISO_DAY_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

function isNonNegativeMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Validates a contributed answer and brings it to the shape every screen relies on:
 * whole, non-negative minutes on real calendar days inside the requested range, a
 * total that is the sum of those days (so the footer never disagrees with the bars),
 * and an empty map whenever the total is `null` ("no target anywhere"). `null` means
 * the answer is unusable and the caller falls back to the built-in.
 */
export function normalizeCapacityResult(value: unknown, dateRange: CapacityDateRange): CapacityResult | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    targetMinutesByDate?: unknown
    totalTargetMinutes?: unknown
    label?: unknown
    labelKey?: unknown
  }
  const byDate = candidate.targetMinutesByDate
  if (!byDate || typeof byDate !== 'object' || Array.isArray(byDate)) return null
  if (!isOptionalString(candidate.label) || !isOptionalString(candidate.labelKey)) return null
  const total = candidate.totalTargetMinutes
  if (total !== null && !isNonNegativeMinutes(total)) return null

  const targetMinutesByDate: Record<string, number> = {}
  for (const [date, minutes] of Object.entries(byDate as Record<string, unknown>)) {
    if (!isCalendarDay(date) || !isNonNegativeMinutes(minutes)) return null
    if (total === null || date < dateRange.from || date > dateRange.to) continue
    targetMinutesByDate[date] = Math.round(minutes)
  }
  const summed = Object.values(targetMinutesByDate).reduce((sum, minutes) => sum + minutes, 0)
  return {
    targetMinutesByDate,
    totalTargetMinutes: total === null ? null : summed,
    ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
    ...(typeof candidate.labelKey === 'string' ? { labelKey: candidate.labelKey } : {}),
  }
}

/**
 * The targets the timesheet renders and compares logged minutes against. A provider
 * that throws, or that answers with something the caller cannot subtract from, falls
 * back to the flat daily target the module shipped — a timesheet showing the wrong
 * target reads as the person being behind, which is worse than showing the default.
 *
 * @deprecated Synchronous — it never consults a provider's `resolveAsync`. Use
 * `resolveTimesheetCapacityAsync`.
 */
export function resolveTimesheetCapacity(
  staffMemberId: string | null,
  dateRange: CapacityDateRange,
  ctx: CapacityContext,
): CapacityResult {
  const provider = resolveCapacityProvider(ctx)
  const builtIn = () => resolveFlatDailyHours(dateRange, ctx)
  if (provider === builtInCapacityProvider) return builtIn()

  const answer = runStrategy(
    CAPACITY_PROVIDER_REGISTRY_ID,
    provider.id,
    () => provider.resolve(staffMemberId, dateRange, ctx) as unknown,
    () => null,
  )
  return normalizeCapacityResult(answer, dateRange) ?? builtIn()
}

/**
 * The asynchronous entry point the timesheet and My Work screens resolve their
 * targets through. A provider's `resolveAsync` is preferred so it can read its own
 * data; a rejection or an unusable answer degrades to the built-in exactly like the
 * synchronous resolver does.
 */
export async function resolveTimesheetCapacityAsync(
  staffMemberId: string | null,
  dateRange: CapacityDateRange,
  ctx: CapacityContext,
): Promise<ResolvedCapacity> {
  const provider = resolveCapacityProvider(ctx)
  const builtIn = (): ResolvedCapacity => ({
    ...resolveFlatDailyHours(dateRange, ctx),
    providerId: BUILT_IN_CAPACITY_PROVIDER_ID,
    isBuiltIn: true,
  })
  if (provider === builtInCapacityProvider) return builtIn()

  let answer: unknown = null
  try {
    answer = provider.resolveAsync
      ? await provider.resolveAsync(staffMemberId, dateRange, ctx)
      : provider.resolve(staffMemberId, dateRange, ctx)
  } catch (err) {
    logger.error('a time-tracking strategy threw; falling back to the built-in', {
      registryId: CAPACITY_PROVIDER_REGISTRY_ID,
      strategyId: provider.id,
      err,
    })
    return builtIn()
  }
  const normalized = normalizeCapacityResult(answer, dateRange)
  if (!normalized) {
    logger.error('a capacity provider answered an unusable result; falling back to the built-in', {
      registryId: CAPACITY_PROVIDER_REGISTRY_ID,
      strategyId: provider.id,
    })
    return builtIn()
  }
  return { ...normalized, providerId: provider.id, isBuiltIn: false }
}
