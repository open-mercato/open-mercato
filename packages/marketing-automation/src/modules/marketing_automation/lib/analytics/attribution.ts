import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../subject-document.js'
import { SALES_ORDERS } from '../external/tables.js'
import { hasSales } from '../capabilities.js'

/**
 * Linear multi-touch revenue attribution.
 *
 * The question a marketing budget is renewed on: what did the campaigns earn. Answered by finding the
 * orders a customer placed after clicking a campaign link, within a window, and splitting each order's
 * revenue EQUALLY across every campaign they clicked in that window.
 *
 * Linear rather than last-touch on purpose. Last-touch is easier and systematically flatters whichever
 * campaign happens to run closest to the purchase — usually the one that needed the least persuasion.
 * Equal shares make no claim about which message did the work, which is honest, and they sum to exactly
 * the order total, which last-touch also does but first-touch does not.
 */

/** One (order, campaign) pair: this customer clicked that campaign, then placed that order. */
export type AttributionTouch = {
  orderId: string
  campaignId: string
  currencyCode: string | null
  orderTotal: number
}

export type AttributionRow = {
  campaignId: string
  currencyCode: string | null
  orders: number
  revenue: number
}

/**
 * Splits each order's revenue across the campaigns that touched it.
 *
 * Kept pure and separate from the query: the division is the part with a decision in it, and a decision
 * that cannot be unit-tested is a decision nobody will revisit.
 */
export function attributeLinear(touches: AttributionTouch[]): AttributionRow[] {
  const byOrder = new Map<string, AttributionTouch[]>()
  for (const touch of touches) {
    // A campaign clicked twice before one order is still one touch: otherwise a customer who clicked
    // the same newsletter three times would hand it three quarters of the revenue.
    const existing = byOrder.get(touch.orderId) ?? []
    if (existing.some((entry) => entry.campaignId === touch.campaignId)) continue
    existing.push(touch)
    byOrder.set(touch.orderId, existing)
  }

  const totals = new Map<string, AttributionRow>()
  for (const [, orderTouches] of byOrder) {
    const share = 1 / orderTouches.length
    for (const touch of orderTouches) {
      const key = `${touch.campaignId}::${touch.currencyCode ?? ''}`
      const row = totals.get(key) ?? {
        campaignId: touch.campaignId,
        currencyCode: touch.currencyCode,
        orders: 0,
        revenue: 0,
      }
      row.orders += 1
      row.revenue += touch.orderTotal * share
      totals.set(key, row)
    }
  }

  return [...totals.values()]
    .map((row) => ({ ...row, revenue: Math.round(row.revenue * 100) / 100 }))
    // Currencies are never summed together: a total mixing PLN and EUR is a number that means nothing.
    .sort((left, right) => right.revenue - left.revenue)
}

const TOUCHES_SQL = `
  with clicks as (
    select distinct e.campaign_id, r.subject_entity_id, e.occurred_at
      from marketing_message_send_events e
      join marketing_campaign_runs r on r.id = e.run_id
     where e.type = 'clicked'
       and e.tenant_id = ?
       and e.organization_id = ?
       and e.occurred_at >= ?
       and r.subject_entity_id is not null
  )
  select distinct o.id as order_id,
         c.campaign_id,
         o.currency_code,
         o.grand_total_gross_amount::text as order_total
    from clicks c
    join ${SALES_ORDERS} o
      on o.customer_entity_id = c.subject_entity_id
     and o.placed_at > c.occurred_at
     and o.placed_at <= c.occurred_at + make_interval(days => ?)
   where o.tenant_id = ?
     and o.organization_id = ?
     and o.deleted_at is null
     and o.placed_at is not null
     and (o.status is null or o.status not in ('canceled', 'cancelled'))
`

type TouchRow = {
  order_id: string
  campaign_id: string
  currency_code: string | null
  order_total: string | null
}

export type AttributionQuery = {
  /** How long after a click an order still counts. */
  windowDays: number
  /** Only clicks from this instant onwards, which bounds the report rather than the model. */
  since: Date
  /** Narrow the answer to one campaign, after the shares have been computed across all of them. */
  campaignId?: string | null
}

export async function loadAttribution(
  em: EntityManager,
  scope: SubjectScope,
  query: AttributionQuery,
): Promise<AttributionRow[]> {
  /**
   * Nothing to attribute without `sales`, which is not the same claim as zero revenue.
   *
   * An empty list is what the screens already render for a campaign that has earned nothing yet, and
   * `pickSplitWinner` already refuses a verdict on a lane with nothing attributed — so the absence travels
   * through the existing path rather than needing a second one.
   */
  if (!(await hasSales(em))) return []
  const rows = await em.getConnection().execute<TouchRow[]>(TOUCHES_SQL, [
    scope.tenantId,
    scope.organizationId,
    query.since,
    query.windowDays,
    scope.tenantId,
    scope.organizationId,
  ])

  const touches: AttributionTouch[] = rows.map((row) => ({
    orderId: row.order_id,
    campaignId: row.campaign_id,
    currencyCode: row.currency_code,
    // Money is numeric-as-string throughout sales.
    orderTotal: Number.parseFloat(row.order_total ?? '0') || 0,
  }))

  const attributed = attributeLinear(touches)
  // Filtered AFTER the split, never before: a campaign's share depends on how many others touched the
  // same order, so narrowing the query first would overstate it.
  return query.campaignId
    ? attributed.filter((row) => row.campaignId === query.campaignId)
    : attributed
}
