import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerAddress, CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import type { SubjectDocument } from './engine/types.js'
import { FALLBACK_TIME_ZONE } from './engine/gates.js'
import { loadScorePoints } from './scores.js'
import { resolveTier } from './engine/tiers.js'
import type { TierThreshold } from './engine/tiers.js'

export type SubjectScope = { tenantId: string; organizationId: string }

/**
 * Order aggregates, read with one statement per subject.
 *
 * Deliberately SQL rather than loading orders into memory: a long-standing customer can have
 * thousands, and three audience conditions referencing these numbers must not cost three
 * scans — the caller memoizes this per dispatch.
 *
 * Both spellings of cancelled are excluded because the codebase tolerates both
 * (`sales/commands/documents.ts` → `isCancelledOrderStatus`), and `placed_at is not null`
 * excludes drafts, which would otherwise inflate a customer's order count with carts they
 * never submitted.
 *
 * The filter is exported because the set-level candidate query aggregates the SAME orders. If the
 * two definitions of "an order that counts" ever drifted apart, the narrowing would stop being a
 * superset of what this function computes, and customers would silently fall out of campaigns.
 */
export const PLACED_ORDER_FILTER_SQL = `
  tenant_id = ?
    and organization_id = ?
    and deleted_at is null
    and placed_at is not null
    and (status is null or status not in ('canceled', 'cancelled'))
`

const ORDER_AGGREGATE_SQL = `
  select
    count(*)::int as order_count,
    coalesce(sum(grand_total_gross_amount), 0)::text as total_gross,
    max(placed_at) as last_placed_at
  from sales_orders
  where customer_entity_id = ?
    and ${PLACED_ORDER_FILTER_SQL}
`

type OrderAggregateRow = {
  order_count: number
  total_gross: string
  last_placed_at: Date | string | null
}

const MS_PER_DAY = 86_400_000

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)
}

export async function loadOrderAggregates(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  now: Date,
): Promise<SubjectDocument['orders']> {
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
    // The SKUs are loaded separately and merged by the caller; this function answers about amounts.
    skus: [],
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

  return aggregates
}

/** How many distinct SKUs a subject document carries. Beyond this the list stops being a filter. */
const MAX_SUBJECT_SKUS = 200

/**
 * The same "order that counts" rule as `PLACED_ORDER_FILTER_SQL`, written for a joined query.
 *
 * Spelled out with the alias rather than derived from the other constant by string surgery: two
 * readable clauses that must be kept in step are safer than one clause mangled at runtime, and the
 * unit test asserts they stay equivalent.
 */
export const PLACED_ORDER_FILTER_SQL_ALIASED = `
  o.tenant_id = ?
    and o.organization_id = ?
    and o.deleted_at is null
    and o.placed_at is not null
    and (o.status is null or o.status not in ('canceled', 'cancelled'))
`

/**
 * Distinct product SKUs this customer has bought.
 *
 * Read from the order line's CATALOGUE SNAPSHOT, not from the catalogue: a product that was renamed,
 * re-skued or deleted must still target the customers who bought it, and the snapshot is the only record
 * of what they actually bought. The variant sku is the fallback, because a shop that skus only variants
 * would otherwise return nothing.
 */
export async function loadPurchasedSkus(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string[]> {
  const rows = await em.getConnection().execute<{ sku: string | null }[]>(
    `select distinct coalesce(
              l.catalog_snapshot -> 'product' ->> 'sku',
              l.catalog_snapshot -> 'variant' ->> 'sku'
            ) as sku
       from sales_order_lines l
       join sales_orders o on o.id = l.order_id
      where o.customer_entity_id = ?
        and ${PLACED_ORDER_FILTER_SQL_ALIASED}
      limit ?`,
    [subjectEntityId, scope.tenantId, scope.organizationId, MAX_SUBJECT_SKUS],
  )
  return rows
    .map((row) => row.sku)
    .filter((sku): sku is string => typeof sku === 'string' && sku.length > 0)
}

/** Tag slugs, so an audience can ask `tags CONTAINS 'vip'` rather than carry uuids. */
export async function loadTagSlugs(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<string[]> {
  const rows = await em.getConnection().execute<{ slug: string }[]>(
    `select t.slug
       from customer_tag_assignments a
       join customer_tags t on t.id = a.tag_id
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
  options?: { tierThresholds?: TierThreshold[] },
): Promise<SubjectDocument> {
  if (!subjectEntityId) {
    const unscored = resolveTier(0, options?.tierThresholds)
    return {
      customer: null,
      tags: [],
      orders: { count: 0, totalGross: 0, skus: [] },
      score: { points: 0, tier: unscored.key, tierRank: unscored.rank },
      address: null,
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

  const [tags, orders, scorePoints, skus, address] = await Promise.all([
    loadTagSlugs(em, subjectEntityId, scope),
    loadOrderAggregates(em, subjectEntityId, scope, now),
    loadScorePoints(em, subjectEntityId, scope),
    loadPurchasedSkus(em, subjectEntityId, scope),
    loadSubjectAddress(em, subjectEntityId, scope),
  ])

  const tier = resolveTier(scorePoints, options?.tierThresholds)

  return {
    customer: entity
      ? {
          id: entity.id,
          email: entity.primaryEmail ?? null,
          displayName: entity.displayName ?? null,
          createdAt: entity.createdAt ? new Date(entity.createdAt).toISOString() : null,
        }
      : null,
    tags,
    orders: { ...orders, skus },
    score: { points: scorePoints, tier: tier.key, tierRank: tier.rank },
    address,
    trigger,
  }
}
