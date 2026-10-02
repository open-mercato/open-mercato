import type { EntityManager } from '@mikro-orm/postgresql'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingScoreRule } from '../data/entities.js'
import { emitMarketingAutomationEvent } from '../events.js'
import { matchesAudience } from './engine/audience.js'
import { SEGMENTS_FIELD, expressionReferencesField } from './engine/segment-expression.js'
import type { EngineLogger, SubjectDocument } from './engine/types.js'
import { addScoreEntry, loadRuleScoreState } from './scores.js'
import { buildSubjectDocument } from './subject-document.js'
import type { SubjectScope } from './subject-document.js'
import type { ValueBoundaries } from './engine/rfm.js'
import { CUSTOMER_ENTITIES } from './external/tables.js'

/**
 * Score rules: points for who a customer IS.
 *
 * A campaign's `add_points` step scores what happened; a rule scores a standing fact — "lives in Poland",
 * "has the b2b tag", "has spent over 1000". The rule's condition is the same expression a segment holds, so there
 * is no second condition language and no second evaluator.
 *
 * What the rules award a customer is kept in the ledger as the running sum of `rule` entries. Re-evaluating writes
 * only the DIFFERENCE between what they award now and what they awarded before, so a customer who matched a
 * +10 rule yesterday and still matches it today gains nothing, and one who stopped matching loses the 10.
 */

/** The subject-document key a rule may not read: its own points would feed back into it. */
export const SCORE_FIELD = 'score'

/** The job-log kind of the full re-evaluation pass; also the sweep's "already done today" answer. */
export const SCORE_RULES_JOB_KIND = 'rule_scores'

/** Rules evaluated per subject. The same bound segments have, for the same reason: this runs per customer. */
export const MAX_EVALUATED_SCORE_RULES = 200

/** Longest reason written to the ledger; the profile shows it on one line. */
const MAX_REASON_LENGTH = 200

export type ScoreRuleDefinition = {
  id: string
  name: string
  points: number
  expression: ConditionExpression | null
}

export type RuleMatch = {
  points: number
  matched: Array<{ id: string; name: string; points: number }>
}

export type RuleScoreOutcome = {
  /** False when nothing changed, or when an overlapping evaluation of the same customer wrote first. */
  applied: boolean
  previousPoints: number
  points: number
  delta: number
  matched: RuleMatch['matched']
}

/**
 * Whether an expression reads a field a rule must not.
 *
 * `score` is the obvious one. `segments` is refused too, because a segment may be defined on score, and a rule
 * defined on that segment would be a rule defined on score by one step of indirection.
 */
export function isForbiddenRuleExpression(expression: unknown): boolean {
  return expressionReferencesField(expression, SCORE_FIELD) || expressionReferencesField(expression, SEGMENTS_FIELD)
}

export async function loadScoreRules(em: EntityManager, scope: SubjectScope): Promise<ScoreRuleDefinition[]> {
  const rows = await em.find(
    MarketingScoreRule,
    { ...scope, isEnabled: true, deletedAt: null },
    { orderBy: { name: 'ASC', id: 'ASC' }, limit: MAX_EVALUATED_SCORE_RULES },
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    points: row.points,
    expression: (row.expression ?? null) as ConditionExpression | null,
  }))
}

const QUIET_LOGGER: EngineLogger = {
  info() { /* a rule evaluated per customer is not an event worth logging */ },
  warn() { /* as above */ },
  error() { /* as above */ },
}

/**
 * The points a subject's rules award, and which rules award them.
 *
 * Evaluated against the document with `score` zeroed and `segments` emptied. The writer already refuses a rule
 * that reads either; this makes that refusal unnecessary to trust, the same way segment membership does.
 */
export function computeRuleMatch(subject: SubjectDocument, rules: ScoreRuleDefinition[], now: Date): RuleMatch {
  const blinded = {
    ...subject,
    score: { points: 0, tier: null, tierRank: -1 },
    [SEGMENTS_FIELD]: [],
  } as SubjectDocument
  const matched: RuleMatch['matched'] = []
  let points = 0
  for (const rule of rules) {
    if (!matchesAudience(rule.expression, blinded, { now, logger: QUIET_LOGGER })) continue
    matched.push({ id: rule.id, name: rule.name, points: rule.points })
    points += rule.points
  }
  return { points, matched }
}

/** The ledger reason: the rules that match now, in the author's own names. Null when none does. */
export function describeRuleMatch(matched: RuleMatch['matched']): string | null {
  if (matched.length === 0) return null
  const text = matched
    .map((rule) => `${rule.name} ${rule.points > 0 ? '+' : ''}${rule.points}`)
    .join(', ')
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text
}

