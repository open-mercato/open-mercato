import { sql, type Kysely } from 'kysely'

/**
 * Line scan of the price backtest (spec `2026-10-08-insights-change-simulator.md` S9): the order or
 * quote lines of one organization that reference a catalog price row through `metadata.priceId`,
 * created inside the run window, on live (not deleted) lines of live documents of the same tenant
 * and organization, in `(created_at, id)` keyset order. `metadata.priceId` has no index: the scan
 * is bounded by tenant + organization + window, the caller's record budget and the slice's
 * statement timeout. Every value is a bound parameter; table names come from a fixed list.
 */

export const PRICE_LINE_FAMILIES = {
  orders: { lines: 'sales_order_lines', documents: 'sales_orders', documentKey: 'order_id' },
  quotes: { lines: 'sales_quote_lines', documents: 'sales_quotes', documentKey: 'quote_id' },
} as const

export type PriceLineFamily = keyof typeof PRICE_LINE_FAMILIES

export const PRICE_LINE_MAX_LIMIT = 1000

export type PriceLineCursor = {
  at: string
  id: string
}

export type PriceLineRow = {
  id: string
  documentId: string
  cursorAt: string
  createdAt: string
  updatedAt: string | null
  currencyCode: string | null
  quantity: string | null
  quantityUnit: string | null
  normalizedUnit: string | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  priceMode: string | null
  uomFactor: string | null
}

export type PriceLinePage = {
  rows: PriceLineRow[]
  lastCursor: PriceLineCursor | null
  exhausted: boolean
}

export type PriceLineScope = {
  family: PriceLineFamily
  tenantId: string
  organizationId: string
  from: Date
  to: Date
}

export type PriceLinePageQuery = PriceLineScope & {
  priceId: string
  after: PriceLineCursor | null
  limit: number
}

export type UnlinkedPriceLinesQuery = PriceLineScope & {
  productId: string | null
  variantId: string | null
  cap: number
}

