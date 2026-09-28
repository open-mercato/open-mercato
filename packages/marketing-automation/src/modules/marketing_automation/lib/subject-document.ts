import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import type { SubjectDocument } from './engine/types.js'
import { FALLBACK_TIME_ZONE } from './engine/gates.js'

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
 */
const ORDER_AGGREGATE_SQL = `
  select
    count(*)::int as order_count,
    coalesce(sum(grand_total_gross_amount), 0)::text as total_gross,
    max(placed_at) as last_placed_at
  from sales_orders
  where customer_entity_id = ?
    and tenant_id = ?
    and organization_id = ?
    and deleted_at is null
    and placed_at is not null
    and (status is null or status not in ('canceled', 'cancelled'))
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
): Promise<SubjectDocument> {
  if (!subjectEntityId) {
    return { customer: null, tags: [], orders: { count: 0, totalGross: 0 }, trigger }
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

  const [tags, orders] = await Promise.all([
    loadTagSlugs(em, subjectEntityId, scope),
    loadOrderAggregates(em, subjectEntityId, scope, now),
  ])

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
    orders,
    trigger,
  }
}
