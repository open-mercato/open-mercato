import { sql, type RawBuilder } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { OMNIBUS_PRICE_REMOVING_UNDO_COMMAND } from './omnibusTypes'

export const OMNIBUS_IN_WINDOW_LIMIT = 1000

export type OmnibusScopeColumn = 'product_id' | 'variant_id' | 'offer_id'

export type OmnibusWindowLookup = {
  tenantId: string
  organizationId: string
  scopeColumn: OmnibusScopeColumn
  scopeId: string
  priceKindId: string
  currencyCode: string
  channelId: string | null
  windowStart: Date
  windowEnd: Date
}

export type OmnibusWindowLookupResult = {
  baselineId: string | null
  inWindowIds: string[]
}

export type OmnibusFirstOfferLookup = {
  tenantId: string
  organizationId: string
  offerId: string
  priceKindId: string
  currencyCode: string
  channelId: string | null
}

type LookupRow = { ord: string | number; part: string; id: string }

type FirstOfferRow = { ord: string | number; id: string }

const SCOPE_COLUMNS: Record<OmnibusScopeColumn, RawBuilder<unknown>> = {
  product_id: sql.ref('h.product_id'),
  variant_id: sql.ref('h.variant_id'),
  offer_id: sql.ref('h.offer_id'),
}

const OBSERVATION_CLAUSE = sql`AND h.change_type <> 'delete'
        AND NOT (h.change_type = 'undo' AND h.metadata->>'undoneCommand' = ${OMNIBUS_PRICE_REMOVING_UNDO_COMMAND})`

function lookupGroupKey(lookup: OmnibusWindowLookup): string {
  return `${lookup.scopeColumn}|${lookup.channelId ? 'channel' : 'any'}`
}

function kyselyFor(em: EntityManager) {
  return em.fork().getKysely()
}

async function runWindowGroup(
  em: EntityManager,
  scopeColumn: OmnibusScopeColumn,
  withChannel: boolean,
  lookups: OmnibusWindowLookup[],
): Promise<LookupRow[]> {
  const scopeRef = SCOPE_COLUMNS[scopeColumn]
  const channelClause = withChannel ? sql`AND (h.channel_id = w.channel_id OR h.channel_id IS NULL)` : sql``
  const tenantIds = lookups.map((lookup) => lookup.tenantId)
  const organizationIds = lookups.map((lookup) => lookup.organizationId)
  const scopeIds = lookups.map((lookup) => lookup.scopeId)
  const priceKindIds = lookups.map((lookup) => lookup.priceKindId)
  const currencyCodes = lookups.map((lookup) => lookup.currencyCode)
  const channelIds = lookups.map((lookup) => lookup.channelId)
  const windowStarts = lookups.map((lookup) => lookup.windowStart.toISOString())
  const windowEnds = lookups.map((lookup) => lookup.windowEnd.toISOString())
  const query = sql<LookupRow>`
    WITH w AS (
      SELECT * FROM unnest(
        ${tenantIds}::uuid[],
        ${organizationIds}::uuid[],
        ${scopeIds}::uuid[],
        ${priceKindIds}::uuid[],
        ${currencyCodes}::text[],
        ${channelIds}::uuid[],
        ${windowStarts}::timestamptz[],
        ${windowEnds}::timestamptz[]
      ) WITH ORDINALITY AS t(tenant_id, organization_id, scope_id, price_kind_id, currency_code, channel_id, window_start, window_end, ord)
    )
    SELECT w.ord, 'baseline' AS part, baseline.id
    FROM w
    CROSS JOIN LATERAL (
      SELECT h.id FROM catalog_price_history_entries h
      WHERE h.tenant_id = w.tenant_id
        AND h.organization_id = w.organization_id
        AND ${scopeRef} = w.scope_id
        ${channelClause}
        AND h.price_kind_id = w.price_kind_id
        AND h.currency_code = w.currency_code
        ${OBSERVATION_CLAUSE}
        AND h.recorded_at <= w.window_start
      ORDER BY h.recorded_at DESC, h.id DESC
      LIMIT 1
    ) baseline
    UNION ALL
    SELECT w.ord, 'window' AS part, in_window.id
    FROM w
    CROSS JOIN LATERAL (
      SELECT h.id FROM catalog_price_history_entries h
      WHERE h.tenant_id = w.tenant_id
        AND h.organization_id = w.organization_id
        AND ${scopeRef} = w.scope_id
        ${channelClause}
        AND h.price_kind_id = w.price_kind_id
        AND h.currency_code = w.currency_code
        ${OBSERVATION_CLAUSE}
        AND h.recorded_at > w.window_start
        AND h.recorded_at <= w.window_end
      ORDER BY h.recorded_at DESC, h.id DESC
      LIMIT ${OMNIBUS_IN_WINDOW_LIMIT}
    ) in_window
  `
  const result = await query.execute(kyselyFor(em))
  return result.rows
}

