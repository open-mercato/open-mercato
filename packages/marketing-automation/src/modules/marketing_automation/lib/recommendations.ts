import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  MAX_RECOMMENDATIONS,
  rankRecommendations,
  type AffinityCandidate,
  type BestSellerCandidate,
  type Recommendation,
} from './engine/recommendations.js'
import { PLACED_ORDER_FILTER_SQL_ALIASED } from './subject-document.js'
import type { SubjectScope } from './subject-document.js'

/**
 * Product recommendations: the queries behind them, and how they reach a message.
 *
 * The ranking itself is pure (`lib/engine/recommendations.ts`). This file is the I/O half — two
 * aggregate queries over the order history, and the HTML the author's `{{recommendations}}` placeholder
 * is replaced with.
 */

/** Matched and replaced BEFORE interpolation, like a content block: generated HTML, inserted raw. */
const RECOMMENDATIONS_REFERENCE = /\{\{\s*recommendations\s*\}\}/gi

export function referencesRecommendations(html: string): boolean {
  RECOMMENDATIONS_REFERENCE.lastIndex = 0
  return RECOMMENDATIONS_REFERENCE.test(html)
}

/**
 * Substitutes the block, or removes the placeholder.
 *
 * An empty result removes it rather than leaving `{{recommendations}}` in the message: a shop with no
 * order history yet would otherwise mail the placeholder to its first customers.
 */
