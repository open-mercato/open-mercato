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
    assignments.every((assignment) => {
      if (!isPlainObject(assignment) || typeof assignment.path !== 'string') return false
      const segments = splitAssignmentPath(assignment.path)
      return segments !== null && segments.length > 0
    })
  )
}

const FORBIDDEN_ASSIGNMENT_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Splits a dot path into trimmed, non-empty segments. Returns `null` when any
 * segment is a prototype-pollution vector (`__proto__`, `constructor`,
 * `prototype`) — such an assignment is never legitimate, so callers reject the
 * whole assignment instead of applying it.
 */
export function splitAssignmentPath(path: string): string[] | null {
  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  if (segments.some((segment) => FORBIDDEN_ASSIGNMENT_SEGMENTS.has(segment))) return null
  return segments
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
    if (segments === null || segments.length === 0) continue
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
