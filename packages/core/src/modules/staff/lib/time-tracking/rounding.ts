/**
 * EP-32 — the rounding strategy registry.
 *
 * `roundMinutes` is still the single rounding entry point every call site uses,
 * and with no contribution it runs the built-in `staff.time_tracking.rounding.unit`
 * strategy, which is the same `up`/`nearest` × `0|5|10|15` arithmetic this file
 * has always held. A contribution outranks it only when the call site supplies a
 * complete tenant + organization scope (`registries/scope.ts`), so an unscoped
 * client preview keeps producing the built-in's number.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'
import { selectScopedStrategy, type ScopedResolverContext } from './registries/scope'
import { clampToStoredMinutes, runStrategy } from './registries/invoke'

export type RoundingUnitMinutes = 0 | 5 | 10 | 15

export type RoundingDirection = 'up' | 'nearest'

export type RoundingSettings = {
  unitMinutes: RoundingUnitMinutes
  direction: RoundingDirection
}

export const DEFAULT_ROUNDING_SETTINGS: RoundingSettings = {
  unitMinutes: 0,
  direction: 'up',
}

export type TimeRoundingContext = ScopedResolverContext & {
  settings: RoundingSettings
  /** Present on write paths; absent on the settings-screen and dialog previews. */
  timeProjectId?: string | null
  taskId?: string | null
  staffMemberId?: string | null
  date?: string | null
}

export type TimeRoundingStrategy = {
  id: string
  labelKey: string
  priority?: number
  round(rawMinutes: number, ctx: TimeRoundingContext): number
}

export const TIME_ROUNDING_REGISTRY_ID = extensionPoints.hosts.timeRoundingRegistry.spotId

export const BUILT_IN_TIME_ROUNDING_STRATEGY_ID = 'staff.time_tracking.rounding.unit'

const registry = createStrategyRegistry<TimeRoundingStrategy>(TIME_ROUNDING_REGISTRY_ID)

export function registerTimeRoundingStrategy(strategy: TimeRoundingStrategy): () => void {
  return registry.register(strategy)
}

export function listTimeRoundingStrategies(): TimeRoundingStrategy[] {
  return registry.list()
}

export function getTimeRoundingStrategy(id: string | null | undefined): TimeRoundingStrategy | null {
  return registry.get(id)
}

function roundToUnit(raw: number, settings: RoundingSettings): number {
  if (!Number.isFinite(raw)) return 0
  const unit = settings?.unitMinutes ?? 0
  if (!unit) return Math.round(raw)

  const sign = raw < 0 ? -1 : 1
  const magnitude = Math.abs(raw) / unit
  const units = settings.direction === 'nearest' ? Math.round(magnitude) : Math.ceil(magnitude)
  return sign * units * unit
}

const builtInRoundingStrategy: TimeRoundingStrategy = registry.registerBuiltIn({
  id: BUILT_IN_TIME_ROUNDING_STRATEGY_ID,
  labelKey: 'staff.time_tracking.rounding.strategy.unit',
  priority: BUILT_IN_STRATEGY_PRIORITY,
  round: (rawMinutes, ctx) => roundToUnit(rawMinutes, ctx.settings),
})

export function resolveTimeRoundingStrategy(
  ctx?: ScopedResolverContext | null,
): TimeRoundingStrategy {
  return selectScopedStrategy(registry.list(), builtInRoundingStrategy, ctx)
}

/**
 * The single rounding entry point, and the boundary a contributed strategy's answer
 * has to survive.
 *
 * The result is written straight into `staff_time_entries.rounded_minutes` — an
 * `integer` column, and the only input to every amount the suite computes — so an
 * unusable answer is clamped back to the built-in's rather than stored. The built-in
 * is exempt from the clamp on purpose: it is the arithmetic the module shipped, it
 * cannot produce a non-finite or fractional value, and re-shaping its output would
 * be the behaviour change the registries exist to avoid.
 */
export function roundMinutes(
  raw: number,
  settings: RoundingSettings,
  ctx?: ScopedResolverContext | null,
): number {
  const strategy = resolveTimeRoundingStrategy(ctx)
  const builtIn = () => roundToUnit(raw, settings)
  if (strategy === builtInRoundingStrategy) return builtIn()

  const answer = runStrategy(
    TIME_ROUNDING_REGISTRY_ID,
    strategy.id,
    () => strategy.round(raw, { ...(ctx ?? {}), settings }),
    () => Number.NaN,
  )
  return clampToStoredMinutes(answer, builtIn)
}
