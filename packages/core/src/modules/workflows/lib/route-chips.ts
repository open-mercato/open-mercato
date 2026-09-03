/**
 * Workflows Module - Route Chips (pure)
 *
 * Derives what a transition renders ALONG its edge (spec
 * 2026-07-26-workflows-ux-redesign.md section 4.4, issue #4244): a compact
 * condition summary, the activities that run on the route as icon chips, and
 * the `otherwise` marker for the one unconditioned route of a branching node.
 *
 * The model is DERIVED, never stored: nothing here writes back into edge data
 * or the definition, so chips can never change the saved shape of a workflow.
 * PURE — no React, no xyflow, no registry: the caller supplies already-read
 * edge data and the activity icon lookup.
 */

/** Activity chips beyond this cap collapse into a single `+N` badge. */
export const ROUTE_CHIP_LIMIT = 3

/**
 * Below this canvas zoom the chip row collapses to dots (semantic zoom). Picked
 * so a 60-node flow zoomed out to fit stays readable as structure rather than
 * as a wall of text.
 */
export const ROUTE_CHIP_ZOOM_THRESHOLD = 0.6

/** Longest condition summary rendered before it is elided. */
export const CONDITION_SUMMARY_MAX_LENGTH = 28

export type RouteChipSection = 'condition' | 'activities'

export interface RouteActivityChip {
  activityId: string
  activityType: string
}

export interface RouteChipModel {
  conditionSummary: string | null
  activities: RouteActivityChip[]
  overflowCount: number
  isOtherwise: boolean
  isEmpty: boolean
}

export interface RouteChipInput {
  condition?: unknown
  preConditions?: unknown
  activities?: unknown
  /** True when a sibling route leaving the same step carries a condition. */
  hasConditionedSibling?: boolean
}

interface SimpleConditionLike {
  field: string
  operator: string
  value?: unknown
  valueField?: string
}

interface GroupConditionLike {
  operator: string
  rules: unknown[]
}

/** Operators that read as a complete predicate on their own. */
const VALUELESS_OPERATORS = new Set(['IS_EMPTY', 'IS_NOT_EMPTY'])

function isGroupLike(value: unknown): value is GroupConditionLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as GroupConditionLike).operator === 'string' &&
      Array.isArray((value as GroupConditionLike).rules),
  )
}

function isSimpleLike(value: unknown): value is SimpleConditionLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as SimpleConditionLike).field === 'string' &&
      typeof (value as SimpleConditionLike).operator === 'string',
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((entry) => formatValue(entry)).join(',')
  if (typeof value === 'object') return '{…}'
  return String(value)
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function summarizeSimple(condition: SimpleConditionLike): string {
  const operator = condition.operator === '==' ? '=' : condition.operator
  if (VALUELESS_OPERATORS.has(condition.operator)) {
    return `${condition.field} ${operator}`
  }
  const right = condition.valueField ? condition.valueField : formatValue(condition.value)
  return right ? `${condition.field} ${operator} ${right}` : `${condition.field} ${operator}`
}

/**
 * Compact `field op value` rendering of a business_rules `ConditionExpression`.
 * A group summarises to its first rule plus a `+N` suffix for the rest, which is
 * what makes the chip readable at a glance; the full expression stays one click
 * away in the condition editor. Returns null when there is nothing to show.
 */
export function summarizeConditionExpression(
  condition: unknown,
  maxLength: number = CONDITION_SUMMARY_MAX_LENGTH,
): string | null {
  if (isSimpleLike(condition)) return truncate(summarizeSimple(condition), maxLength)

  if (isGroupLike(condition)) {
    const rules = condition.rules
    const first = rules.find((rule) => isSimpleLike(rule) || isGroupLike(rule))
    if (!first) return null
    const head = summarizeConditionExpression(first, maxLength)
    if (!head) return null
    const remaining = rules.length - 1
    if (remaining <= 0) return head
    return truncate(`${head} +${remaining}`, maxLength + 4)
  }

  return null
}

function readActivities(raw: unknown): RouteActivityChip[] {
  if (!Array.isArray(raw)) return []
  const chips: RouteActivityChip[] = []
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    const activityType = (entry as { activityType?: unknown }).activityType
    if (typeof activityType !== 'string' || activityType.length === 0) return
    const activityId = (entry as { activityId?: unknown }).activityId
    chips.push({
      activityId: typeof activityId === 'string' && activityId ? activityId : `${activityType}-${index}`,
      activityType,
    })
  })
  return chips
}

function hasRuleReference(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0
}

/**
 * The chip row for one transition. `isOtherwise` marks the default route: it
 * carries no condition of its own while a sibling leaving the same step does —
 * exactly the `ensureOtherwiseRoute` reading used by branching nodes, computed
 * here from the live graph so it stays true for hand-wired routes too.
 */
export function buildRouteChipModel(input: RouteChipInput): RouteChipModel {
  const conditionSummary = summarizeConditionExpression(input.condition)
  const allActivities = readActivities(input.activities)
  const activities = allActivities.slice(0, ROUTE_CHIP_LIMIT)
  const overflowCount = Math.max(0, allActivities.length - activities.length)
  const carriesCondition = conditionSummary !== null || hasRuleReference(input.preConditions)
  const isOtherwise = !carriesCondition && Boolean(input.hasConditionedSibling)

  return {
    conditionSummary,
    activities,
    overflowCount,
    isOtherwise,
    isEmpty: conditionSummary === null && allActivities.length === 0 && !isOtherwise,
  }
}

/** Route data carries a condition (inline expression or business-rule reference). */
export function routeCarriesCondition(input: { condition?: unknown; preConditions?: unknown }): boolean {
  return summarizeConditionExpression(input.condition) !== null || hasRuleReference(input.preConditions)
}
