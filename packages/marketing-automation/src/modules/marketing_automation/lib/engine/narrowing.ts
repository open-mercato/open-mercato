import type { ConditionExpression, GroupCondition, SimpleCondition } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'

/**
 * Translates an audience expression into a database-side narrowing.
 *
 * The sweep's cost is not the matching, it is the projecting: building a subject document costs a
 * decrypting read plus three queries, and doing that for every person in an organization to find
 * the few hundred who match is the difference between a sweep that finishes and one that does not.
 * So before projecting anything, ask the database which customers could possibly match.
 *
 * **The one rule that makes this safe: a narrowing may only ever return a SUPERSET of the audience.**
 * `matchesAudience` remains the sole authority on whether a subject belongs, and it runs on every
 * candidate the narrowing hands back. A narrowing that is merely imprecise costs a few wasted
 * projections; a narrowing that is too tight silently stops mailing customers who qualify, and
 * nothing in the system would report it. Every decision below therefore resolves ambiguity by
 * widening, and anything that cannot be translated with certainty is not translated at all.
 *
 * This is also what segments will be built on: a narrowing that covers the whole expression
 * (`complete`) is an exact audience definition, which is what makes counting one possible.
 */

/** Aggregates over a customer's non-cancelled, placed orders. */
export type OrderMetric = 'count' | 'totalGross' | 'daysSinceLast'

export type ComparisonOp = '=' | '>' | '>=' | '<' | '<='

export type NarrowingPredicate =
  | { kind: 'hasTag'; slug: string }
  | { kind: 'hasAnyTag' }
  | { kind: 'orderMetric'; metric: OrderMetric; op: ComparisonOp; value: number }
  | { kind: 'scorePoints'; op: ComparisonOp; value: number }
  | { kind: 'purchasedSku'; sku: string }
  | { kind: 'purchasedCategory'; slug: string }
  | { kind: 'purchasedInChannel'; code: string }
  | { kind: 'npsScore'; op: ComparisonOp; value: number }
  | { kind: 'engagedEvent'; type: 'opened' | 'clicked' }
  | { kind: 'silentSince'; days: number }

export type Narrowing =
  /** Every subject is a candidate — the expression said nothing the database can answer. */
  | { kind: 'all' }
  /** No subject can match, so there is nothing to sweep at all. */
  | { kind: 'none' }
  | { kind: 'predicate'; predicate: NarrowingPredicate }
  | { kind: 'and'; parts: Narrowing[] }
  | { kind: 'or'; parts: Narrowing[] }

export type NarrowingPlan = {
  narrowing: Narrowing
  /**
   * True when the narrowing expresses the audience EXACTLY, so its size is the audience size.
   * False whenever a leaf was ignored or a bound was widened.
   */
  complete: boolean
  /** What was pushed down, for the sweep log and for explaining an estimate to an author. */
  pushed: NarrowingPredicate[]
}

export const UNCONSTRAINED: Narrowing = { kind: 'all' }

const NUMERIC_OPS = new Set<string>(['=', '==', '>', '>=', '<', '<='])

function normalizeOp(operator: string): ComparisonOp | null {
  if (operator === '==' || operator === '=') return '='
  if (operator === '>' || operator === '>=' || operator === '<' || operator === '<=') return operator
  return null
}

function numericValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim()) {
    // A template value such as `{{now}}` is resolved per evaluation and is not a number here.
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isGroup(expression: ConditionExpression): expression is GroupCondition {
  return Array.isArray((expression as GroupCondition).rules)
}

/**
 * Whether a comparison on an order aggregate implies the customer has ordered at all.
 *
 * This is the subtlest correctness point in the file. The aggregate query can only return customers
 * who HAVE orders, so `orders.count <= 5` — which is true for somebody who never ordered — must not
 * be pushed down: it would drop every never-buyer from a campaign that includes them.
 */
function impliesAtLeastOneOrder(metric: OrderMetric, op: ComparisonOp, value: number): boolean {
  // Having a recency at all means having an order, whatever the comparison says about it.
  if (metric === 'daysSinceLast') return true
  if (metric === 'count') {
    if (op === '=' || op === '>=') return value >= 1
    if (op === '>') return value >= 0
    return false
  }
  // An order can legitimately total zero, so only a strictly positive threshold excludes the
  // never-buyers; `totalGross >= 0` would be true for them as well.
  if (op === '=' || op === '>=') return value > 0
  if (op === '>') return value >= 0
  return false
}

type LeafTranslation = { predicate: NarrowingPredicate; exact: boolean } | null

function translateLeaf(leaf: SimpleCondition): LeafTranslation {
  const field = typeof leaf.field === 'string' ? leaf.field : ''
  const operator = String(leaf.operator ?? '')

  if (field === 'tags') {
    // Only the positive forms. `NOT_CONTAINS` and `IS_EMPTY` describe an absence, which a
    // membership query cannot produce as a superset without listing every customer first.
    if (operator === 'CONTAINS') {
      const slug = typeof leaf.value === 'string' ? leaf.value.trim() : ''
      return slug ? { predicate: { kind: 'hasTag', slug }, exact: true } : null
    }
    if (operator === 'IS_NOT_EMPTY') return { predicate: { kind: 'hasAnyTag' }, exact: true }
    return null
  }

  /**
   * Every comparison on an NPS score is pushable, which is worth contrasting with the order aggregates
   * right below.
   *
   * There the trap is that a customer with no orders has a REAL value of zero, so `orders.count <= 5` is
   * true for them and the aggregate query cannot return them. Here a customer who never answered has null,
   * and `matchesAudience` vetoes every magnitude comparison against null — so a non-answerer can never
   * match, and restricting candidates to answerers is therefore a superset rather than a subset. The rule
   * was always about semantics, not about which table the number came from.
   */
  if (field === 'survey.nps') {
    if (!NUMERIC_OPS.has(operator)) return null
    const op = normalizeOp(operator)
    const value = numericValue(leaf.value)
    if (!op || value === null) return null
    return { predicate: { kind: 'npsScore', op, value }, exact: true }
  }

  /**
   * Channel membership is a join on orders, exactly like a SKU, so it pushes down the same way.
   *
   * Only the positive form: `NOT CONTAINS` describes an absence, and a membership query cannot produce that as
   * a superset without listing every customer first.
   */
  if (field === 'orders.channels') {
    if (operator === 'CONTAINS') {
      const code = typeof leaf.value === 'string' ? leaf.value.trim() : ''
      return code ? { predicate: { kind: 'purchasedInChannel', code }, exact: true } : null
    }
    return null
  }

  if (field === 'orders.skus') {
    // Only membership. "Has not bought X" describes an absence, which a join cannot produce as a
    // superset without listing every customer first.
    if (operator !== 'CONTAINS') return null
    const sku = typeof leaf.value === 'string' ? leaf.value.trim() : ''
    return sku ? { predicate: { kind: 'purchasedSku', sku }, exact: true } : null
  }

  /**
   * A category is a join on orders too, so it pushes down the same way — and only in the positive form.
   *
   * `exact: true` is the claim that the SQL and `matchesAudience` agree, and here they do because both read the
   * same live assignment table. That is only true BECAUSE the category list comes from the catalogue rather than
   * from the order snapshot: were it read from the snapshot per customer, the pushdown would be comparing a
   * different fact and could drop somebody the audience accepts.
   */
  if (field === 'orders.categories') {
    if (operator !== 'CONTAINS') return null
    const slug = typeof leaf.value === 'string' ? leaf.value.trim() : ''
    return slug ? { predicate: { kind: 'purchasedCategory', slug }, exact: true } : null
  }

  /**
   * Address fields are deliberately NOT translatable.
   *
   * Every column of a customer address is encrypted at rest, so a SQL comparison would run against
   * ciphertext and match nothing — silently, which is the worst possible failure for an audience. A
   * geographic campaign is therefore evaluated per customer, which is slower and correct.
   */
  if (field.startsWith('address.')) return null

  /**
   * Engagement, in the two directions a join can actually produce.
   *
   * `opened >= 1` and `clicked >= 1` are existence: the event table can return exactly the customers who have
   * one. Everything else here is an ABSENCE — "never opened", "opened at most twice" — and a join cannot produce
   * an absence as a superset without listing every customer first. Same shape as the score ledger, and the same
   * reason.
   */
  if (field === 'engagement.opened' || field === 'engagement.clicked') {
    if (!NUMERIC_OPS.has(operator)) return null
    const op = normalizeOp(operator)
    const value = numericValue(leaf.value)
    if (!op || value === null) return null
    const impliesAnEvent = (op === '=' || op === '>=') ? value >= 1 : op === '>' ? value >= 0 : false
    if (!impliesAnEvent) return null
    const type = field === 'engagement.opened' ? 'opened' : 'clicked'
    /**
     * Not exact: the query returns everybody with at least one such event, while the audience may be asking for
     * at least three. A superset is all a narrowing promises, and `matchesAudience` decides membership.
     */
    return { predicate: { kind: 'engagedEvent', type }, exact: op === '>=' && value === 1 }
  }

  /**
   * The sunset predicate, and the only interesting one to push down.
   *
   * `daysSinceEngaged >= 180` is "no sign of life in six months", and it is ABSENT for anybody we have never
   * written to — so the SQL can compute it exactly, from the same two halves the subject document uses. Only the
   * `>=` and `>` directions: "engaged recently" is satisfied by a customer with no sends at all in the document
   * (absent, so false) but the query would have to invent them, and a narrowing that adds nobody is useless
   * while one that drops somebody is wrong.
   */
  if (field === 'engagement.daysSinceEngaged') {
    if (operator !== '>=' && operator !== '>') return null
    const value = numericValue(leaf.value)
    if (value === null || value < 0) return null
    return { predicate: { kind: 'silentSince', days: operator === '>' ? value + 1 : value }, exact: true }
  }

  if (field === 'score.points') {
    if (!NUMERIC_OPS.has(operator)) return null
    const op = normalizeOp(operator)
    const value = numericValue(leaf.value)
    if (!op || value === null) return null
    // Same trap as the order aggregates: the ledger can only return customers who HAVE entries, and a
    // customer who never scored has a total of zero, so `score.points <= 5` is true for them and must
    // not be pushed down.
    const impliesAnEntry = (op === '=' || op === '>=') ? value >= 1 : op === '>' ? value >= 0 : false
    if (!impliesAnEntry) return null
    return { predicate: { kind: 'scorePoints', op, value }, exact: true }
  }

  if (field === 'orders.count' || field === 'orders.totalGross' || field === 'orders.daysSinceLast') {
    if (!NUMERIC_OPS.has(operator)) return null
    const op = normalizeOp(operator)
    const value = numericValue(leaf.value)
    if (!op || value === null) return null
    const metric: OrderMetric = field === 'orders.count'
      ? 'count'
      : field === 'orders.totalGross' ? 'totalGross' : 'daysSinceLast'
    if (!impliesAtLeastOneOrder(metric, op, value)) return null
    // A recency bound is widened by a day when it reaches SQL (see `recencyBounds`), so it is a
    // superset rather than an exact translation.
    return { predicate: { kind: 'orderMetric', metric, op, value }, exact: metric !== 'daysSinceLast' }
  }

  return null
}

/** AND: an untranslatable child simply contributes nothing, which keeps the result a superset. */
function combineAnd(parts: Narrowing[]): Narrowing {
  if (parts.some((part) => part.kind === 'none')) return { kind: 'none' }
  const constrained = parts.filter((part) => part.kind !== 'all')
  if (constrained.length === 0) return { kind: 'all' }
  if (constrained.length === 1) return constrained[0]
  return { kind: 'and', parts: constrained }
}

/**
 * OR: one untranslatable child makes the WHOLE group untranslatable.
 *
 * Intersecting would be wrong and unioning the rest would be too tight: a subject matching only the
 * branch we could not express would never be projected, and would never be mailed.
 */
function combineOr(parts: Narrowing[]): Narrowing {
  if (parts.some((part) => part.kind === 'all')) return { kind: 'all' }
  const possible = parts.filter((part) => part.kind !== 'none')
  if (possible.length === 0) return { kind: 'none' }
  if (possible.length === 1) return possible[0]
  return { kind: 'or', parts: possible }
}

function collectPushed(narrowing: Narrowing, into: NarrowingPredicate[]): void {
  if (narrowing.kind === 'predicate') into.push(narrowing.predicate)
  if (narrowing.kind === 'and' || narrowing.kind === 'or') {
    for (const part of narrowing.parts) collectPushed(part, into)
  }
}

type PlanNode = { narrowing: Narrowing; complete: boolean }

function planNode(expression: ConditionExpression): PlanNode {
  if (isGroup(expression)) {
    const rules = expression.rules ?? []
    // An empty group excludes everybody (`EMPTY_GROUP_RESULT`), so there is nothing to sweep.
    if (rules.length === 0) return { narrowing: { kind: 'none' }, complete: true }

    // NOT is never translated. Negating a membership or an aggregate correctly means reasoning
    // about the customers the query did NOT return, which is the whole population again.
    if (expression.operator === 'NOT') return { narrowing: UNCONSTRAINED, complete: false }

    const children = rules.map(planNode)
    if (expression.operator === 'OR') {
      const narrowing = combineOr(children.map((child) => child.narrowing))
      const complete = narrowing.kind !== 'all' && children.every((child) => child.complete)
      return { narrowing, complete }
    }

    const narrowing = combineAnd(children.map((child) => child.narrowing))
    // An AND is exact only when every one of its parts is; a dropped child leaves a superset.
    const complete = narrowing.kind === 'none' || children.every((child) => child.complete)
    return { narrowing, complete: complete && narrowing.kind !== 'all' }
  }

  const translated = translateLeaf(expression)
  if (!translated) return { narrowing: UNCONSTRAINED, complete: false }
  return { narrowing: { kind: 'predicate', predicate: translated.predicate }, complete: translated.exact }
}

/**
 * Plans the database-side narrowing for an audience.
 *
 * A campaign with no audience matches everyone the trigger produces, which is `all` — and exactly
 * so, which is why an estimate for it can state the population size rather than a lower bound.
 */
export function planNarrowing(audience: ConditionExpression | null | undefined): NarrowingPlan {
  if (!audience) return { narrowing: UNCONSTRAINED, complete: true, pushed: [] }
  const { narrowing, complete } = planNode(audience)
  const pushed: NarrowingPredicate[] = []
  collectPushed(narrowing, pushed)
  return { narrowing, complete, pushed }
}

/**
 * The `placed_at` window a recency comparison becomes, in days before now.
 *
 * `daysSinceLast` is whole days floored, so an exact SQL bound would sit within a day of the
 * boundary the evaluator uses. Each bound is therefore widened by a day: the extra candidates are
 * rejected by `matchesAudience`, whereas a bound a day too tight would silently drop customers on
 * the boundary from every sweep.
 */
export function recencyBounds(op: ComparisonOp, value: number): { minDaysAgo?: number; maxDaysAgo?: number } {
  switch (op) {
    case '>':
    case '>=':
      // At least this long ago: no upper bound on age, lower bound widened towards the present.
      return { minDaysAgo: Math.max(0, value - 1) }
    case '<':
    case '<=':
      // At most this long ago: widened away from the present.
      return { maxDaysAgo: value + 2 }
    case '=':
    default:
      return { minDaysAgo: Math.max(0, value - 1), maxDaysAgo: value + 2 }
  }
}

/** A stable, loggable summary of what went to the database. */
export function describeNarrowing(plan: NarrowingPlan): string {
  if (plan.narrowing.kind === 'all') return 'all'
  if (plan.narrowing.kind === 'none') return 'none'
  return plan.pushed
    .map((predicate) => {
      if (predicate.kind === 'hasTag') return `tag:${predicate.slug}`
      if (predicate.kind === 'hasAnyTag') return 'tag:*'
      if (predicate.kind === 'scorePoints') return `score.points${predicate.op}${predicate.value}`
      if (predicate.kind === 'purchasedSku') return `sku:${predicate.sku}`
      if (predicate.kind === 'purchasedCategory') return `category:${predicate.slug}`
      if (predicate.kind === 'purchasedInChannel') return `channel:${predicate.code}`
      if (predicate.kind === 'npsScore') return `survey.nps${predicate.op}${predicate.value}`
      if (predicate.kind === 'engagedEvent') return `engagement.${predicate.type}>=1`
      if (predicate.kind === 'silentSince') return `engagement.daysSinceEngaged>=${predicate.days}`
      return `orders.${predicate.metric}${predicate.op}${predicate.value}`
    })
    .join(plan.narrowing.kind === 'or' ? '|' : '&')
}
