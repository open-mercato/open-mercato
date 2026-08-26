/**
 * EP-33 — the rate resolver chain.
 *
 * `applicableRate` is still the single place an hourly rate is chosen, and
 * `entryAmount` still the single place an amount is produced (D-7). What changed
 * is that the override → project-rate chain now lives in the built-in resolver
 * `staff.time_tracking.rate.entry_override_then_project`, registered at module
 * load, instead of being spelled inline. Contributed resolvers are consulted in
 * descending priority ahead of it, but only when the caller supplies a complete
 * tenant + organization scope; with no contribution — or with none of them
 * answering — the built-in decides, so the number is the one this file always
 * produced.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'
import { tryStrategy } from './registries/invoke'
import { hasResolverScope, type ScopedResolverContext } from './registries/scope'

export type CostEntry = {
  isBillable: boolean
  roundedMinutes: number
  rateOverrideAmount?: number | null
}

export type CostProject = {
  hourlyRate?: number | null
}

/**
 * Everything a rate resolver may reason about. Only `entry` and `project` are
 * populated by the module's own call sites; the remaining fields exist so a
 * contributed resolver can key off seniority, task type, customer contract or an
 * effective date without the call site having to invent its own context shape.
 */
export type TimeRateContext = ScopedResolverContext & {
  entry?: Pick<CostEntry, 'rateOverrideAmount'> | null
  project?: CostProject | null
  task?: { id?: string | null; timeProjectId?: string | null } | null
  staffMember?: { id?: string | null } | null
  role?: { id?: string | null; name?: string | null } | null
  customer?: { id?: string | null } | null
  date?: string | null
}

export type TimeRateResolver = {
  id: string
  priority?: number
  resolve(ctx: TimeRateContext): number | null
}

export const TIME_RATE_REGISTRY_ID = extensionPoints.hosts.timeRateRegistry.spotId

export const BUILT_IN_TIME_RATE_RESOLVER_ID = 'staff.time_tracking.rate.entry_override_then_project'

const registry = createStrategyRegistry<TimeRateResolver>(TIME_RATE_REGISTRY_ID)

export function registerTimeRateResolver(resolver: TimeRateResolver): () => void {
  return registry.register(resolver)
}

export function listTimeRateResolvers(): TimeRateResolver[] {
  return registry.list()
}

export function getTimeRateResolver(id: string | null | undefined): TimeRateResolver | null {
  return registry.get(id)
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  const sign = value < 0 ? -1 : 1
  const magnitude = Math.abs(value)
  const shifted = Number(`${magnitude}e2`)
  if (!Number.isFinite(shifted)) return sign * (Math.round(magnitude * 100) / 100)
  const rounded = Math.round(shifted)
  const restored = Number(`${rounded}e-2`)
  if (!Number.isFinite(restored)) return sign * (rounded / 100)
  return sign * restored
}

function toCents(amount: number): number {
  return Math.round(round2(amount) * 100)
}

function builtInRate(ctx: TimeRateContext): number | null {
  const override = ctx.entry?.rateOverrideAmount
  if (override !== null && override !== undefined && Number.isFinite(override)) return override
  const projectRate = ctx.project?.hourlyRate
  if (projectRate !== null && projectRate !== undefined && Number.isFinite(projectRate)) return projectRate
  return null
}

const builtInRateResolver: TimeRateResolver = registry.registerBuiltIn({
  id: BUILT_IN_TIME_RATE_RESOLVER_ID,
  priority: BUILT_IN_STRATEGY_PRIORITY,
  resolve: builtInRate,
})

/**
 * Walks the registry in priority order and takes the first non-null answer.
 * Contributed resolvers are skipped entirely when the context carries no
 * complete scope, which leaves the built-in as the only candidate.
 */
export function resolveTimeRate(ctx: TimeRateContext): number | null {
  const scoped = hasResolverScope(ctx)
  for (const resolver of registry.list()) {
    if (!scoped && resolver.id !== BUILT_IN_TIME_RATE_RESOLVER_ID) continue
    // A chain asks the next candidate anyway, so a thrower is skipped rather than
    // replaced — and the built-in is always the last candidate.
    const rate = tryStrategy(TIME_RATE_REGISTRY_ID, resolver.id, () => resolver.resolve(ctx))
    if (rate !== null && rate !== undefined && Number.isFinite(rate)) return rate
  }
  return null
}

export function applicableRate(
  entry: Pick<CostEntry, 'rateOverrideAmount'> | null | undefined,
  project: CostProject | null | undefined,
  ctx?: Omit<TimeRateContext, 'entry' | 'project'> | null,
): number | null {
  return resolveTimeRate({ ...(ctx ?? {}), entry: entry ?? null, project: project ?? null })
}

export function entryAmount(
  entry: CostEntry,
  project: CostProject | null | undefined,
  ctx?: Omit<TimeRateContext, 'entry' | 'project'> | null,
): number | null {
  if (!entry?.isBillable) return null
  const rate = applicableRate(entry, project, ctx)
  if (rate === null) return null
  const minutes = Number.isFinite(entry.roundedMinutes) ? entry.roundedMinutes : 0
  return round2((minutes / 60) * rate)
}

export function sumAmounts(amounts: readonly (number | null | undefined)[]): number {
  let cents = 0
  for (const amount of amounts) {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) continue
    cents += toCents(amount)
  }
  return round2(cents / 100)
}
