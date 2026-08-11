import type { ProcessEventTriggerConfig } from '../../data/validators'

/**
 * Local, dependency-free mirror of the `workflows` event-trigger matching
 * semantics (`eventPattern` + `filterConditions` + `contextMapping`). Kept
 * module-local instead of importing `workflows`' lib functions — that module's
 * AGENTS.md forbids direct lib imports, and the shapes are deliberately
 * identical so a trigger config is portable between the two.
 */

type FilterCondition = NonNullable<ProcessEventTriggerConfig['filterConditions']>[number]
type ContextMapping = NonNullable<ProcessEventTriggerConfig['contextMapping']>[number]

/** Exact match, or a trailing `.*` wildcard (`claims.*` matches `claims.claim.reported`). */
export function matchesEventPattern(pattern: string, eventName: string): boolean {
  if (pattern === eventName) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1)
    return eventName.startsWith(prefix)
  }
  return false
}

/**
 * Every `eventPattern` that CAN match `eventName`, enumerated exactly.
 *
 * The spec assumed wildcard patterns could not be served by jsonb containment
 * and would need a filtered scan over enabled definitions. They can: the match
 * rule above is prefix-only and anchored at a dot, so the matching pattern set
 * is finite and tiny — the exact id plus one wildcard per dot position
 * (`a.b.c` → `a.b.c`, `a.*`, `a.b.*`). Each is a separate containment probe
 * that the `agent_process_definitions_triggers_gin` index serves, so the
 * dispatcher never scans.
 *
 * `matchesEventPattern` is still applied to the loaded rows: containment is the
 * narrowing index probe, this function's completeness is what makes it safe,
 * and the in-memory re-check is what makes a mistake in either impossible to
 * turn into a wrong dispatch.
 */
export function candidateEventPatterns(eventName: string): string[] {
  const patterns = [eventName]
  const segments = eventName.split('.')
  for (let index = 1; index < segments.length; index += 1) {
    patterns.push(`${segments.slice(0, index).join('.')}.*`)
  }
  return patterns
}

export function getNestedValue(payload: Record<string, unknown>, path: string): unknown {
  let current: unknown = payload
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function evaluateCondition(condition: FilterCondition, payload: Record<string, unknown>): boolean {
  const value = getNestedValue(payload, condition.field)
  const expected = condition.value
  switch (condition.operator) {
    case 'eq':
      return value === expected
    case 'neq':
      return value !== expected
    case 'gt':
      return typeof value === 'number' && typeof expected === 'number' && value > expected
    case 'gte':
      return typeof value === 'number' && typeof expected === 'number' && value >= expected
    case 'lt':
      return typeof value === 'number' && typeof expected === 'number' && value < expected
    case 'lte':
      return typeof value === 'number' && typeof expected === 'number' && value <= expected
    case 'contains':
      if (typeof value === 'string' && typeof expected === 'string') return value.includes(expected)
      if (Array.isArray(value)) return value.includes(expected)
      return false
    case 'startsWith':
      return typeof value === 'string' && typeof expected === 'string' && value.startsWith(expected)
    case 'endsWith':
      return typeof value === 'string' && typeof expected === 'string' && value.endsWith(expected)
    case 'in':
      return Array.isArray(expected) && expected.includes(value)
    case 'notIn':
      return Array.isArray(expected) && !expected.includes(value)
    case 'exists':
      return value !== undefined && value !== null
    case 'notExists':
      return value === undefined || value === null
    default:
      return false
  }
}

/** All conditions must pass (AND logic); no conditions means match. */
export function evaluateFilterConditions(
  conditions: FilterCondition[] | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((condition) => evaluateCondition(condition, payload))
}

/** Build the process-run input from the event payload via the trigger's context mapping. */
export function mapEventToInput(
  mapping: ContextMapping[] | undefined,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  if (!mapping || mapping.length === 0) return input
  for (const item of mapping) {
    const value = getNestedValue(payload, item.sourceExpression)
    input[item.targetKey] = value !== undefined ? value : item.defaultValue
  }
  return input
}
