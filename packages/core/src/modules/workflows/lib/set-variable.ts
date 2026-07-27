/**
 * Workflows Module - SET_VARIABLE context assignment helpers
 *
 * Pure path-application logic for the SET_VARIABLE activity type. The engine
 * merges sync activity outputs into workflow context under a namespaced key
 * (activityName || activityType); SET_VARIABLE instead lands each assignment
 * at its dot path in top-level context (spec 2026-07-26-workflows-ux-redesign
 * section 3.2). Both sync merge points — the intra-transition merge in
 * activity-executor's executeActivities and the persistence merge in
 * transition-handler — detect SET_VARIABLE outputs with `isSetVariableOutput`
 * and apply `buildSetVariableContextPatch` instead of namespacing.
 *
 * Kept in its own pure module (no React, no ORM, no container) so
 * transition-handler tests exercise the real path application even when the
 * whole activity-executor module is mocked.
 */

export interface SetVariableAssignment {
  path: string
  value?: unknown
}

export interface SetVariableOutput {
  assignments: SetVariableAssignment[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSetVariableOutput(output: unknown): output is SetVariableOutput {
  if (!isPlainObject(output)) return false
  const assignments = output.assignments
  return (
    Array.isArray(assignments) &&
    assignments.every(
      (assignment) =>
        isPlainObject(assignment) &&
        typeof assignment.path === 'string' &&
        splitAssignmentPath(assignment.path).length > 0,
    )
  )
}

export function splitAssignmentPath(path: string): string[] {
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/**
 * Build a shallow top-level patch that lands every assignment at its dot
 * path. Nested paths clone the existing objects along the way (the base is
 * never mutated) and preserve sibling keys; missing or non-object
 * intermediates become fresh objects. Later assignments in the same batch see
 * earlier ones. The result spreads into the engine's existing shallow context
 * merge without clobbering untouched top-level keys.
 */
export function buildSetVariableContextPatch(
  baseContext: Record<string, unknown>,
  assignments: SetVariableAssignment[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const assignment of assignments) {
    const segments = splitAssignmentPath(assignment.path)
    if (segments.length === 0) continue
    const [rootKey, ...nestedSegments] = segments
    if (nestedSegments.length === 0) {
      patch[rootKey] = assignment.value
      continue
    }
    const currentRoot = rootKey in patch ? patch[rootKey] : baseContext[rootKey]
    const clonedRoot: Record<string, unknown> = isPlainObject(currentRoot) ? { ...currentRoot } : {}
    let cursor = clonedRoot
    for (const segment of nestedSegments.slice(0, -1)) {
      const nextValue = cursor[segment]
      cursor[segment] = isPlainObject(nextValue) ? { ...nextValue } : {}
      cursor = cursor[segment] as Record<string, unknown>
    }
    cursor[nestedSegments[nestedSegments.length - 1]] = assignment.value
    patch[rootKey] = clonedRoot
  }
  return patch
}
