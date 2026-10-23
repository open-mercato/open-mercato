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

const SCOPE_LEVEL_CLAUSES: Record<OmnibusScopeColumn, RawBuilder<unknown>> = {
  product_id: sql`AND h.variant_id IS NULL`,
  variant_id: sql``,
  offer_id: sql``,
}

const OBSERVATION_CLAUSE = sql`AND h.change_type <> 'delete'
        AND NOT (h.change_type = 'undo' AND h.metadata->>'undoneCommand' = ${OMNIBUS_PRICE_REMOVING_UNDO_COMMAND})`

const NOT_ENDED_BEFORE_WINDOW_CLAUSE = sql`AND NOT EXISTS (
          SELECT 1 FROM catalog_price_history_entries ended
          WHERE ended.tenant_id = h.tenant_id
            AND ended.organization_id = h.organization_id
            AND ended.price_id = h.price_id
            AND ended.recorded_at > h.recorded_at
            AND ended.recorded_at <= w.window_start
            AND (
              ended.change_type = 'delete'
              OR (ended.change_type = 'undo' AND ended.metadata->>'undoneCommand' = ${OMNIBUS_PRICE_REMOVING_UNDO_COMMAND})
            )
        )`

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
  const scopeLevelClause = SCOPE_LEVEL_CLAUSES[scopeColumn]
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
        ${scopeLevelClause}
        ${channelClause}
        AND h.price_kind_id = w.price_kind_id
        AND h.currency_code = w.currency_code
        ${OBSERVATION_CLAUSE}
        AND h.recorded_at <= w.window_start
        ${NOT_ENDED_BEFORE_WINDOW_CLAUSE}
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
        ${scopeLevelClause}
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

export type OmnibusPrecedingLookup = {
  tenantId: string
  organizationId: string
  scopeColumn: OmnibusScopeColumn
  scopeId: string
  priceKindId: string
  currencyCode: string
  channelId: string | null
  before: Date
}

export const OMNIBUS_PRECEDING_LIMIT = 2

async function runPrecedingGroup(
  em: EntityManager,
  scopeColumn: OmnibusScopeColumn,
  withChannel: boolean,
  lookups: OmnibusPrecedingLookup[],
): Promise<LookupRow[]> {
  const scopeRef = SCOPE_COLUMNS[scopeColumn]
  const scopeLevelClause = SCOPE_LEVEL_CLAUSES[scopeColumn]
  const channelClause = withChannel ? sql`AND (h.channel_id = w.channel_id OR h.channel_id IS NULL)` : sql``
  const query = sql<LookupRow>`
    WITH w AS (
      SELECT * FROM unnest(
        ${lookups.map((lookup) => lookup.tenantId)}::uuid[],
        ${lookups.map((lookup) => lookup.organizationId)}::uuid[],
        ${lookups.map((lookup) => lookup.scopeId)}::uuid[],
        ${lookups.map((lookup) => lookup.priceKindId)}::uuid[],
        ${lookups.map((lookup) => lookup.currencyCode)}::text[],
        ${lookups.map((lookup) => lookup.channelId)}::uuid[],
        ${lookups.map((lookup) => lookup.before.toISOString())}::timestamptz[]
      ) WITH ORDINALITY AS t(tenant_id, organization_id, scope_id, price_kind_id, currency_code, channel_id, before_at, ord)
    )
    SELECT w.ord, 'preceding' AS part, preceding.id
    FROM w
    CROSS JOIN LATERAL (
      SELECT h.id FROM catalog_price_history_entries h
      WHERE h.tenant_id = w.tenant_id
        AND h.organization_id = w.organization_id
        AND ${scopeRef} = w.scope_id
        ${scopeLevelClause}
        ${channelClause}
        AND h.price_kind_id = w.price_kind_id
        AND h.currency_code = w.currency_code
        ${OBSERVATION_CLAUSE}
        AND h.recorded_at < w.before_at
        AND NOT EXISTS (
          SELECT 1 FROM catalog_price_history_entries ended
          WHERE ended.tenant_id = h.tenant_id
            AND ended.organization_id = h.organization_id
            AND ended.price_id = h.price_id
            AND ended.recorded_at > h.recorded_at
            AND ended.recorded_at < w.before_at
            AND (
              ended.change_type = 'delete'
              OR (ended.change_type = 'undo' AND ended.metadata->>'undoneCommand' = ${OMNIBUS_PRICE_REMOVING_UNDO_COMMAND})
            )
        )
      ORDER BY h.recorded_at DESC, h.id DESC
      LIMIT ${OMNIBUS_PRECEDING_LIMIT}
    ) preceding
  `
  const result = await query.execute(kyselyFor(em))
  return result.rows
}

/**
 * Newest price observations recorded strictly before `before` whose price was still live at that point,
 * newest first — the candidates for the "price immediately preceding the reduction" used by the
 * perishable-goods derogation (Art. 6a(3)).
 */
export async function fetchOmnibusPrecedingIds(
  em: EntityManager,
  lookups: OmnibusPrecedingLookup[],
): Promise<string[][]> {
  const results: string[][] = lookups.map(() => [])
  const groups = new Map<string, number[]>()
  lookups.forEach((lookup, index) => {
    const key = `${lookup.scopeColumn}|${lookup.channelId ? 'channel' : 'any'}`
    const bucket = groups.get(key) ?? []
    bucket.push(index)
    groups.set(key, bucket)
  })
  for (const indexes of groups.values()) {
    const groupLookups = indexes.map((index) => lookups[index])
    const first = groupLookups[0]
    const rows = await runPrecedingGroup(em, first.scopeColumn, Boolean(first.channelId), groupLookups)
    for (const row of rows) {
      const target = results[indexes[Number(row.ord) - 1]]
      if (target) target.push(row.id)
    }
  }
  return results
}

