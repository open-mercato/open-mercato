import type { EntityManager } from '@mikro-orm/postgresql'
import { recencyBounds } from '../engine/narrowing.js'
import type { ComparisonOp, Narrowing, NarrowingPredicate, OrderMetric } from '../engine/narrowing.js'
import { PLACED_ORDER_FILTER_SQL, PLACED_ORDER_FILTER_SQL_ALIASED, PLACED_ORDER_LINE_FILTER_SQL_ALIASED } from '../subject-document.js'
import type { SubjectScope } from '../subject-document.js'
import {
  CATALOG_PRODUCT_CATEGORIES,
  CATALOG_PRODUCT_CATEGORY_ASSIGNMENTS,
  CUSTOMER_TAGS,
  CUSTOMER_TAG_ASSIGNMENTS,
  SALES_CHANNELS,
  SALES_ORDERS,
  SALES_ORDER_LINES,
} from '../external/tables.js'
import { readCapabilities } from '../capabilities.js'

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
  /** Subject ids whose summed lead score satisfies the comparison. */
  scoreMembers(op: ComparisonOp, value: number): Promise<string[]>
  /** Subject ids who have bought this product SKU. */
  purchasedSkuMembers(sku: string): Promise<string[]>
  purchasedCategoryMembers(slug: string): Promise<string[]>
  /** Subject ids who have bought through this sales channel. */
  purchasedInChannelMembers(code: string): Promise<string[]>
  /** Subject ids whose latest NPS answer satisfies the comparison. */
  npsMembers(op: ComparisonOp, value: number): Promise<string[]>
  engagedMembers(type: 'opened' | 'clicked'): Promise<string[]>
  silentSinceMembers(days: number): Promise<string[]>
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
      : predicate.kind === 'scorePoints'
        ? await source.scoreMembers(predicate.op, predicate.value)
        : predicate.kind === 'purchasedSku'
          ? await source.purchasedSkuMembers(predicate.sku)
          : predicate.kind === 'purchasedCategory'
            ? await source.purchasedCategoryMembers(predicate.slug)
          : predicate.kind === 'purchasedInChannel'
            ? await source.purchasedInChannelMembers(predicate.code)
          : predicate.kind === 'engagedEvent'
            ? await source.engagedMembers(predicate.type)
          : predicate.kind === 'silentSince'
            ? await source.silentSinceMembers(predicate.days)
          : predicate.kind === 'npsScore'
            ? await source.npsMembers(predicate.op, predicate.value)
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
    // Uuids compared by codepoint, never by locale — this ordering is what makes a candidate set comparable
    // between two runs.
    ids: result.ids ? [...result.ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : null,
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
/**
 * The row ceiling every statement below carries.
 *
 * The cap on a candidate set was enforced in JavaScript, AFTER the rows arrived: a tag matching five million
 * customers was fetched in full, turned into five million strings, and then thrown away for exceeding the
 * limit. Asking for one row MORE than the cap keeps the existing overflow check exact — `rows.length > maxSet`
 * is still the test, and it is still true at the boundary — while bounding what crosses the wire.
 *
 * Abandoning a narrowing is safe in the direction that matters: the resolver then walks the population and
 * `matchesAudience` decides membership, so a set that overflows can only ever cost time, never correctness.
 */
export const CANDIDATE_ROW_CEILING = MAX_CANDIDATE_SET + 1

export function createSqlCandidateSource(
  em: EntityManager,
  scope: SubjectScope,
  now: Date,
): CandidateSource {
  /**
   * Whether the optional modules these statements read are actually installed.
   *
   * Inside the factory so they close over this `em`, and through the cached probe so a plan with six order
   * predicates still asks the database once.
   */
  const hasSales = async (): Promise<boolean> => (await readCapabilities(em)).sales
  const bothPresent = async (): Promise<boolean> => {
    const capabilities = await readCapabilities(em)
    return capabilities.sales && capabilities.catalog
  }

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
           from ${CUSTOMER_TAG_ASSIGNMENTS} a
           join ${CUSTOMER_TAGS} t on t.id = a.tag_id
          where a.tenant_id = ? and a.organization_id = ? ${slugClause}
              limit ?`,
        [...params, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.entity_id).filter(Boolean)
    },

    async orderMetricMembers(metric: OrderMetric, op: ComparisonOp, value: number): Promise<string[]> {
      /**
       * An order metric has no candidates where there are no orders, and the planner never pushes down a
       * comparison a customer with no orders satisfies — so an empty set is provably a superset here, not a
       * narrowing that drops somebody.
       *
       * Empty rather than "no narrowing": returning null would walk the whole population to have
       * `matchesAudience` reject every one of them, because the subject document omits `orders` entirely
       * without the module. Same answer, one query instead of a population walk.
       */
      if (!(await hasSales())) return []
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
           from ${SALES_ORDERS}
          where ${PLACED_ORDER_FILTER_SQL}
            and customer_entity_id is not null
          group by customer_entity_id
         having ${having}
             limit ?`,
        [...params, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.customer_entity_id).filter(Boolean)
    },

    async purchasedSkuMembers(sku: string): Promise<string[]> {
      /**
       * Nobody has bought a sku on an installation with no orders.
       *
       * Empty rather than "no narrowing": returning null would walk the whole population to have
       * `matchesAudience` reject every one of them, because the subject document omits `orders` entirely
       * without the module. Same answer, one query instead of a population walk.
       */
      if (!(await hasSales())) return []
      const rows = await em.getConnection().execute<{ customer_entity_id: string }[]>(
        `select distinct o.customer_entity_id
           from ${SALES_ORDER_LINES} l
           join ${SALES_ORDERS} o on o.id = l.order_id
          where ${PLACED_ORDER_LINE_FILTER_SQL_ALIASED}
            and o.customer_entity_id is not null
            and coalesce(
                  l.catalog_snapshot -> 'product' ->> 'sku',
                  l.catalog_snapshot -> 'variant' ->> 'sku'
                ) = ?
                    limit ?`,
        [scope.tenantId, scope.organizationId, sku, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.customer_entity_id).filter(Boolean)
    },

    /**
     * Customers who bought a product currently filed under this category.
     *
     * The same live assignment table the subject document reads, which is what lets the narrowing claim to be
     * exact rather than merely a superset.
     */
    async purchasedCategoryMembers(slug: string): Promise<string[]> {
      /**
       * This join needs both: the line comes from `sales` and its classification from `catalog`.
       *
       * Empty rather than "no narrowing": returning null would walk the whole population to have
       * `matchesAudience` reject every one of them, because the subject document omits `orders` entirely
       * without the module. Same answer, one query instead of a population walk.
       */
      if (!(await bothPresent())) return []
      const rows = await em.getConnection().execute<{ customer_entity_id: string }[]>(
        `select distinct o.customer_entity_id
           from ${SALES_ORDER_LINES} l
           join ${SALES_ORDERS} o on o.id = l.order_id
           join ${CATALOG_PRODUCT_CATEGORY_ASSIGNMENTS} a on a.product_id = l.product_id
           join ${CATALOG_PRODUCT_CATEGORIES} c on c.id = a.category_id and c.deleted_at is null
          where ${PLACED_ORDER_LINE_FILTER_SQL_ALIASED}
            and o.customer_entity_id is not null
            and c.slug = ?
                limit ?`,
        [scope.tenantId, scope.organizationId, slug, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.customer_entity_id).filter(Boolean)
    },

    async purchasedInChannelMembers(code: string): Promise<string[]> {
      /**
       * Nobody has bought through a channel on an installation with no orders.
       *
       * Empty rather than "no narrowing": returning null would walk the whole population to have
       * `matchesAudience` reject every one of them, because the subject document omits `orders` entirely
       * without the module. Same answer, one query instead of a population walk.
       */
      if (!(await hasSales())) return []
      const rows = await em.getConnection().execute<{ customer_entity_id: string }[]>(
        // The ORDER filter, not the line one: this query joins channels, never `sales_order_lines`, so
        // `l.deleted_at` has no table to refer to and Postgres answers "missing FROM-clause entry for table l".
        `select distinct o.customer_entity_id
           from ${SALES_ORDERS} o
           join ${SALES_CHANNELS} c on c.id = o.channel_id
          where ${PLACED_ORDER_FILTER_SQL_ALIASED}
            and o.customer_entity_id is not null
            and c.code = ?
                limit ?`,
        [scope.tenantId, scope.organizationId, code, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.customer_entity_id).filter(Boolean)
    },

    /** Everybody who has opened or clicked at least once — reached through the run, like the event table itself. */
    async engagedMembers(type: 'opened' | 'clicked'): Promise<string[]> {
      const rows = await em.getConnection().execute<{ subject_entity_id: string }[]>(
        `select distinct r.subject_entity_id
           from marketing_message_send_events e
           join marketing_campaign_runs r on r.id = e.run_id
          where e.tenant_id = ? and e.organization_id = ?
            and e.type = ?
            and r.subject_entity_id is not null
                limit ?`,
        [scope.tenantId, scope.organizationId, type, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.subject_entity_id).filter(Boolean)
    },

    /**
     * Customers with no sign of life for this many days, computed the same way the subject document does.
     *
     * The `coalesce` is the whole definition: from their last open or click, and from the FIRST message we sent
     * them when there has never been one. A customer with no sends at all cannot appear, which matches the
     * document's absent value — so this is exact rather than a superset.
     */
    async silentSinceMembers(days: number): Promise<string[]> {
      const rows = await em.getConnection().execute<{ subject_entity_id: string }[]>(
        `with sends as (
           select subject_entity_id, min(sent_at) as first_sent_at
             from marketing_message_sends
            where tenant_id = ? and organization_id = ?
              and status = 'sent'
              and subject_entity_id is not null
            group by subject_entity_id
         ),
         engaged as (
           select r.subject_entity_id, max(e.occurred_at) as last_engaged_at
             from marketing_message_send_events e
             join marketing_campaign_runs r on r.id = e.run_id
            where e.tenant_id = ? and e.organization_id = ?
              and e.type in ('opened', 'clicked')
              and r.subject_entity_id is not null
            group by r.subject_entity_id
         )
         select s.subject_entity_id
           from sends s
           left join engaged g on g.subject_entity_id = s.subject_entity_id
          where coalesce(g.last_engaged_at, s.first_sent_at) <= now() - make_interval(days => ?)
              limit ?`,
        [scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId, days, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.subject_entity_id).filter(Boolean)
    },

    async npsMembers(op: ComparisonOp, value: number): Promise<string[]> {
      /**
       * The LATEST answer per customer, not any answer.
       *
       * `distinct on` picks one row per subject ordered by when they answered, so a customer who scored 3
       * last year and 9 last week is a promoter — matching `survey.nps <= 6` on the old answer would target
       * people for a feeling they no longer have.
       */
      const rows = await em.getConnection().execute<{ subject_entity_id: string }[]>(
        `select subject_entity_id
           from (
             select distinct on (subject_entity_id) subject_entity_id, score
               from marketing_survey_prompts
              where tenant_id = ? and organization_id = ?
                and subject_entity_id is not null
                and score is not null
              order by subject_entity_id, answered_at desc nulls last
           ) latest
          where latest.score ${SQL_COMPARISON[op]} ?
              limit ?`,
        [scope.tenantId, scope.organizationId, value, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.subject_entity_id).filter(Boolean)
    },

    async scoreMembers(op: ComparisonOp, value: number): Promise<string[]> {
      const rows = await em.getConnection().execute<{ subject_entity_id: string }[]>(
        `select subject_entity_id
           from marketing_customer_score_entries
          where tenant_id = ? and organization_id = ?
          group by subject_entity_id
         having coalesce(sum(points), 0) ${SQL_COMPARISON[op]} ?
             limit ?`,
        [scope.tenantId, scope.organizationId, value, CANDIDATE_ROW_CEILING],
      )
      return rows.map((row) => row.subject_entity_id).filter(Boolean)
    },
  }
}
