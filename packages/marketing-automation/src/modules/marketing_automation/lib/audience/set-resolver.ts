import type { EntityManager } from '@mikro-orm/postgresql'
import { recencyBounds } from '../engine/narrowing.js'
import type { ComparisonOp, Narrowing, NarrowingPredicate, OrderMetric } from '../engine/narrowing.js'
import { PLACED_ORDER_FILTER_SQL } from '../subject-document.js'
import type { SubjectScope } from '../subject-document.js'

/**
 * Executes a narrowing plan against the database and hands back candidate subject ids.
 *
 * Split from the planner on purpose: the planner decides what is safe to ask, this decides how to
 * ask it, and the set algebra between them is testable with a fake source. `null` ids mean "no
 * narrowing was possible" — walk the whole population, exactly as before this existed.
 */

/** The three questions a narrowing can ask of the database. */
export type CandidateSource = {
  /** Subject ids carrying this tag slug, or carrying any tag when `slug` is null. */
  tagMembers(slug: string | null): Promise<string[]>
  orderMetricMembers(metric: OrderMetric, op: ComparisonOp, value: number): Promise<string[]>
}

/**
 * Above this many ids a narrowing stops being worth its memory, so it is abandoned.
 *
 * Abandoning always WIDENS — the sweep falls back to walking the population — so the cap can never
 * cost a customer their message. It exists because "customers who have ordered at least once" is a
 * narrowing in form only, and holding a million uuids to express it helps nobody.
 */
export const MAX_CANDIDATE_SET = 100_000

export type CandidateResolution = {
  /** Candidate ids, or null when the population must be walked. */
  ids: string[] | null
  /** True when a set was abandoned for exceeding the cap, which the sweep log should say. */
  abandoned: boolean
  queries: number
}

type InternalResult = { ids: Set<string> | null; abandoned: boolean }

async function resolvePredicate(
  predicate: NarrowingPredicate,
  source: CandidateSource,
  state: { queries: number; maxSet: number },
): Promise<InternalResult> {
  state.queries += 1
  const rows = predicate.kind === 'hasTag'
    ? await source.tagMembers(predicate.slug)
    : predicate.kind === 'hasAnyTag'
      ? await source.tagMembers(null)
      : await source.orderMetricMembers(predicate.metric, predicate.op, predicate.value)

  if (rows.length > state.maxSet) return { ids: null, abandoned: true }
  return { ids: new Set(rows), abandoned: false }
}

async function resolveNode(
  narrowing: Narrowing,
  source: CandidateSource,
  state: { queries: number; maxSet: number },
): Promise<InternalResult> {
  if (narrowing.kind === 'all') return { ids: null, abandoned: false }
  if (narrowing.kind === 'none') return { ids: new Set<string>(), abandoned: false }
  if (narrowing.kind === 'predicate') return resolvePredicate(narrowing.predicate, source, state)

  if (narrowing.kind === 'and') {
    let running: Set<string> | null = null
    let abandoned = false
    for (const part of narrowing.parts) {
      // Nothing can be added to an empty intersection, so stop paying for queries.
      if (running && running.size === 0) break
      const result = await resolveNode(part, source, state)
      abandoned = abandoned || result.abandoned
      // An unconstrained part contributes nothing to an intersection, which keeps the superset.
      if (!result.ids) continue
      const fetched = result.ids
      if (running === null) {
        running = fetched
        continue
      }
      // Built explicitly rather than with a spread-and-filter: inferring the new Set's element type
      // from a callback that reads the variable being assigned resolves to `never`.
      const intersection = new Set<string>()
      for (const id of running) {
        if (fetched.has(id)) intersection.add(id)
      }
      running = intersection
    }
    return { ids: running, abandoned }
  }

  const union = new Set<string>()
  let abandoned = false
  for (const part of narrowing.parts) {
    const result = await resolveNode(part, source, state)
    abandoned = abandoned || result.abandoned
    // One unbounded branch makes the union unbounded: narrowing to the branches we could resolve
    // would drop the subjects that only match the one we could not.
    if (!result.ids) return { ids: null, abandoned: true }
    for (const id of result.ids) union.add(id)
    if (union.size > state.maxSet) return { ids: null, abandoned: true }
  }
  return { ids: union, abandoned }
}

export async function resolveCandidates(
  narrowing: Narrowing,
  source: CandidateSource,
  options: { maxCandidateSet?: number } = {},
): Promise<CandidateResolution> {
  const state = { queries: 0, maxSet: options.maxCandidateSet ?? MAX_CANDIDATE_SET }
  const result = await resolveNode(narrowing, source, state)
  return {
    // Sorted so the sweep can page through them with a stable cursor.
    ids: result.ids ? [...result.ids].sort() : null,
    abandoned: result.abandoned,
    queries: state.queries,
  }
}

/**
 * Only these strings ever reach the SQL, keyed by an operator the planner produced.
 *
 * A comparison operator cannot be a bound parameter, so it is mapped through a fixed table rather
 * than interpolated — the audience is author-supplied data and `op` has already been normalised,
 * but a lookup makes that structural instead of a thing to remember.
 */
const SQL_COMPARISON: Record<ComparisonOp, string> = {
  '=': '=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
}

const MS_PER_DAY = 86_400_000

/** The real source: two statements, both scoped, both parameterised. */
export function createSqlCandidateSource(
  em: EntityManager,
  scope: SubjectScope,
  now: Date,
): CandidateSource {
  return {
    async tagMembers(slug: string | null): Promise<string[]> {
      const params: unknown[] = [scope.tenantId, scope.organizationId]
      let slugClause = ''
      if (slug !== null) {
        slugClause = 'and t.slug = ?'
        params.push(slug)
      }
      const rows = await em.getConnection().execute<{ entity_id: string }[]>(
        `select distinct a.entity_id
           from customer_tag_assignments a
           join customer_tags t on t.id = a.tag_id
          where a.tenant_id = ? and a.organization_id = ? ${slugClause}`,
        params,
      )
      return rows.map((row) => row.entity_id).filter(Boolean)
    },

    async orderMetricMembers(metric: OrderMetric, op: ComparisonOp, value: number): Promise<string[]> {
      const params: unknown[] = [scope.tenantId, scope.organizationId]
      let having: string

      if (metric === 'count') {
        having = `count(*) ${SQL_COMPARISON[op]} ?`
        params.push(value)
      } else if (metric === 'totalGross') {
        having = `coalesce(sum(grand_total_gross_amount), 0) ${SQL_COMPARISON[op]} ?`
        params.push(value)
      } else {
        // Recency is a window on the newest order, widened by `recencyBounds` so a customer sitting
        // on the day boundary is a candidate rather than a silent omission.
        const bounds = recencyBounds(op, value)
        const clauses: string[] = []
        if (bounds.minDaysAgo !== undefined) {
          clauses.push('max(placed_at) <= ?')
          params.push(new Date(now.getTime() - bounds.minDaysAgo * MS_PER_DAY))
        }
        if (bounds.maxDaysAgo !== undefined) {
          clauses.push('max(placed_at) >= ?')
          params.push(new Date(now.getTime() - bounds.maxDaysAgo * MS_PER_DAY))
        }
        having = clauses.length ? clauses.join(' and ') : 'count(*) > 0'
      }

      const rows = await em.getConnection().execute<{ customer_entity_id: string }[]>(
        `select customer_entity_id
           from sales_orders
          where ${PLACED_ORDER_FILTER_SQL}
            and customer_entity_id is not null
          group by customer_entity_id
         having ${having}`,
        params,
      )
      return rows.map((row) => row.customer_entity_id).filter(Boolean)
    },
  }
}