export type OmnibusCampaignLookup = {
  tenantId: string
  organizationId: string
  offerId: string
  baselineScopeColumn: Exclude<OmnibusScopeColumn, 'offer_id'>
  baselineScopeId: string
  priceKindId: string
  currencyCode: string
  channelId: string | null
}

export type OmnibusCampaignLookupResult = {
  campaignIds: string[]
  baselineId: string | null
}

async function runCampaignGroup(
  em: EntityManager,
  baselineScopeColumn: OmnibusCampaignLookup['baselineScopeColumn'],
  withChannel: boolean,
  lookups: OmnibusCampaignLookup[],
): Promise<LookupRow[]> {
  const scopeRef = SCOPE_COLUMNS[baselineScopeColumn]
  const scopeLevelClause = SCOPE_LEVEL_CLAUSES[baselineScopeColumn]
  const channelClause = withChannel ? sql`AND (h.channel_id = w.channel_id OR h.channel_id IS NULL)` : sql``
  const query = sql<LookupRow>`
    WITH w AS (
      SELECT * FROM unnest(
        ${lookups.map((lookup) => lookup.tenantId)}::uuid[],
        ${lookups.map((lookup) => lookup.organizationId)}::uuid[],
        ${lookups.map((lookup) => lookup.offerId)}::uuid[],
        ${lookups.map((lookup) => lookup.baselineScopeId)}::uuid[],
        ${lookups.map((lookup) => lookup.priceKindId)}::uuid[],
        ${lookups.map((lookup) => lookup.currencyCode)}::text[],
        ${lookups.map((lookup) => lookup.channelId)}::uuid[]
      ) WITH ORDINALITY AS t(tenant_id, organization_id, offer_id, scope_id, price_kind_id, currency_code, channel_id, ord)
    ),
    campaign AS (
      SELECT w.ord, entry.id, entry.recorded_at
      FROM w
      CROSS JOIN LATERAL (
        SELECT h.id, h.recorded_at FROM catalog_price_history_entries h
        WHERE h.tenant_id = w.tenant_id
          AND h.organization_id = w.organization_id
          AND h.offer_id = w.offer_id
          ${channelClause}
          AND h.price_kind_id = w.price_kind_id
          AND h.currency_code = w.currency_code
          ${OBSERVATION_CLAUSE}
        ORDER BY h.recorded_at ASC, h.id ASC
        LIMIT ${OMNIBUS_IN_WINDOW_LIMIT}
      ) entry
    ),
    campaign_start AS (
      SELECT ord, min(recorded_at) AS started_at FROM campaign GROUP BY ord
    )
    SELECT campaign.ord, 'campaign' AS part, campaign.id FROM campaign
    UNION ALL
    SELECT w.ord, 'baseline' AS part, baseline.id
    FROM w
    JOIN campaign_start cs ON cs.ord = w.ord
    CROSS JOIN LATERAL (
      SELECT h.id FROM catalog_price_history_entries h
      WHERE h.tenant_id = w.tenant_id
        AND h.organization_id = w.organization_id
        AND ${scopeRef} = w.scope_id
        ${scopeLevelClause}
        AND h.offer_id IS NULL
        ${channelClause}
        AND h.price_kind_id = w.price_kind_id
        AND h.currency_code = w.currency_code
        ${OBSERVATION_CLAUSE}
        AND h.recorded_at < cs.started_at
        AND NOT EXISTS (
          SELECT 1 FROM catalog_price_history_entries ended
          WHERE ended.tenant_id = h.tenant_id
            AND ended.organization_id = h.organization_id
            AND ended.price_id = h.price_id
            AND ended.recorded_at > h.recorded_at
            AND ended.recorded_at < cs.started_at
            AND (
              ended.change_type = 'delete'
              OR (ended.change_type = 'undo' AND ended.metadata->>'undoneCommand' = ${OMNIBUS_PRICE_REMOVING_UNDO_COMMAND})
            )
        )
      ORDER BY h.recorded_at DESC, h.id DESC
      LIMIT 1
    ) baseline
  `
  const result = await query.execute(kyselyFor(em))
  return result.rows
}

/**
 * The offer's price observations in recording order plus the price in effect just before the offer's
 * first entry — the inputs of the progressive-reduction derogation (Art. 6a(5)).
 */
export async function fetchOmnibusCampaignIds(
  em: EntityManager,
  lookups: OmnibusCampaignLookup[],
): Promise<OmnibusCampaignLookupResult[]> {
  const results: OmnibusCampaignLookupResult[] = lookups.map(() => ({ campaignIds: [], baselineId: null }))
  const groups = new Map<string, number[]>()
  lookups.forEach((lookup, index) => {
    const key = `${lookup.baselineScopeColumn}|${lookup.channelId ? 'channel' : 'any'}`
    const bucket = groups.get(key) ?? []
    bucket.push(index)
    groups.set(key, bucket)
  })
  for (const indexes of groups.values()) {
    const groupLookups = indexes.map((index) => lookups[index])
    const first = groupLookups[0]
    const rows = await runCampaignGroup(em, first.baselineScopeColumn, Boolean(first.channelId), groupLookups)
    for (const row of rows) {
      const target = results[indexes[Number(row.ord) - 1]]
      if (!target) continue
      if (row.part === 'baseline') target.baselineId = row.id
      else target.campaignIds.push(row.id)
    }
  }
  return results
}
