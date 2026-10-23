import type { EntityManager } from '@mikro-orm/postgresql'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingSegment } from '../data/entities.js'
import { matchesAudience } from './engine/audience.js'
import { SEGMENTS_FIELD } from './engine/segment-expression.js'
import type { SubjectDocument } from './engine/types.js'
import type { EngineLogger } from './engine/types.js'

/**
 * Saved segments: loading their definitions and deciding who is in them.
 *
 * A segment adds no new machinery. Its definition is the same condition expression a campaign audience uses,
 * so membership is `matchesAudience` against a subject document — which means every rule the audience
 * evaluator already enforces (the missing-operand veto above all) applies to segments for free.
 */

export type SegmentScope = { tenantId: string; organizationId: string }

export type SegmentDefinition = {
  id: string
  slug: string
  name: string
  expression: ConditionExpression | null
}

/**
 * How many segments are evaluated per subject.
 *
 * Membership costs no queries — the subject document is already in memory — but it is not free, and it runs
 * per customer on every dispatch and every sweep candidate. A tenant with two hundred segments has a
 * different problem from the one this cap creates.
 */
export const MAX_EVALUATED_SEGMENTS = 200

export async function loadSegmentDefinitions(
  em: EntityManager,
  scope: SegmentScope,
): Promise<SegmentDefinition[]> {
  const rows = await em.find(
    MarketingSegment,
    { ...scope, deletedAt: null },
    { orderBy: { slug: 'ASC' }, limit: MAX_EVALUATED_SEGMENTS },
  )
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    expression: (row.expression ?? null) as ConditionExpression | null,
  }))
}

/** A logger that discards, for membership evaluation where a bad expression is reported by the caller. */
const QUIET_LOGGER: EngineLogger = {
  info() { /* membership evaluation is not an event worth logging per customer */ },
  warn() { /* as above */ },
  error() { /* as above */ },
}

/**
 * The slugs of every segment this subject belongs to.
 *
 * Evaluated against the document with the segments key EMPTIED, which is what stops a segment being defined
 * in terms of other segments at evaluation time — the writer refuses such a definition, and this makes the
 * refusal unnecessary to trust.
 *
 * A segment whose expression is null matches everybody, deliberately: "all customers" is a legitimate thing
 * to name and reuse.
 */
export function computeSegmentSlugs(
  subject: SubjectDocument,
  definitions: SegmentDefinition[],
  now: Date,
): string[] {
  if (definitions.length === 0) return []
  const withoutSegments = { ...subject, [SEGMENTS_FIELD]: [] } as SubjectDocument
  const slugs: string[] = []
  for (const definition of definitions) {
    if (matchesAudience(definition.expression, withoutSegments, { now, logger: QUIET_LOGGER })) {
      slugs.push(definition.slug)
    }
  }
  return slugs
}

/** Segment names for a set of slugs, so a screen can show words rather than identifiers. */
export function namesForSlugs(definitions: SegmentDefinition[], slugs: string[]): string[] {
  const bySlug = new Map(definitions.map((definition) => [definition.slug, definition.name]))
  return slugs.map((slug) => bySlug.get(slug) ?? slug)
}