export async function fetchOmnibusWindowIds(
  em: EntityManager,
  lookups: OmnibusWindowLookup[],
): Promise<OmnibusWindowLookupResult[]> {
  const results: OmnibusWindowLookupResult[] = lookups.map(() => ({ baselineId: null, inWindowIds: [] }))
  const groups = new Map<string, number[]>()
  lookups.forEach((lookup, index) => {
    const key = lookupGroupKey(lookup)
    const bucket = groups.get(key) ?? []
    bucket.push(index)
    groups.set(key, bucket)
  })
  for (const indexes of groups.values()) {
    const groupLookups = indexes.map((index) => lookups[index])
    const first = groupLookups[0]
    const rows = await runWindowGroup(em, first.scopeColumn, Boolean(first.channelId), groupLookups)
    for (const row of rows) {
      const target = results[indexes[Number(row.ord) - 1]]
      if (!target) continue
      if (row.part === 'baseline') target.baselineId = row.id
      else target.inWindowIds.push(row.id)
    }
  }
  return results
}

export async function fetchOmnibusFirstOfferIds(
  em: EntityManager,
  lookups: OmnibusFirstOfferLookup[],
): Promise<Array<string | null>> {
  if (!lookups.length) return []
  const query = sql<FirstOfferRow>`
    WITH w AS (
      SELECT * FROM unnest(
        ${lookups.map((lookup) => lookup.tenantId)}::uuid[],
        ${lookups.map((lookup) => lookup.organizationId)}::uuid[],
        ${lookups.map((lookup) => lookup.offerId)}::uuid[],
        ${lookups.map((lookup) => lookup.priceKindId)}::uuid[],
        ${lookups.map((lookup) => lookup.currencyCode)}::text[],
        ${lookups.map((lookup) => lookup.channelId)}::uuid[]
      ) WITH ORDINALITY AS t(tenant_id, organization_id, offer_id, price_kind_id, currency_code, channel_id, ord)
    )
    SELECT w.ord, first_offer.id
    FROM w
    CROSS JOIN LATERAL (
      SELECT h.id FROM catalog_price_history_entries h
      WHERE h.tenant_id = w.tenant_id
        AND h.organization_id = w.organization_id
        AND h.offer_id = w.offer_id
        AND h.price_kind_id = w.price_kind_id
        AND h.currency_code = w.currency_code
        AND (h.channel_id = w.channel_id OR h.channel_id IS NULL)
        ${OBSERVATION_CLAUSE}
      ORDER BY h.recorded_at ASC, h.id ASC
      LIMIT 1
    ) first_offer
  `
  const result = await query.execute(kyselyFor(em))
  const ids: Array<string | null> = lookups.map(() => null)
  for (const row of result.rows) {
    const index = Number(row.ord) - 1
    if (index >= 0 && index < ids.length) ids[index] = row.id
  }
  return ids
}

export type OmnibusLatestPriceEntryLookup = {
  tenantId: string
  organizationId: string
  priceId: string
}

export async function fetchOmnibusLatestPriceEntryIds(
  em: EntityManager,
  lookups: OmnibusLatestPriceEntryLookup[],
): Promise<Array<string | null>> {
  if (!lookups.length) return []
  const query = sql<FirstOfferRow>`
    WITH w AS (
      SELECT * FROM unnest(
        ${lookups.map((lookup) => lookup.tenantId)}::uuid[],
        ${lookups.map((lookup) => lookup.organizationId)}::uuid[],
        ${lookups.map((lookup) => lookup.priceId)}::uuid[]
      ) WITH ORDINALITY AS t(tenant_id, organization_id, price_id, ord)
    )
    SELECT w.ord, latest.id
    FROM w
    CROSS JOIN LATERAL (
      SELECT h.id FROM catalog_price_history_entries h
      WHERE h.tenant_id = w.tenant_id
        AND h.organization_id = w.organization_id
        AND h.price_id = w.price_id
      ORDER BY h.recorded_at DESC, h.id DESC
      LIMIT 1
    ) latest
  `
  const result = await query.execute(kyselyFor(em))
  const ids: Array<string | null> = lookups.map(() => null)
  for (const row of result.rows) {
    const index = Number(row.ord) - 1
    if (index >= 0 && index < ids.length) ids[index] = row.id
  }
  return ids
}