type RawPriceLineRow = {
  id: string
  document_id: string
  cursor_at: string
  created_at: string
  updated_at: string | null
  currency_code: string | null
  quantity: string | null
  quantity_unit: string | null
  normalized_unit: string | null
  unit_price_net: string | null
  unit_price_gross: string | null
  price_mode: string | null
  uom_factor: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

export function isValidPriceLineCursor(cursor: unknown): cursor is PriceLineCursor {
  if (!cursor || typeof cursor !== 'object') return false
  const candidate = cursor as Partial<PriceLineCursor>
  return typeof candidate.at === 'string'
    && CURSOR_TIMESTAMP_PATTERN.test(candidate.at)
    && !Number.isNaN(Date.parse(candidate.at))
    && isUuid(candidate.id)
}

function assertScope(query: PriceLineScope): void {
  if (!Object.prototype.hasOwnProperty.call(PRICE_LINE_FAMILIES, query.family)) throw new TypeError('[internal] Unknown price line family')
  if (!isUuid(query.tenantId)) throw new TypeError('[internal] Invalid price line tenant id')
  if (!isUuid(query.organizationId)) throw new TypeError('[internal] Invalid price line organization id')
  if (!isValidDate(query.from) || !isValidDate(query.to)) throw new TypeError('[internal] Invalid price line window')
}

function clampLimit(limit: number, max: number): number {
  if (!Number.isFinite(limit)) return 1
  return Math.min(Math.max(Math.trunc(limit), 1), max)
}

function scopedLines(query: PriceLineScope) {
  const tables = PRICE_LINE_FAMILIES[query.family]
  const lines = sql.table(tables.lines)
  const documents = sql.table(tables.documents)
  const documentKey = sql.ref(`l.${tables.documentKey}`)
  return sql`
    from ${lines} as l
    join ${documents} as d on d.id = ${documentKey}
    where l.tenant_id = ${query.tenantId}::uuid
      and l.organization_id = ${query.organizationId}::uuid
      and l.deleted_at is null
      and d.tenant_id = ${query.tenantId}::uuid
      and d.organization_id = ${query.organizationId}::uuid
      and d.deleted_at is null
      and l.created_at >= ${query.from}
      and l.created_at < ${query.to}`
}

/**
 * One page of lines referencing `priceId` after `after` (exclusive), within `[from, to)`. Probes
 * `limit + 1` rows to know whether the window is exhausted. `createdAt` / `updatedAt` are ISO
 * timestamps with millisecond precision (the precision audit times are compared at); `cursorAt`
 * keeps microseconds for the keyset.
 */
export async function readPriceLinePage<TDatabase>(db: Kysely<TDatabase>, query: PriceLinePageQuery): Promise<PriceLinePage> {
  assertScope(query)
  if (!isUuid(query.priceId)) throw new TypeError('[internal] Invalid price line price id')
  if (query.after !== null && !isValidPriceLineCursor(query.after)) throw new TypeError('[internal] Invalid price line cursor')
  if (query.from.getTime() >= query.to.getTime()) return { rows: [], lastCursor: null, exhausted: true }
  const limit = clampLimit(query.limit, PRICE_LINE_MAX_LIMIT)
  const tables = PRICE_LINE_FAMILIES[query.family]
  const documentKey = sql.ref(`l.${tables.documentKey}`)
  const after = query.after
    ? sql`and (l.created_at > ${query.after.at}::timestamptz or (l.created_at = ${query.after.at}::timestamptz and l.id > ${query.after.id}::uuid))`
    : sql``
  const result = await sql<RawPriceLineRow>`
    select
      l.id::text as id,
      ${documentKey}::text as document_id,
      to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
      to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
      to_char(l.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
      l.currency_code,
      l.quantity::text as quantity,
      l.quantity_unit,
      l.normalized_unit,
      l.unit_price_net::text as unit_price_net,
      l.unit_price_gross::text as unit_price_gross,
      l.metadata ->> 'priceMode' as price_mode,
      l.uom_snapshot ->> 'toBaseFactor' as uom_factor
    ${scopedLines(query)}
      and lower(l.metadata ->> 'priceId') = ${query.priceId.toLowerCase()}
      ${after}
    order by l.created_at asc, l.id asc
    limit ${limit + 1}
  `.execute(db)
  const page = result.rows.slice(0, limit)
  const rows: PriceLineRow[] = page.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    cursorAt: row.cursor_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    currencyCode: row.currency_code ?? null,
    quantity: row.quantity ?? null,
    quantityUnit: row.quantity_unit ?? null,
    normalizedUnit: row.normalized_unit ?? null,
    unitPriceNet: row.unit_price_net ?? null,
    unitPriceGross: row.unit_price_gross ?? null,
    priceMode: row.price_mode ?? null,
    uomFactor: row.uom_factor ?? null,
  }))
  const last = rows.at(-1)
  return {
    rows,
    lastCursor: last ? { at: last.cursorAt, id: last.id } : null,
    exhausted: result.rows.length <= limit,
  }
}

/**
 * Lines of the price row's product (or variant, for a variant row) inside the window that carry
 * no price link at all: the backtest cannot see them (coverage). Counts at most `cap` lines.
 */
export async function countUnlinkedPriceLines<TDatabase>(db: Kysely<TDatabase>, query: UnlinkedPriceLinesQuery): Promise<number> {
  assertScope(query)
  const cap = clampLimit(query.cap, 100_000)
  const target = isUuid(query.variantId)
    ? sql`l.product_variant_id = ${query.variantId}::uuid`
    : isUuid(query.productId)
      ? sql`l.product_id = ${query.productId}::uuid`
      : null
  if (!target || query.from.getTime() >= query.to.getTime()) return 0
  const result = await sql<{ count: number }>`
    select count(*)::int as count from (
      select 1
      ${scopedLines(query)}
        and ${target}
        and nullif(btrim(coalesce(l.metadata ->> 'priceId', '')), '') is null
      limit ${cap}
    ) as unlinked
  `.execute(db)
  const count = Number(result.rows[0]?.count ?? 0)
  return Number.isFinite(count) && count > 0 ? count : 0
}
