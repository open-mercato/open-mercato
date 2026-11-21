import type { SubjectScope } from './scope.js'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerAddress, CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import type { SubjectDocument } from './engine/types.js'
import { FALLBACK_TIME_ZONE } from './engine/gates.js'
import { loadScorePoints } from './scores.js'
import { loadLatestNps } from './survey.js'
import { resolveTier } from './engine/tiers.js'
import { computeSegmentSlugs, loadSegmentDefinitions } from './segments.js'
import { loadPreferredLocale } from './preferences.js'
import { computeRfm, grossPercentile, projectCustomerValue } from './engine/rfm.js'
import { loadValueBoundaries } from './value-boundaries.js'
import type { ValueBoundaries } from './engine/rfm.js'
import type { SegmentDefinition } from './segments.js'
import type { TierThreshold } from './engine/tiers.js'
/**
 * Re-exported from here because every existing caller imports it from this module, and the definition of "an
 * order that counts" is a contract the narrowing depends on matching exactly.
 */
export { PLACED_ORDER_FILTER_SQL, PLACED_ORDER_FILTER_SQL_ALIASED, PLACED_ORDER_LINE_FILTER_SQL_ALIASED } from './order-filter.js'
import { PLACED_ORDER_FILTER_SQL, PLACED_ORDER_FILTER_SQL_ALIASED, PLACED_ORDER_LINE_FILTER_SQL_ALIASED } from './order-filter.js'
import { hasSales, readCapabilities } from './capabilities.js'
import {
  CATALOG_PRODUCT_CATEGORIES,
  CATALOG_PRODUCT_CATEGORY_ASSIGNMENTS,
  CUSTOMER_TAGS,
  CUSTOMER_TAG_ASSIGNMENTS,
  SALES_CHANNELS,
  SALES_ORDERS,
  SALES_ORDER_LINES,
} from './external/tables.js'

export type { SubjectScope } from './scope.js'


const ORDER_AGGREGATE_SQL = `
  select
    count(*)::int as order_count,
    coalesce(sum(grand_total_gross_amount), 0)::text as total_gross,
    max(placed_at) as last_placed_at,
    min(placed_at) as first_placed_at
  from ${SALES_ORDERS}
  where customer_entity_id = ?
    and ${PLACED_ORDER_FILTER_SQL}
`

type OrderAggregateRow = {
  order_count: number
  total_gross: string
  last_placed_at: Date | string | null
  first_placed_at: Date | string | null
}

const MS_PER_DAY = 86_400_000

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/** Categories need both modules, so the two-module question gets a name of its own. */
async function bothModules(em: EntityManager): Promise<boolean> {
  const capabilities = await readCapabilities(em)
  return capabilities.sales && capabilities.catalog
}

