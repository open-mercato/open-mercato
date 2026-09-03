/**
 * EP-34 — the billability resolver chain.
 *
 * The rule `commands/timesheets-entries.ts` documented in prose — an explicit
 * value wins, then the project's own default, then the tenant setting — is now
 * the built-in resolver `staff.time_tracking.billability.project_then_tenant`.
 * Contributed resolvers are asked first, in descending priority, and the first
 * non-null answer wins; a resolver that returns `null` abstains and the chain
 * carries on, so an unopinionated contribution cannot change an entry.
 *
 * As everywhere else in this group, a contribution is consulted only when the
 * caller supplies a complete tenant + organization scope.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'
import { tryStrategy } from './registries/invoke'
import { hasResolverScope, type ScopedResolverContext } from './registries/scope'
import type { TimeTrackingSettings } from './settings'

export type BillabilityContext = ScopedResolverContext & {
  requested?: boolean | null
  project?: { id?: string | null; billableByDefault?: boolean | null } | null
  task?: { id?: string | null } | null
  staffMemberId?: string | null
  date?: string | null
  settings: TimeTrackingSettings
}

export type BillabilityResolver = {
  id: string
  priority?: number
  resolve(ctx: BillabilityContext): boolean | null
}

export const BILLABILITY_REGISTRY_ID = extensionPoints.hosts.timeBillabilityRegistry.spotId

export const BUILT_IN_BILLABILITY_RESOLVER_ID = 'staff.time_tracking.billability.project_then_tenant'

const registry = createStrategyRegistry<BillabilityResolver>(BILLABILITY_REGISTRY_ID)

export function registerBillabilityResolver(resolver: BillabilityResolver): () => void {
  return registry.register(resolver)
}

export function listBillabilityResolvers(): BillabilityResolver[] {
  return registry.list()
}

export function getBillabilityResolver(id: string | null | undefined): BillabilityResolver | null {
  return registry.get(id)
}

const builtInBillabilityResolver: BillabilityResolver = registry.registerBuiltIn({
  id: BUILT_IN_BILLABILITY_RESOLVER_ID,
  priority: BUILT_IN_STRATEGY_PRIORITY,
  resolve: (ctx) => ctx.requested ?? ctx.project?.billableByDefault ?? ctx.settings.defaults.billable,
})

export function resolveBillability(ctx: BillabilityContext): boolean {
  const scoped = hasResolverScope(ctx)
  for (const resolver of registry.list()) {
    if (!scoped && resolver.id !== BUILT_IN_BILLABILITY_RESOLVER_ID) continue
    const answer = tryStrategy(BILLABILITY_REGISTRY_ID, resolver.id, () => resolver.resolve(ctx))
    if (typeof answer === 'boolean') return answer
  }
  return ctx.settings.defaults.billable
}
