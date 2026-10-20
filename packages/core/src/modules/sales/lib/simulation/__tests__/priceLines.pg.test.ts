/**
 * Runs the price backtest line scan SQL (scope, window, `metadata.priceId` match, keyset paging,
 * unlinked-line counts) against a real PostgreSQL. Gated on OM_SALES_SIM_PG_URL (a throwaway
 * database): the suite creates its own uniquely named schema whose four sales tables take the
 * column types of the module's migration snapshot, and drops it afterwards.
 *
 *   OM_SALES_SIM_PG_URL=postgres://postgres:postgres@localhost:55432/om_sim_price \
 *     npx jest --config jest.config.cjs --runInBand src/modules/sales/lib/simulation
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { PRICE_LINE_FAMILIES, countUnlinkedPriceLines, isValidPriceLineCursor, readPriceLinePage, type PriceLinePageQuery } from '../priceLines'

const PG_URL = process.env.OM_SALES_SIM_PG_URL
const describeWithPostgres = PG_URL ? describe : describe.skip

const TENANT = '11111111-0000-4000-8000-0000000000d1'
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000d2'
const ORG = '22222222-0000-4000-8000-0000000000d1'
const OTHER_ORG = '22222222-0000-4000-8000-0000000000d2'
const PRICE_ID = '33333333-0000-4000-8000-0000000000d1'
const OTHER_PRICE_ID = '33333333-0000-4000-8000-0000000000d2'
const PRODUCT_ID = '55555555-0000-4000-8000-0000000000d1'
const VARIANT_ID = '55555555-0000-4000-8000-0000000000d2'
const FROM = new Date('2026-08-01T00:00:00.000Z')
const TO = new Date('2026-09-01T00:00:00.000Z')

type SnapshotTable = { name: string; columns: Record<string, { type: string; nullable?: boolean }> }

const SCANNED_COLUMNS = {
  lines: ['id', 'tenant_id', 'organization_id', 'product_id', 'product_variant_id', 'quantity', 'quantity_unit', 'normalized_unit', 'uom_snapshot', 'currency_code', 'unit_price_net', 'unit_price_gross', 'metadata', 'created_at', 'updated_at', 'deleted_at'],
  documents: ['id', 'tenant_id', 'organization_id', 'deleted_at'],
}

function readSnapshotTables(): Map<string, SnapshotTable> {
  const snapshot = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'migrations', '.snapshot-open-mercato.json'), 'utf8')) as { tables: SnapshotTable[] }
  return new Map(snapshot.tables.map((table) => [table.name, table]))
}

describe('price line scan contracts', () => {
  test('reads only columns the sales migration snapshot declares', () => {
    const tables = readSnapshotTables()
    for (const family of Object.values(PRICE_LINE_FAMILIES)) {
      const lines = tables.get(family.lines)
      const documents = tables.get(family.documents)
      expect(lines).toBeDefined()
      expect(documents).toBeDefined()
      for (const column of [...SCANNED_COLUMNS.lines, family.documentKey]) expect(lines?.columns).toHaveProperty(column)
      for (const column of SCANNED_COLUMNS.documents) expect(documents?.columns).toHaveProperty(column)
      expect(lines?.columns.created_at.type).toMatch(/^timestamptz/)
    }
  })

  test('validates cursors', () => {
    expect(isValidPriceLineCursor({ at: '2026-08-01T10:00:00.123456Z', id: randomUUID() })).toBe(true)
    expect(isValidPriceLineCursor({ at: '2026-08-01 10:00:00', id: randomUUID() })).toBe(false)
    expect(isValidPriceLineCursor({ at: '2026-08-01T10:00:00Z', id: '1 or 1=1' })).toBe(false)
  })
})

describeWithPostgres('price line scan against PostgreSQL', () => {
  const schema = `sales_price_lines_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let db: Kysely<unknown>
  const ids: Record<string, string> = {}

  async function createTable(name: string, columns: string[]): Promise<void> {
    const table = readSnapshotTables().get(name) as SnapshotTable
    const definitions = columns.map((column) => {
      const definition = table.columns[column]
      return `"${column}" ${definition.type}${column === 'id' ? ' primary key' : definition.nullable ? ' null' : ''}`
    })
    await sql.raw(`create table "${schema}"."${name}" (${definitions.join(', ')})`).execute(db)
  }

  async function insertDocument(table: string, values: { id?: string; tenantId?: string; organizationId?: string; deleted?: boolean } = {}): Promise<string> {
    const id = values.id ?? randomUUID()
    await sql`insert into ${sql.table(`${schema}.${table}`)} (id, tenant_id, organization_id, deleted_at) values (${id}::uuid, ${values.tenantId ?? TENANT}::uuid, ${values.organizationId ?? ORG}::uuid, ${values.deleted ? new Date() : null})`.execute(db)
    return id
  }

  type LineInput = {
    id?: string
    documentId: string
    tenantId?: string
    organizationId?: string
    createdAt: string
    updatedAt?: string
    metadata?: unknown
    productId?: string | null
    variantId?: string | null
    deleted?: boolean
    uomSnapshot?: unknown
  }

  async function insertLine(family: 'orders' | 'quotes', input: LineInput): Promise<string> {
    const id = input.id ?? randomUUID()
    const tables = PRICE_LINE_FAMILIES[family]
    await sql`
      insert into ${sql.table(`${schema}.${tables.lines}`)}
        (id, ${sql.ref(tables.documentKey)}, tenant_id, organization_id, product_id, product_variant_id, quantity, quantity_unit, normalized_unit,
         uom_snapshot, currency_code, unit_price_net, unit_price_gross, metadata, created_at, updated_at, deleted_at)
      values (${id}::uuid, ${input.documentId}::uuid, ${input.tenantId ?? TENANT}::uuid, ${input.organizationId ?? ORG}::uuid,
        ${input.productId === undefined ? PRODUCT_ID : input.productId}::uuid, ${input.variantId ?? null}::uuid, '2.5000', 'pcs', 'pcs',
        ${input.uomSnapshot === undefined ? null : JSON.stringify(input.uomSnapshot)}::jsonb, 'EUR', '10.0000', '12.3000',
        ${input.metadata === undefined ? JSON.stringify({ priceId: PRICE_ID, priceMode: 'net' }) : JSON.stringify(input.metadata)}::jsonb,
        ${input.createdAt}::timestamptz, ${input.updatedAt ?? input.createdAt}::timestamptz, ${input.deleted ? new Date() : null})
    `.execute(db)
    return id
  }

  function query(overrides: Partial<PriceLinePageQuery> = {}): PriceLinePageQuery {
    return { family: 'orders', tenantId: TENANT, organizationId: ORG, from: FROM, to: TO, priceId: PRICE_ID, after: null, limit: 10, ...overrides }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 2, options: `-c search_path=${schema}` })
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) })
    await sql.raw(`create schema "${schema}"`).execute(db)
    for (const family of Object.values(PRICE_LINE_FAMILIES)) {
      await createTable(family.documents, SCANNED_COLUMNS.documents)
      await createTable(family.lines, [...SCANNED_COLUMNS.lines, family.documentKey])
    }
    const order = await insertDocument('sales_orders')
    const deletedOrder = await insertDocument('sales_orders', { deleted: true })
    const foreignOrder = await insertDocument('sales_orders', { organizationId: OTHER_ORG })
    const otherTenantOrder = await insertDocument('sales_orders', { tenantId: OTHER_TENANT })
    const quote = await insertDocument('sales_quotes')
    ids.order = order
    ids.quote = quote
    ids.first = await insertLine('orders', { id: '66666666-0000-4000-8000-000000000001', documentId: order, createdAt: '2026-08-02T10:00:00.123456Z', updatedAt: '2026-08-03T11:00:00.987654Z', uomSnapshot: { toBaseFactor: '1.000000' } })
    ids.sameTimeA = await insertLine('orders', { id: '66666666-0000-4000-8000-000000000002', documentId: order, createdAt: '2026-08-05T10:00:00.000000Z' })
    ids.sameTimeB = await insertLine('orders', { id: '66666666-0000-4000-8000-000000000003', documentId: order, createdAt: '2026-08-05T10:00:00.000000Z', metadata: { priceId: PRICE_ID.toUpperCase(), priceMode: 'gross' } })
    ids.atFrom = await insertLine('orders', { id: '66666666-0000-4000-8000-000000000004', documentId: order, createdAt: '2026-08-01T00:00:00.000000Z' })
    await insertLine('orders', { documentId: order, createdAt: '2026-09-01T00:00:00.000000Z' })
    await insertLine('orders', { documentId: order, createdAt: '2026-07-31T23:59:59.999999Z' })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-06T10:00:00Z', deleted: true })
    await insertLine('orders', { documentId: deletedOrder, createdAt: '2026-08-06T10:00:00Z' })
    ids.foreignOrder = foreignOrder
    ids.foreignLine = await insertLine('orders', { documentId: foreignOrder, organizationId: OTHER_ORG, createdAt: '2026-08-06T10:00:00Z' })
    await insertLine('orders', { documentId: foreignOrder, createdAt: '2026-08-06T10:00:00Z' })
    ids.otherTenantLine = await insertLine('orders', { documentId: otherTenantOrder, tenantId: OTHER_TENANT, createdAt: '2026-08-06T10:00:00Z' })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-06T10:00:00Z', metadata: { priceId: OTHER_PRICE_ID } })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-07T10:00:00Z', metadata: null })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-07T11:00:00Z', metadata: { priceId: '  ' } })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-07T12:00:00Z', metadata: { priceMode: 'net' } })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-07T13:00:00Z', metadata: {}, productId: null, variantId: VARIANT_ID })
    await insertLine('orders', { documentId: order, createdAt: '2026-08-07T14:00:00Z', metadata: {}, deleted: true })
    ids.quoteLine = await insertLine('quotes', { documentId: quote, createdAt: '2026-08-04T10:00:00Z', metadata: { priceId: PRICE_ID, priceMode: 'gross' } })
  })

  afterAll(async () => {
    if (db) {
      await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db)
      await db.destroy()
    }
  })

  test('reads live lines of live documents of the organization that reference the price row, inside [from, to)', async () => {
    const page = await readPriceLinePage(db, query())
    expect(page.rows.map((row) => row.id)).toEqual([ids.atFrom, ids.first, ids.sameTimeA, ids.sameTimeB])
    expect(page.exhausted).toBe(true)
    expect(page.rows[1]).toEqual({
      id: ids.first,
      documentId: ids.order,
      cursorAt: '2026-08-02T10:00:00.123456Z',
      createdAt: '2026-08-02T10:00:00.123Z',
      updatedAt: '2026-08-03T11:00:00.987Z',
      currencyCode: 'EUR',
      quantity: '2.5000',
      quantityUnit: 'pcs',
      normalizedUnit: 'pcs',
      unitPriceNet: '10.0000',
      unitPriceGross: '12.3000',
      priceMode: 'net',
      uomFactor: '1.000000',
    })
    expect(page.rows[3].priceMode).toBe('gross')
    expect(page.lastCursor).toEqual({ at: '2026-08-05T10:00:00.000000Z', id: ids.sameTimeB })
  })

  test('pages by (created_at, id) across equal creation times without gaps or repeats', async () => {
    const seen: string[] = []
    let after: PriceLinePageQuery['after'] = null
    let exhausted = false
    let pages = 0
    while (!exhausted) {
      const page = await readPriceLinePage(db, query({ after, limit: 1 }))
      seen.push(...page.rows.map((row) => row.id))
      after = page.lastCursor ?? after
      exhausted = page.exhausted
      pages += 1
      expect(pages).toBeLessThan(10)
    }
    expect(seen).toEqual([ids.atFrom, ids.first, ids.sameTimeA, ids.sameTimeB])
    const second = await readPriceLinePage(db, query({ limit: 2 }))
    expect(second.exhausted).toBe(false)
    const rest = await readPriceLinePage(db, query({ limit: 2, after: second.lastCursor }))
    expect(rest.rows.map((row) => row.id)).toEqual([ids.sameTimeA, ids.sameTimeB])
    expect(rest.exhausted).toBe(true)
  })

  test('reads quote lines from the quote tables only, and nothing outside the scope', async () => {
    const quotes = await readPriceLinePage(db, query({ family: 'quotes' }))
    expect(quotes.rows.map((row) => [row.id, row.documentId])).toEqual([[ids.quoteLine, ids.quote]])
    const foreign = await readPriceLinePage(db, query({ organizationId: OTHER_ORG }))
    expect(foreign.rows.map((row) => [row.id, row.documentId])).toEqual([[ids.foreignLine, ids.foreignOrder]])
    expect((await readPriceLinePage(db, query({ tenantId: OTHER_TENANT }))).rows.map((row) => row.id)).toEqual([ids.otherTenantLine])
    expect((await readPriceLinePage(db, query({ priceId: OTHER_PRICE_ID }))).rows).toHaveLength(1)
    expect((await readPriceLinePage(db, query({ from: TO, to: TO }))).rows).toHaveLength(0)
  })

  test('counts lines of the row product (or variant) without a price link, capped', async () => {
    const base = { family: 'orders' as const, tenantId: TENANT, organizationId: ORG, from: FROM, to: TO }
    expect(await countUnlinkedPriceLines(db, { ...base, productId: PRODUCT_ID, variantId: null, cap: 100 })).toBe(3)
    expect(await countUnlinkedPriceLines(db, { ...base, productId: PRODUCT_ID, variantId: null, cap: 2 })).toBe(2)
    expect(await countUnlinkedPriceLines(db, { ...base, productId: PRODUCT_ID, variantId: VARIANT_ID, cap: 100 })).toBe(1)
    expect(await countUnlinkedPriceLines(db, { ...base, productId: null, variantId: null, cap: 100 })).toBe(0)
    expect(await countUnlinkedPriceLines(db, { ...base, family: 'quotes', productId: PRODUCT_ID, variantId: null, cap: 100 })).toBe(0)
    expect(await countUnlinkedPriceLines(db, { ...base, organizationId: OTHER_ORG, productId: PRODUCT_ID, variantId: null, cap: 100 })).toBe(0)
  })

  test('refuses malformed scope, price id and cursor before querying', async () => {
    await expect(readPriceLinePage(db, query({ tenantId: 'x' }))).rejects.toThrow(TypeError)
    await expect(readPriceLinePage(db, query({ priceId: "x' or 1=1 --" }))).rejects.toThrow(TypeError)
    await expect(readPriceLinePage(db, query({ after: { at: 'now()', id: randomUUID() } }))).rejects.toThrow(TypeError)
    await expect(readPriceLinePage(db, query({ family: 'invoices' as never }))).rejects.toThrow(TypeError)
  })
})