export type ApplyRuleScoreOptions = {
  /** Loaded once by a caller that evaluates many customers; read here when omitted. */
  rules?: ScoreRuleDefinition[]
  valueBoundaries?: ValueBoundaries
  valueHorizonYears?: number
}

/**
 * Brings one customer's rule points up to date, and announces a change.
 *
 * The next entry claims sequence number `entries` — how many rule entries the customer already has. An evaluation
 * that overlaps with another one read the same count, claims the same number and collides on the unique index,
 * which is exactly the double-count this prevents. The event carries the previous total as well as the new one,
 * as `add_points` does, so a campaign can react to crossing a threshold rather than to being above it.
 */
export async function applyRuleScore(
  em: EntityManager,
  scope: SubjectScope,
  subjectEntityId: string,
  now: Date,
  options: ApplyRuleScoreOptions = {},
): Promise<RuleScoreOutcome> {
  // Before anything else: a company, a deleted customer or an erased person must not start a ledger.
  if (!(await isScorableSubject(em, subjectEntityId, scope))) {
    return { applied: false, previousPoints: 0, points: 0, delta: 0, matched: [] }
  }

  const rules = options.rules ?? await loadScoreRules(em, scope)
  const state = await loadRuleScoreState(em, subjectEntityId, scope)

  let match: RuleMatch = { points: 0, matched: [] }
  if (rules.length > 0) {
    const subject = await buildSubjectDocument(em, subjectEntityId, scope, {}, now, {
      // Rules cannot read segments, so evaluating two hundred of them per customer would be work thrown away.
      segments: [],
      valueBoundaries: options.valueBoundaries,
      valueHorizonYears: options.valueHorizonYears,
    })
    // Deleted between the check above and this read.
    if (!subject.customer) {
      return { applied: false, previousPoints: 0, points: 0, delta: 0, matched: [] }
    }
    match = computeRuleMatch(subject, rules, now)
  }

  const delta = match.points - state.points
  if (delta === 0) {
    return { applied: false, previousPoints: 0, points: 0, delta: 0, matched: match.matched }
  }

  const result = await addScoreEntry(em, {
    scope,
    subjectEntityId,
    points: delta,
    reason: describeRuleMatch(match.matched),
    source: 'rule',
    ruleSequence: state.entries,
    now,
  })
  if (!result.applied) {
    return { applied: false, previousPoints: result.previousPoints, points: result.points, delta: 0, matched: match.matched }
  }

  await emitMarketingAutomationEvent('marketing_automation.score.changed', {
    entityId: subjectEntityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    points: result.points,
    previousPoints: result.previousPoints,
    delta,
    source: 'rule',
  }, { persistent: true })

  return { applied: true, previousPoints: result.previousPoints, points: result.points, delta, matched: match.matched }
}

/**
 * Whether rules may score this subject at all: a live PERSON whose marketing data was never erased.
 *
 * A tag event can be about a company, and rules describe people. And an erased person must stay erased: erasure
 * unlinks their ledger, so without this check the next pass would find a customer with no rule points, see that
 * the rules award some, and start building a profile again for somebody who asked to be forgotten.
 */
export async function isScorableSubject(em: EntityManager, subjectEntityId: string, scope: SubjectScope): Promise<boolean> {
  const rows = await em.getConnection().execute<Array<{ kind: string; erased: boolean }>>(
    `select c.kind,
            exists (
              select 1 from marketing_subject_erasures e
               where e.subject_entity_id = c.id and e.tenant_id = c.tenant_id and e.organization_id = c.organization_id
            ) as erased
       from ${CUSTOMER_ENTITIES} c
      where c.id = ? and c.tenant_id = ? and c.organization_id = ? and c.deleted_at is null`,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  const row = rows[0]
  return Boolean(row) && row.kind === 'person' && !row.erased
}

/**
 * Whether evaluating this scope can change anything at all.
 *
 * The person subscribers run on every customer save in the system, so on an installation that has never defined
 * a rule this must cost one probe, not a subject document. Rule entries count as well as rules: deleting the last
 * rule still has to take its points back.
 */
export async function scoreRulesInPlay(em: EntityManager, scope: SubjectScope): Promise<boolean> {
  const rows = await em.getConnection().execute<Array<{ present: number }>>(
    `select 1 as present from marketing_score_rules
      where tenant_id = ? and organization_id = ? and is_enabled = true and deleted_at is null
     union all
     select 1 as present from marketing_customer_score_entries
      where tenant_id = ? and organization_id = ? and rule_sequence is not null
     limit 1`,
    [scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId],
  )
  return rows.length > 0
}
