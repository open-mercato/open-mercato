/**
 * The scope contract every time-tracking strategy resolver receives, and the
 * fail-closed rule the spec's cross-cutting requirements attach to it: a
 * contributed strategy runs only when the caller supplied BOTH a tenant and an
 * organization, matching `resolveProjectAccess` in `../access.ts`.
 *
 * A built-in never needs the scope — it is the same pure arithmetic the module
 * shipped before the registries existed — so failing closed lands on the
 * built-in rather than on an error. That is what makes a client preview
 * (`TimeEntryDialog`, `timeTrackingSettingsForm`, `ProjectCodeField`), which has
 * no tenant id to hand, keep producing exactly the number it produced before.
 */

export type TimeTrackingResolverScope = {
  tenantId: string
  organizationId: string
}

export type ScopedResolverContext = Partial<TimeTrackingResolverScope>

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function readResolverScope(
  ctx: ScopedResolverContext | null | undefined,
): TimeTrackingResolverScope | null {
  if (!ctx) return null
  if (!isNonEmpty(ctx.tenantId) || !isNonEmpty(ctx.organizationId)) return null
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

export function hasResolverScope(ctx: ScopedResolverContext | null | undefined): boolean {
  return readResolverScope(ctx) !== null
}

/**
 * Picks the strategy a scoped call site should run: the highest-priority
 * contribution when the scope is complete, the built-in otherwise. `candidates`
 * arrives already ordered by the registry.
 */
export function selectScopedStrategy<TEntry extends { id: string }>(
  candidates: readonly TEntry[],
  builtInId: string,
  ctx: ScopedResolverContext | null | undefined,
): TEntry | null {
  const builtIn = candidates.find((candidate) => candidate.id === builtInId) ?? null
  if (!hasResolverScope(ctx)) return builtIn
  return candidates[0] ?? builtIn
}
