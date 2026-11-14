export type SeedProjectInput = {
  runningProjectId: string | null
  lastProjectId: string | null
  visibleProjectIds: string[]
  assignedProjectIds: string[]
}

/**
 * Decides which project the timer picker should start out on.
 *
 * First match wins:
 *   1. the running timer's project — fact beats history, and it is the rung that
 *      fixes the post-refresh and post-stop cases
 *   2. the member's persisted last-started project
 *   3. the sole grid-visible project
 *   4. the sole assigned project
 *   5. nothing — Start stays disabled and the hint explains why
 *
 * Every rung is rejected unless the id is one the picker can actually display.
 * Seeding an id absent from the picker's own list yields an enabled Start button
 * with a blank label, which is strictly worse than no seed at all.
 *
 * Rungs 3 and 4 require exactly one candidate. Guessing among equals would
 * silently log time to the wrong project, so ambiguity resolves to `null`.
 */
export function resolveSeedProjectId(input: SeedProjectInput): string | null {
  const assignable = new Set(input.assignedProjectIds)
  if (assignable.size === 0) return null

  // Rung 1 is authoritative but not terminal: a running timer on a project the
  // picker cannot display falls through to rung 2 rather than resolving to null.
  // That is deliberate — "first match wins" ranks the rungs, while the presence
  // guard decides whether a rung matched at all.
  if (input.runningProjectId && assignable.has(input.runningProjectId)) {
    return input.runningProjectId
  }

  if (input.lastProjectId && assignable.has(input.lastProjectId)) {
    return input.lastProjectId
  }

  // Only projects the picker can display count towards "exactly one visible".
  const visibleAndAssignable = new Set(input.visibleProjectIds.filter((id) => assignable.has(id)))
  if (visibleAndAssignable.size === 1) {
    return [...visibleAndAssignable][0]
  }

  if (assignable.size === 1) {
    return [...assignable][0]
  }

  return null
}
