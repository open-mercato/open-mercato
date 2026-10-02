import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import type { SubjectDocument } from './engine/types.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { matchesAudience } from './engine/audience.js'
import { describeNarrowing, planNarrowing } from './engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from './audience/set-resolver.js'
import { buildSubjectDocument } from './subject-document.js'
import { loadTierThresholds } from './tiers.js'
import { loadValueBoundaries } from './value-boundaries.js'

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
  options: {
    maxChecked: number
    maxMatches?: number
    now?: Date
    /**
     * Documents already built during THIS pass, shared across several resolutions.
     *
     * A segment whose expression narrows in SQL never touches this. One that does not has to describe each
     * candidate, and the snapshot pass resolves every segment over the same population on the same tick — so
     * without a cache, twenty un-narrowable segments describe the same two thousand people twenty times.
     *
     * Supplied by the caller and never created here, because the lifetime is the caller's question: a single
     * resolution has nothing to share, and a cache that outlived one pass would answer with yesterday's
     * customer.
     */
    documents?: Map<string, SubjectDocument>
  },
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
  let candidateIds: string[]
  let truncatedCandidates: boolean
  if (candidates.ids) {
    const window = candidates.ids.slice(0, options.maxChecked + 1)
    candidateIds = await filterToLivePeople(em, livePerson, window)
    truncatedCandidates = candidatesWereTruncated({
      candidateCount: candidates.ids.length,
      windowCount: window.length,
      liveCount: candidateIds.length,
      maxChecked: options.maxChecked,
    })
  } else {
    const rows = await em.find(CustomerEntity, livePerson, { fields: ['id'], limit: options.maxChecked + 1 })
    candidateIds = rows.map((row) => row.id)
    truncatedCandidates = candidatesWereTruncated({
      candidateCount: null,
      windowCount: candidateIds.length,
      liveCount: candidateIds.length,
      maxChecked: options.maxChecked,
    })
  }

  const checkedIds = candidateIds.slice(0, options.maxChecked)
  /**
   * Both of these are constants for the whole pass, so both are read once.
   *
   * `tierThresholds` always was. `valueBoundaries` was not: without it `buildSubjectDocument` falls back to
   * reading the tenant's cut points itself, which is one extra query per candidate — up to 50,000 of them in
   * a segment-action job, for an answer that cannot change while the loop runs. The sweep and the score-rules
   * worker already pass it; this call site was the one that did not.
   */
  const [tierThresholds, valueBoundaries] = await Promise.all([
    loadTierThresholds(container, scope),
    loadValueBoundaries(em, scope),
  ])
  const matches: string[] = []
  const maxMatches = options.maxMatches ?? Number.POSITIVE_INFINITY
  let truncatedMatches = false

  for (const [position, id] of checkedIds.entries()) {
    if (matches.length >= maxMatches) {
      truncatedMatches = true
      break
    }
    /**
     * The identity map is emptied as the loop walks, which the sweep already does for the same reason.
     *
     * A bulk action resolves up to `JOB_MAX_CHECKED` members, and each subject document loads the customer,
     * their profile, their addresses and their tags — so without this the manager held every entity of every
     * person it had examined, decrypted, until the job finished. Nothing read afterwards comes from the
     * manager: this returns ids, and `options.documents` holds plain objects that a clear cannot detach.
     *
     * Not inside a transaction, and no caller opens one around this — `em.clear()` there would detach the
     * transaction's own pending writes.
     */
    if (position > 0 && position % IDENTITY_MAP_CLEAR_EVERY === 0) em.clear()
    /**
     * Built with segment membership EMPTIED.
     *
     * The segment being resolved is evaluated directly, so nothing here may depend on the `segments` key —
     * which is also the rule that makes a segment-of-segments impossible rather than merely refused.
     */
    const cached = options.documents?.get(id)
    const subject = cached
      ?? await buildSubjectDocument(em, id, scope, {}, now, { tierThresholds, valueBoundaries, segments: [] })
    if (!cached) options.documents?.set(id, subject)
    if (!subject.customer) continue
    if (!matchesAudience(expression, subject, { now, logger })) continue
    matches.push(subject.customer.id)
  }

  return {
    ids: matches,
    checked: checkedIds.length,
    candidates: candidates.ids ? candidates.ids.length : null,
    complete: !truncatedMatches && !truncatedCandidates,
    narrowing: describeNarrowing(plan),
  }
}

/**
 * Whether the candidate list was cut short — decided BEFORE the live-person filter runs.
 *
 * The ceiling is detected the usual way: ask for one more than will be examined and see whether it comes
 * back. The bug this function exists to prevent is that the sentinel used to be handed to
 * `filterToLivePeople` along with everything else, so ONE deleted customer or company anywhere in the window
 * removed the sentinel too — and a segment that had been cut off at two thousand reported itself complete,
 * which is the single thing every caller of this file promises not to do. A truncated count presented as a
 * total is worse than no count, because nobody knows to distrust it.
 *
 * Both conditions are needed and neither is sufficient: candidates beyond the window mean there is more to
 * examine, and a window whose LIVE members already exceed the ceiling means the same. When the window IS the
 * whole candidate list and the filter merely removed some dead rows, nothing was truncated.
 */
export function candidatesWereTruncated(input: {
  /** Ids the narrowing produced, or null when the whole population was walked. */
  candidateCount: number | null
  /** How many of them entered the live-person filter — at most `maxChecked + 1`. */
  windowCount: number
  /** How many came out of it. */
  liveCount: number
  maxChecked: number
}): boolean {
  if (input.candidateCount !== null && input.candidateCount > input.windowCount) return true
  return input.liveCount > input.maxChecked
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

/**
 * How many a synchronous REQUEST examines when it wants a real answer rather than a preview — the CSV export.
 *
 * Between the two: an export is not a screen, so 2,000 would make every file a sample, but it is also not a
 * job, and `JOB_MAX_CHECKED` inside an HTTP request means up to fifty thousand subject documents built
 * sequentially while a connection and a browser wait for a file. The ceiling is reached only by a segment
 * that narrows to nothing and therefore has to walk the population; a segment with any narrowable condition
 * examines its candidates and finishes.
 */
export const REQUEST_MAX_CHECKED = 10_000

/** How many a background job examines. Bounded, because an unbounded job is one nobody can reason about. */
/**
 * How many subjects are examined before the identity map is emptied.
 *
 * Large enough that the clear is not itself a cost, small enough that the manager never holds more than a few
 * hundred people's decrypted records at once.
 */
const IDENTITY_MAP_CLEAR_EVERY = 500

export const JOB_MAX_CHECKED = 50_000
