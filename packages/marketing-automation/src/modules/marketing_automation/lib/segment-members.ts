import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { matchesAudience } from './engine/audience.js'
import { describeNarrowing, planNarrowing } from './engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from './audience/set-resolver.js'
import { buildSubjectDocument } from './subject-document.js'
import { loadTierThresholds } from './tiers.js'

/**
 * Resolving who is in a segment, in ONE place.
 *
 * Five things need this answer — the members screen, the overlap tool, the size history, a bulk action and
 * the CSV export — and every one of them must agree with what the dispatcher actually does. A second
 * implementation would drift, and the screens that disagree with the sender are the ones people trust.
 */

const logger = createLogger('marketing_automation')

export type MemberScope = { tenantId: string; organizationId: string }

export type MemberResolution = {
  /** Matching subject ids, in candidate order. */
  ids: string[]
  /** How many candidates were examined, which is what makes `complete` meaningful. */
  checked: number
  /** Candidates the narrowing produced, or null when the population had to be walked. */
  candidates: number | null
  /** True when EVERY candidate was examined and the narrowing lost nobody. */
  complete: boolean
  narrowing: string
}

/**
 * Walks candidates and decides membership per subject.
 *
 * `maxChecked` is a ceiling on work, not on truth: when it is reached the result says so through
 * `complete: false`, and every caller reports that rather than presenting a truncated count as a total.
 */
export async function resolveSegmentMembers(
  em: EntityManager,
  container: AwilixContainer,
  scope: MemberScope,
  expression: ConditionExpression | null,
  options: { maxChecked: number; maxMatches?: number; now?: Date },
): Promise<MemberResolution> {
  const now = options.now ?? new Date()
  const plan = planNarrowing(expression)
  const candidates = await resolveCandidates(plan.narrowing, createSqlCandidateSource(em, scope, now))

  const livePerson = { ...scope, kind: 'person', deletedAt: null } as const

  /**
   * Candidates are restricted to live PEOPLE, in both paths.
   *
   * A tag assignment, an order or a score entry can point at a customer who has since been deleted, or at a
   * COMPANY rather than a person — the same filter the sweep and the audience estimate apply. Without it the
   * two paths disagree: walking the population yields people only, while a narrowed set can contain
   * companies, so comparing two segments produced an empty overlap where one side obviously contained the
   * other. That is how this was found.
   */
  const candidateIds = candidates.ids
    ? await filterToLivePeople(em, livePerson, candidates.ids.slice(0, options.maxChecked + 1))
    : (await em.find(CustomerEntity, livePerson, { fields: ['id'], limit: options.maxChecked + 1 })).map((row) => row.id)

  const checkedIds = candidateIds.slice(0, options.maxChecked)
  const tierThresholds = await loadTierThresholds(container, scope)
  const matches: string[] = []
  const maxMatches = options.maxMatches ?? Number.POSITIVE_INFINITY
  let truncatedMatches = false

  for (const id of checkedIds) {
    if (matches.length >= maxMatches) {
      truncatedMatches = true
      break
    }
    /**
     * Built with segment membership EMPTIED.
     *
     * The segment being resolved is evaluated directly, so nothing here may depend on the `segments` key —
     * which is also the rule that makes a segment-of-segments impossible rather than merely refused.
     */
    const subject = await buildSubjectDocument(em, id, scope, {}, now, { tierThresholds, segments: [] })
    if (!subject.customer) continue
    if (!matchesAudience(expression, subject, { now, logger })) continue
    matches.push(subject.customer.id)
  }

  return {
    ids: matches,
    checked: checkedIds.length,
    candidates: candidates.ids ? candidates.ids.length : null,
    complete: !truncatedMatches && candidateIds.length <= options.maxChecked,
    narrowing: describeNarrowing(plan),
  }
}

/** Chunked, because `id IN (…)` with tens of thousands of uuids is a query nobody should write. */
const LIVE_FILTER_CHUNK = 500

async function filterToLivePeople(
  em: EntityManager,
  livePerson: Record<string, unknown>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const live = new Set<string>()
  for (let offset = 0; offset < ids.length; offset += LIVE_FILTER_CHUNK) {
    const chunk = ids.slice(offset, offset + LIVE_FILTER_CHUNK)
    const rows = await em.find(CustomerEntity, { id: { $in: chunk }, ...livePerson }, { fields: ['id'] })
    for (const row of rows) live.add(row.id)
  }
  // Candidate order is preserved so a capped result is a stable prefix rather than a different set each call.
  return ids.filter((id) => live.has(id))
}

/** How many candidates a screen-facing request examines. A segment page shows an answer, not a mailing. */
export const SCREEN_MAX_CHECKED = 2_000

/** How many a background job examines. Bounded, because an unbounded job is one nobody can reason about. */
export const JOB_MAX_CHECKED = 50_000