export function applyRecommendations(html: string, rendered: string): string {
  return html.replace(RECOMMENDATIONS_REFERENCE, () => rendered)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * Where a product can be looked at, when the deployment has somewhere to send people.
 *
 * `{sku}` in a per-tenant template. There is no storefront in the platform yet, so a recommendation
 * would otherwise be an unclickable list of names — and most shops running this do have a storefront
 * somewhere. Without the template the names render as plain text, which is worse but honest.
 */
export const PRODUCT_URL_TEMPLATE_CONFIG = 'product_url_template'

export function productUrlFor(template: string | null, sku: string): string | null {
  if (!template || !template.includes('{sku}')) return null
  return template.replace('{sku}', encodeURIComponent(sku))
}

/**
 * The HTML for a recommendation block.
 *
 * A table, because email clients still lay tables out predictably and a flex row does not survive
 * Outlook. Names are escaped — they come from a catalogue snapshot, which an importer wrote.
 *
 * No PRICE, deliberately. The snapshot records what somebody else paid at the time they paid it; printing
 * it offers a price the shop may no longer honour, which is a refund conversation rather than a sale.
 */
export function renderRecommendationsHtml(
  items: Recommendation[],
  options: { urlTemplate?: string | null; headingHtml?: string } = {},
): string {
  if (items.length === 0) return ''
  const heading = options.headingHtml ? `<tr><td style="padding-bottom:8px">${options.headingHtml}</td></tr>` : ''
  const rows = items.map((item) => {
    const url = productUrlFor(options.urlTemplate ?? null, item.sku)
    const label = escapeHtml(item.name)
    const cell = url
      ? `<a href="${escapeHtml(url)}" style="color:#1a1a1a;text-decoration:underline">${label}</a>`
      : label
    return `<tr><td style="padding:4px 0;font-size:14px">${cell}</td></tr>`
  }).join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0">${heading}${rows}</table>`
}

type AffinityRow = { sku: string | null; name: string | null; co_occurrences: number; distinct_customers: number }
type BestSellerRow = { sku: string | null; name: string | null; orders: number }

/** One expression, used by every query here, so "the product on this line" is defined once. */
const LINE_SKU_SQL = `coalesce(
  l.catalog_snapshot -> 'product' ->> 'sku',
  l.catalog_snapshot -> 'variant' ->> 'sku'
)`

const LINE_NAME_SQL = `coalesce(
  l.catalog_snapshot -> 'product' ->> 'title',
  l.catalog_snapshot -> 'product' ->> 'name',
  l.catalog_snapshot -> 'variant' ->> 'title',
  l.catalog_snapshot -> 'variant' ->> 'name'
)`

/**
 * What customers who bought what this customer bought also bought.
 *
 * Scoped to orders CONTAINING one of the subject's SKUs, counted per other SKU. Distinct customers are
 * counted separately from lines because the ranking weighs them differently, and the two numbers diverge
 * exactly where it matters — one enthusiastic repeat buyer versus a broad pattern.
 */
export async function loadAffinityCandidates(
  em: EntityManager,
  scope: SubjectScope,
  subjectEntityId: string,
  limit: number,
): Promise<AffinityCandidate[]> {
  const rows = await em.getConnection().execute<AffinityRow[]>(
    `with mine as (
        select distinct ${LINE_SKU_SQL} as sku
          from sales_order_lines l
          join sales_orders o on o.id = l.order_id
         where o.customer_entity_id = ?
           and ${PLACED_ORDER_FILTER_SQL_ALIASED}
      ),
      peer_orders as (
        select distinct o.id as order_id
          from sales_order_lines l
          join sales_orders o on o.id = l.order_id
         where ${PLACED_ORDER_FILTER_SQL_ALIASED}
           and ${LINE_SKU_SQL} in (select sku from mine where sku is not null)
      )
      select ${LINE_SKU_SQL} as sku,
             max(${LINE_NAME_SQL}) as name,
             count(*)::int as co_occurrences,
             count(distinct o.customer_entity_id)::int as distinct_customers
        from sales_order_lines l
        join sales_orders o on o.id = l.order_id
       where o.id in (select order_id from peer_orders)
         and ${PLACED_ORDER_FILTER_SQL_ALIASED}
         and ${LINE_SKU_SQL} is not null
         and ${LINE_SKU_SQL} not in (select sku from mine where sku is not null)
       group by 1
       order by distinct_customers desc, co_occurrences desc
       limit ?`,
    [
      subjectEntityId,
      scope.tenantId, scope.organizationId,
      scope.tenantId, scope.organizationId,
      scope.tenantId, scope.organizationId,
      limit,
    ],
  )
  return rows.flatMap((row) => (row.sku
    ? [{ sku: row.sku, name: row.name ?? row.sku, coOccurrences: row.co_occurrences, distinctCustomers: row.distinct_customers }]
    : []))
}

/** What sells, for padding and for a customer with no history at all. */
export async function loadBestSellers(
  em: EntityManager,
  scope: SubjectScope,
  limit: number,
): Promise<BestSellerCandidate[]> {
  const rows = await em.getConnection().execute<BestSellerRow[]>(
    `select ${LINE_SKU_SQL} as sku,
            max(${LINE_NAME_SQL}) as name,
            count(distinct o.id)::int as orders
       from sales_order_lines l
       join sales_orders o on o.id = l.order_id
      where ${PLACED_ORDER_FILTER_SQL_ALIASED}
        and ${LINE_SKU_SQL} is not null
      group by 1
      order by orders desc
      limit ?`,
    [scope.tenantId, scope.organizationId, limit],
  )
  return rows.flatMap((row) => (row.sku
    ? [{ sku: row.sku, name: row.name ?? row.sku, orders: row.orders }]
    : []))
}

/** Distinct SKUs the customer already owns, so they are not offered back to them. */
async function loadOwnedSkus(
  em: EntityManager,
  scope: SubjectScope,
  subjectEntityId: string,
): Promise<string[]> {
  const rows = await em.getConnection().execute<{ sku: string | null }[]>(
    `select distinct ${LINE_SKU_SQL} as sku
       from sales_order_lines l
       join sales_orders o on o.id = l.order_id
      where o.customer_entity_id = ?
        and ${PLACED_ORDER_FILTER_SQL_ALIASED}`,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  return rows.flatMap((row) => (row.sku ? [row.sku] : []))
}

/**
 * The recommendations for one customer, ranked.
 *
 * A customer with no orders still gets an answer — best-sellers — because a welcome message is exactly
 * where a recommendation earns the most and exactly where affinity has nothing to say.
 */
export async function recommendForSubject(
  em: EntityManager,
  scope: SubjectScope,
  subjectEntityId: string | null,
  limit: number,
): Promise<Recommendation[]> {
  const wanted = Math.max(0, Math.min(limit, MAX_RECOMMENDATIONS))
  if (wanted === 0) return []

  // Padding is fetched at the same depth as the request, plus room for what the exclusion removes.
  const fetchDepth = wanted * 3
  const bestSellers = await loadBestSellers(em, scope, fetchDepth)
  if (!subjectEntityId) return rankRecommendations({ affinity: [], bestSellers, alreadyPurchased: [], limit: wanted })

  const [affinity, alreadyPurchased] = await Promise.all([
    loadAffinityCandidates(em, scope, subjectEntityId, fetchDepth),
    loadOwnedSkus(em, scope, subjectEntityId),
  ])
  return rankRecommendations({ affinity, bestSellers, alreadyPurchased, limit: wanted })
}

export type { Recommendation }

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/**
 * The tenant's product URL template, or null.
 *
 * Resolved defensively like the tier ladder: this module has to keep sending in a process that never
 * registered the core config service, and an absent template costs the links, not the message.
 */
export async function loadProductUrlTemplate(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<string | null> {
  let service: ModuleConfigLike | null = null
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return null
  }
  try {
    // The scope belongs inside an options object; positionally it is dropped and the read falls back
    // to the instance-wide value.
    const value = await service.getValue<unknown>('marketing_automation', PRODUCT_URL_TEMPLATE_CONFIG, { scope })
    return typeof value === 'string' && value.includes('{sku}') ? value : null
  } catch {
    return null
  }
}