export async function loadOrderAggregates(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  now: Date,
): Promise<SubjectDocument['orders']> {
  /**
   * Guarded HERE rather than only in `buildSubjectDocument`, because that is not the only caller.
   *
   * The customer-profile route calls this loader directly, so guarding the orchestrator left the profile
   * answering 500 with `relation "sales_orders" does not exist` on an installation with no sales module —
   * found by actually running one, not by any unit test. The query lives in this function, so the question
   * "may I run it" belongs in it too, and every future caller inherits the answer.
   *
   * `undefined` rather than a zero shape: the caller has to decide whether to omit its key, and a zeroed
   * aggregate is the lie that makes `orders.count <= 5` true for everybody.
   */
  if (!(await hasSales(em))) return undefined

  const rows = await em.getConnection().execute<OrderAggregateRow[]>(
    ORDER_AGGREGATE_SQL,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  const row = rows[0]
  const count = row?.order_count ?? 0
  // Money is numeric(18,4) mapped to string throughout sales, so parse deliberately rather
  // than letting it reach an audience comparison as a string.
  const totalGross = Number.parseFloat(row?.total_gross ?? '0')

  const aggregates: SubjectDocument['orders'] = {
    // The lists are loaded separately and merged by the caller; this function answers about amounts.
    skus: [],
    categories: [],
    channels: [],
    count,
    totalGross: Number.isFinite(totalGross) ? totalGross : 0,
  }

  // Absent, never null: a null would compare as lower than every number and make
  // "ordered in the last 30 days" true for somebody who has never ordered.
  const lastPlacedAt = row?.last_placed_at ? new Date(row.last_placed_at) : null
  if (lastPlacedAt && !Number.isNaN(lastPlacedAt.getTime())) {
    aggregates.lastPlacedAt = lastPlacedAt.toISOString()
    aggregates.daysSinceLast = Math.max(0, wholeDaysBetween(lastPlacedAt, now))
  }

  // Absent for the same reason, and for a second one: a projection measured from a missing start date would
  // silently measure from the epoch and report a cadence of nearly zero for the shop's best customer.
  const firstPlacedAt = row?.first_placed_at ? new Date(row.first_placed_at) : null
  if (firstPlacedAt && !Number.isNaN(firstPlacedAt.getTime())) {
    aggregates.firstPlacedAt = firstPlacedAt.toISOString()
  }

  if (count > 0) aggregates.averageGross = Math.round((aggregates.totalGross / count) * 100) / 100

  return aggregates
}

/**
 * How many distinct SKUs a subject document carries.
 *
 * Raised from 200, and ordered, because the truncation was not merely a display limit: `matchesAudience` answers
 * `orders.skus CONTAINS 'X'` from THIS list, so a wholesale customer with 250 distinct SKUs was reported as not
 * having bought one that fell outside whatever 200 rows came back — and with no `ORDER BY`, which 200 that was
 * could change between two runs of the same campaign.
 *
 * A cap is still needed (a subject document is projected per candidate and must stay bounded), so the honest
 * position is: high enough that a real customer does not reach it, deterministic when one does, and stated in the
 * module's guidance as a known limit rather than left to be discovered.
 */
const MAX_SUBJECT_SKUS = 2_000

/** A shop with more than this many channels is not doing channel targeting, it is doing integrations. */
const MAX_SUBJECT_CHANNELS = 50

/** Same reasoning and the same fix as the skus above; a shop with 500 categories is not filing products, it is losing them. */
const MAX_SUBJECT_CATEGORIES = 500

/**
 * Distinct product SKUs this customer has bought.
 *
 * Read from the order line's CATALOGUE SNAPSHOT, not from the catalogue: a product that was renamed,
 * re-skued or deleted must still target the customers who bought it, and the snapshot is the only record
 * of what they actually bought. The variant sku is the fallback, because a shop that skus only variants
 * would otherwise return nothing.
 */
/**
 * The sales channels this customer has actually bought through.
 *
 * The only channel fact the platform holds ABOUT A CUSTOMER: there is no "this person belongs to the retail
 * store" field anywhere, and inventing one would be a second source of truth for something orders already
 * record. So store targeting here means "has bought in this channel", which is both derivable and the thing an
 * operator actually means.
 */
export async function loadPurchasedChannels(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string[]> {
  // Channels come from orders. Guarded in the loader so a direct caller cannot bypass it — the profile route did exactly that.
  if (!(await hasSales(em))) return []
  const rows = await em.getConnection().execute<{ code: string | null }[]>(
    `select distinct c.code as code
       from ${SALES_ORDERS} o
       join ${SALES_CHANNELS} c on c.id = o.channel_id
      where o.customer_entity_id = ?
        and ${PLACED_ORDER_FILTER_SQL_ALIASED}
      limit ?`,
    [subjectEntityId, scope.tenantId, scope.organizationId, MAX_SUBJECT_CHANNELS],
  )
  return rows
    .map((row) => row.code)
    .filter((code): code is string => typeof code === 'string' && code.length > 0)
}

/**
 * Category slugs of the products this customer has bought.
 *
 * **Read from the CATALOGUE, unlike the SKU list, and the difference is deliberate.** A sku is a historical
 * fact about a purchase, so it comes from the order line's snapshot and survives the product being renamed or
 * deleted. A category is a current CLASSIFICATION: "people who bought footwear" means today's taxonomy, and
 * re-categorising a product should change who a campaign targets rather than preserving a filing decision
 * somebody has since corrected.
 *
 * The cost is stated rather than hidden: a purchase of a product that has since been deleted drops out of
 * category targeting. Nothing is lost that this module could have kept — the snapshot never carried categories —
 * and the sku list still holds that purchase.
 *
 * Slugs, not names or ids: the slug is unique per scope and is what a saved audience can reference without
 * breaking when somebody renames the category.
 */
export async function loadPurchasedCategories(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string[]> {
  // The line comes from sales, its classification from catalog. Guarded in the loader so a direct caller cannot bypass it — the profile route did exactly that.
  if (!(await bothModules(em))) return []
  const rows = await em.getConnection().execute<{ slug: string | null }[]>(
    `select distinct c.slug as slug
       from ${SALES_ORDER_LINES} l
       join ${SALES_ORDERS} o on o.id = l.order_id
       join ${CATALOG_PRODUCT_CATEGORY_ASSIGNMENTS} a on a.product_id = l.product_id
       join ${CATALOG_PRODUCT_CATEGORIES} c on c.id = a.category_id and c.deleted_at is null
      where o.customer_entity_id = ?
        and ${PLACED_ORDER_LINE_FILTER_SQL_ALIASED}
        and c.slug is not null
      -- Deterministic for the same reason the sku list is: a capped list that changes between runs makes a
      -- campaign's membership change with it.
      order by c.slug
      limit ?`,
    [subjectEntityId, scope.tenantId, scope.organizationId, MAX_SUBJECT_CATEGORIES],
  )
  return rows
    .map((row) => row.slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
}

export async function loadPurchasedSkus(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string[]> {
  // Skus come from order lines. Guarded in the loader so a direct caller cannot bypass it — the profile route did exactly that.
  if (!(await hasSales(em))) return []
  const rows = await em.getConnection().execute<{ sku: string | null }[]>(
    `select sku from (
       select coalesce(
                l.catalog_snapshot -> 'product' ->> 'sku',
                l.catalog_snapshot -> 'variant' ->> 'sku'
              ) as sku,
              max(o.placed_at) as last_bought
         from ${SALES_ORDER_LINES} l
         join ${SALES_ORDERS} o on o.id = l.order_id
        where o.customer_entity_id = ?
          and ${PLACED_ORDER_LINE_FILTER_SQL_ALIASED}
        group by 1
       ) ranked
      where sku is not null
      -- Newest purchase first, so a truncated list is a stable PREFIX rather than a different 2,000 each run —
      -- and the ones kept are the ones a campaign is most likely to be about.
      order by last_bought desc, sku
      limit ?`,
    [subjectEntityId, scope.tenantId, scope.organizationId, MAX_SUBJECT_SKUS],
  )
  return rows
    .map((row) => row.sku)
    .filter((sku): sku is string => typeof sku === 'string' && sku.length > 0)
}

/**
 * What this customer did with the messages we sent, in one statement.
 *
 * Two halves that have to be read together, which is why they are one query: the sends say when we started
 * writing to them, and the events say whether they ever answered. `daysSinceEngaged` needs both — a customer who
 * never opened anything is measured from the FIRST send, and one who has is measured from their last open.
 *
 * Opens and clicks are counted as distinct RUNS. An earlier version of the profile counted them over the ten runs
 * it happened to be listing while `sent` beside it was all-time, and asserted that a customer with forty runs had
 * never engaged. Two numbers on one line measured over different populations is worse than either alone.
 */
export async function loadEngagement(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  now: Date,
): Promise<SubjectDocument['engagement']> {
  const rows = await em.getConnection().execute<Array<{
    sent: number
    first_sent_at: Date | string | null
    last_sent_at: Date | string | null
    opened: number
    clicked: number
    last_engaged_at: Date | string | null
  }>>(
    `with sends as (
       select count(*) filter (where status = 'sent')::int as sent,
              min(sent_at) filter (where status = 'sent') as first_sent_at,
              max(sent_at) filter (where status = 'sent') as last_sent_at
         from marketing_message_sends
        where tenant_id = ? and organization_id = ? and subject_entity_id = ?
     ),
     events as (
       select count(distinct e.run_id) filter (where e.type = 'opened')::int as opened,
              count(distinct e.run_id) filter (where e.type = 'clicked')::int as clicked,
              max(e.occurred_at) filter (where e.type in ('opened', 'clicked')) as last_engaged_at
         from marketing_message_send_events e
         join marketing_campaign_runs r on r.id = e.run_id
        -- The scope is repeated on the run for the PLANNER, not for correctness: joining on r.id = e.run_id
        -- already ties the run to a row this query has scoped. Without the predicate the index that leads
        -- with (tenant, org, subject) is unreachable, and this runs once per candidate in every sweep.
        -- No backticks in here: this is inside a template literal and one would end the string.
        where e.tenant_id = ? and e.organization_id = ?
          and r.tenant_id = ? and r.organization_id = ? and r.subject_entity_id = ?
     )
     select sends.sent, sends.first_sent_at, sends.last_sent_at,
            events.opened, events.clicked, events.last_engaged_at
       from sends, events`,
    [
      scope.tenantId, scope.organizationId, subjectEntityId,
      scope.tenantId, scope.organizationId,
      scope.tenantId, scope.organizationId, subjectEntityId,
    ],
  )
  const row = rows[0]

  const engagement: SubjectDocument['engagement'] = {
    sent: row?.sent ?? 0,
    opened: row?.opened ?? 0,
    clicked: row?.clicked ?? 0,
  }

  const readDate = (value: Date | string | null | undefined): Date | null => {
    if (!value) return null
    const parsed = value instanceof Date ? value : new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const lastSentAt = readDate(row?.last_sent_at)
  if (lastSentAt) engagement.lastSentAt = lastSentAt.toISOString()

  const lastEngagedAt = readDate(row?.last_engaged_at)
  if (lastEngagedAt) engagement.lastEngagedAt = lastEngagedAt.toISOString()

  /**
   * The silence is measured from the last sign of life, or from when we first spoke.
   *
   * Absent when we have never sent them anything, which is the only honest answer: there is no silence to
   * measure, and a zero would make every sunset audience true for a customer nobody has written to.
   */
  const since = lastEngagedAt ?? readDate(row?.first_sent_at)
  if (since) engagement.daysSinceEngaged = Math.max(0, wholeDaysBetween(since, now))

  return engagement
}

/** Tag slugs, so an audience can ask `tags CONTAINS 'vip'` rather than carry uuids. */
export async function loadTagSlugs(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string[]> {
  const rows = await em.getConnection().execute<{ slug: string }[]>(
    `select t.slug
       from ${CUSTOMER_TAG_ASSIGNMENTS} a
       join ${CUSTOMER_TAGS} t on t.id = a.tag_id
      where a.entity_id = ? and a.tenant_id = ? and a.organization_id = ?
      order by t.slug`,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  return rows.map((row) => row.slug)
}

/**
 * Where the customer is.
 *
 * Read through the decrypting finder: every field of an address is encrypted at rest, so a plain
 * `em.find` would hand back ciphertext and a country comparison would silently never match.
 *
 * A customer may have several addresses. Shipping wins over billing and billing over anything else,
 * because a geographic audience is almost always about where the goods go — and picking one
 * deterministically matters more than picking the theoretically best one, since an audience that
 * depends on row order is worse than one that is merely approximate.
 */
export async function loadSubjectAddress(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<SubjectDocument['address']> {
  const addresses = await findWithDecryption(
    em,
    CustomerAddress,
    { entity: subjectEntityId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (!addresses.length) return null

  const preference = ['shipping', 'billing']
  const chosen = [...addresses].sort((left, right) => {
    const leftRank = preference.indexOf((left.purpose ?? '').toLowerCase())
    const rightRank = preference.indexOf((right.purpose ?? '').toLowerCase())
    return (leftRank === -1 ? preference.length : leftRank) - (rightRank === -1 ? preference.length : rightRank)
  })[0]

  return {
    country: chosen.country?.trim() || null,
    region: chosen.region?.trim() || null,
    city: chosen.city?.trim() || null,
    postalCode: chosen.postalCode?.trim() || null,
  }
}

/**
 * The customer's own timezone, for quiet hours.
 *
 * Stored encrypted on the person profile, so it has to be read through the decrypting finder.
 * There is no organization-level timezone anywhere in the platform, so UTC is the only
 * fallback available.
 */
export async function loadSubjectTimeZone(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string> {
  const profile = await findOneWithDecryption(
    em,
    CustomerPersonProfile,
    { entity: subjectEntityId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  return profile?.timezone?.trim() || FALLBACK_TIME_ZONE
}

/**
 * Projects everything an audience expression can target on for one customer.
 *
 * Field paths here ARE the paths the condition builder offers — `tags`,
 * `orders.daysSinceLast`, `customer.email`, `trigger.*` — so changing a key here changes
 * every saved audience that referenced it.
 */
export async function buildSubjectDocument(
  em: EntityManager,
  subjectEntityId: string | null | undefined,
  scope: SubjectScope,
  trigger: Record<string, unknown>,
  now: Date,
  /**
   * The tenant's tier ladder. Passed in rather than read here so a sweep loads it once per job
   * instead of once per candidate, and so this stays a function of its arguments.
   */
  /**
   * The tenant's tier ladder. Passed in rather than read here so a sweep loads it once per job
   * instead of once per candidate, and so this stays a function of its arguments.
   *
   * `segments` works the same way — and when it is NOT passed, the definitions are loaded here rather than
   * defaulting to none. An empty segment list would make every `segments CONTAINS …` audience quietly false,
   * which is the silent-failure shape this module refuses everywhere else.
   */
  /**
   * `valueBoundaries` follows the segments rule exactly: a sweep passes the row it already read so thousands of
   * candidates do not each read it, and a caller that does NOT pass it gets a load rather than an empty set.
   * Defaulting to empty would make every `rfm.*` audience quietly false on the event path — the same
   * silent-failure shape, and the cut points are one indexed row, so there is no reason to risk it.
   */
  options?: {
    tierThresholds?: TierThreshold[]
    segments?: SegmentDefinition[]
    valueBoundaries?: ValueBoundaries
    valueHorizonYears?: number
  },
): Promise<SubjectDocument> {
  if (!subjectEntityId) {
    const unscored = resolveTier(0, options?.tierThresholds)
    return {
      customer: null,
      tags: [],
      orders: { count: 0, totalGross: 0, skus: [], categories: [], channels: [] },
      score: { points: 0, tier: unscored.key, tierRank: unscored.rank },
      // No subject, so nothing to score or project. Null, never a zero score — see the type.
      rfm: null,
      value: null,
      address: null,
      survey: { nps: null, answeredAt: null },
      // Nobody to have written to, so nothing to have been ignored.
      engagement: { sent: 0, opened: 0, clicked: 0 },
      // No subject, so no membership. A segment describes a customer, and there is none here.
      segments: [],
      trigger,
    }
  }

  // display_name and primary_email are encrypted at rest; a plain `em.findOne` would hand
  // back ciphertext, which would then be silently compared against a plaintext audience value.
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: subjectEntityId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )

  /**
   * `sales` and `catalog` may not be installed at all, so their tables may not exist.
   *
   * Skipped rather than attempted-and-caught: a missing table is not an error condition to recover from, it is
   * the installation this module promises to run on, and catching the error would log a failure per customer per
   * evaluation for a shop that is working exactly as configured.
   *
   * Categories need BOTH — the join reads a line from `sales` and its classification from `catalog`.
   */
  const capabilities = await readCapabilities(em)

  const [tags, orders, scorePoints, skus, categories, channels, locale, address, nps, engagement] = await Promise.all([
    loadTagSlugs(em, subjectEntityId, scope),
    capabilities.sales ? loadOrderAggregates(em, subjectEntityId, scope, now) : Promise.resolve(null),
    loadScorePoints(em, subjectEntityId, scope),
    capabilities.sales ? loadPurchasedSkus(em, subjectEntityId, scope) : Promise.resolve([]),
    capabilities.sales && capabilities.catalog ? loadPurchasedCategories(em, subjectEntityId, scope) : Promise.resolve([]),
    capabilities.sales ? loadPurchasedChannels(em, subjectEntityId, scope) : Promise.resolve([]),
    loadPreferredLocale(em, scope, subjectEntityId),
    loadSubjectAddress(em, subjectEntityId, scope),
    loadLatestNps(em, subjectEntityId, scope),
    loadEngagement(em, subjectEntityId, scope, now),
  ])

  const tier = resolveTier(scorePoints, options?.tierThresholds)

  const segmentDefinitions = options?.segments ?? await loadSegmentDefinitions(em, scope)

  /**
   * Derived, in memory, from numbers already read. No further queries: RFM is the order aggregates compared
   * against the shop's stored cut points, and the projection is arithmetic over the same aggregates.
   */
  const boundaries = options?.valueBoundaries ?? await loadValueBoundaries(em, scope)
  // All three are statements ABOUT order history, so without it they are withheld rather than computed from
  // zeroes — an RFM of 1-1-1 reads as "our worst customer" and would sweep everybody into every win-back.
  const projection = orders ? projectCustomerValue(orders, now, options?.valueHorizonYears) : null
  const percentile = orders ? grossPercentile(orders.totalGross, boundaries) : null
  const projectedValue = projection
    ? { ...projection, ...(percentile === null ? {} : { grossPercentile: percentile }) }
    : null

  const document: SubjectDocument = {
    customer: entity
      ? {
          id: entity.id,
          email: entity.primaryEmail ?? null,
          displayName: entity.displayName ?? null,
          createdAt: entity.createdAt ? new Date(entity.createdAt).toISOString() : null,
          /**
           * The language THEY chose, in the preference centre — null when they have not.
           *
           * Null rather than a guess: writing to somebody in the language of the country their address is in
           * is how people receive marketing in a language they do not read.
           */
          locale,
        }
      : null,
    tags,
    // Absent, not zeroed: see the key's own docblock in `lib/engine/types.ts`.
    ...(orders ? { orders: { ...orders, skus, categories, channels } } : {}),
    score: { points: scorePoints, tier: tier.key, tierRank: tier.rank },
    rfm: orders ? computeRfm(orders, boundaries) : null,
    value: projectedValue,
    address,
    survey: { nps: nps?.score ?? null, answeredAt: nps?.answeredAt ?? null },
    engagement,
    // Filled below, once the rest of the document exists: membership is computed FROM it.
    segments: [],
    trigger,
  }

  /**
   * Membership last, because a segment is an expression over everything above.
   *
   * No queries: the definitions are already loaded and the document is already in memory, so this is pure
   * evaluation per segment.
   */
  document.segments = computeSegmentSlugs(document, segmentDefinitions, now)
  return document
}
