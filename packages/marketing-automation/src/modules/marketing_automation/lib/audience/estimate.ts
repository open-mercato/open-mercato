import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { describeNarrowing, planNarrowing } from '../engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from './set-resolver.js'
import type { SubjectScope } from '../subject-document.js'

/**
 * How many customers an audience expression would reach — the ONE query both the audience-estimate
 * API route and the `estimate_audience` AI tool call, so a person and an agent never see different
 * counts for the same definition.
 *
 * `count` is always filtered to live persons: a tag, an order or a score entry can point at a
 * customer who has since been deleted, or at a COMPANY rather than a person, so an unfiltered
 * candidate count overstates the audience. Above `verifyLimit` candidates the live-person check is
 * skipped and the bound is reported as the raw candidate count, because walking that many rows one
 * chunk at a time to show a number is not worth the cost.
 */

const VERIFY_LIMIT = 20_000
const VERIFY_CHUNK = 500

export type AudienceEstimate = {
  count: number
  qualifier: 'exact' | 'atMost'
  narrowing: string
  candidates: number | null
  queries: number
}

export async function estimateAudienceSize(
  em: EntityManager,
  scope: SubjectScope,
  audience: ConditionExpression | null | undefined,
  now: Date,
): Promise<AudienceEstimate> {
  const plan = planNarrowing(audience)
  const candidates = await resolveCandidates(plan.narrowing, createSqlCandidateSource(em, scope, now))
  const livePerson = { ...scope, kind: 'person', deletedAt: null } as const

  if (!candidates.ids) {
    const population = await em.count(CustomerEntity, livePerson)
    return {
      count: population,
      // No audience at all reaches everybody, exactly; an audience the database could not express
      // reaches some subset of everybody.
      qualifier: plan.complete ? 'exact' : 'atMost',
      narrowing: describeNarrowing(plan),
      candidates: null,
      queries: candidates.queries,
    }
  }

  if (candidates.ids.length > VERIFY_LIMIT) {
    return {
      count: candidates.ids.length,
      qualifier: 'atMost',
      narrowing: describeNarrowing(plan),
      candidates: candidates.ids.length,
      queries: candidates.queries,
    }
  }

  let live = 0
  let queries = candidates.queries
  for (let offset = 0; offset < candidates.ids.length; offset += VERIFY_CHUNK) {
    const chunk = candidates.ids.slice(offset, offset + VERIFY_CHUNK)
    live += await em.count(CustomerEntity, { id: { $in: chunk }, ...livePerson })
    queries += 1
  }

  return {
    count: live,
    qualifier: plan.complete ? 'exact' : 'atMost',
    narrowing: describeNarrowing(plan),
    candidates: candidates.ids.length,
    queries,
  }
}
