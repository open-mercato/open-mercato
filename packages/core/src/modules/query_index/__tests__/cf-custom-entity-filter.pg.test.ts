/**
 * Real PostgreSQL proof for #10167: custom-entity cf filters match multi-value fields by element
 * whether the document stores them under the bare key or the `cf:` key, and `ne`/`nin` are the
 * negation of `eq`/`in`. OM_QUERY_INDEX_PG_URL (or OM_COUNT_CAP_PG_URL) enables the suite; it works
 * in a random private schema and drops it afterwards. Example:
 *   docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=t postgres:17
 *   cd packages/core && OM_QUERY_INDEX_PG_URL=postgres://postgres:t@localhost:54329/postgres yarn jest cf-custom-entity-filter.pg
 */
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { FilterOp, Where } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

type StorageDb = {
  custom_entities_storage: {
    entity_type: string
    entity_id: string
    organization_id: string
    tenant_id: string
    deleted_at: Date | null
    doc: string
  }
}

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip
const SCHEMA = `om_test_${crypto.randomBytes(8).toString('hex')}`
const TENANT = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION = '22222222-2222-4222-8222-222222222222'
const ENTITY = 'user:cf_filter_check'

const DOCS: Record<string, unknown> = {
  absent: {},
  bare_array_a_b: { labels: ['a', 'b'] },
  bare_array_b: { labels: ['b'] },
  bare_empty: { labels: [] },
  bare_null: { labels: null },
  bare_numeric_5_6: { labels: [5, 6] },
  bare_scalar_a: { labels: 'a' },
  bare_scalar_c: { labels: 'c' },
  both_keys_prefixed_a: { 'cf:labels': ['a'], labels: ['b'] },
  prefixed_array_a_b: { 'cf:labels': ['a', 'b'] },
  prefixed_scalar_c: { 'cf:labels': 'c' },
}
const SET_IDS = Object.keys(DOCS).filter((id) => id !== 'absent' && id !== 'bare_null')

maybe('HybridQueryEngine custom-entity cf filters against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let db: Kysely<StorageDb>
  let engine: HybridQueryEngine
  let schemaCreated = false

  beforeAll(async () => {
    db = new Kysely<StorageDb>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: PG_URL, options: `-c search_path=${SCHEMA}`, max: 2 }),
      }),
    })
    await sql`create schema ${sql.id(SCHEMA)}`.execute(db)
    schemaCreated = true
    await sql`create table ${sql.id(SCHEMA, 'custom_entities_storage')} (
      entity_type text not null, entity_id text not null, organization_id uuid, tenant_id uuid,
      deleted_at timestamptz, doc jsonb not null
    )`.execute(db)
    await db.insertInto('custom_entities_storage').values(Object.entries(DOCS).map(([id, doc]) => ({
      entity_type: ENTITY,
      entity_id: id,
      organization_id: ORGANIZATION,
      tenant_id: TENANT,
      deleted_at: null,
      doc: JSON.stringify(doc),
    }))).execute()
    const em = { getKysely: () => db } as unknown as EntityManager
    engine = new HybridQueryEngine(em, new BasicQueryEngine(em, () => db))
  })

  afterAll(async () => {
    if (schemaCreated) await sql`drop schema ${sql.id(SCHEMA)} cascade`.execute(db)
    await db?.destroy()
  })

  const run = async (filters: Where) => {
    const result = await engine.query(ENTITY, {
      forceCustomEntityStorage: true,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      fields: ['id'],
      filters,
      page: { page: 1, pageSize: 100 },
    })
    expect(result.total).toBe(result.items.length)
    return result.items.map((row) => String((row as { id: unknown }).id)).sort()
  }
  const runOp = (op: FilterOp, value: unknown) => run({ 'cf:labels': { [`$${op}`]: value } } as Where)

  test('eq matches an element of a bare-key or cf:-key array', async () => {
    expect(await runOp('eq', 'a')).toEqual([
      'bare_array_a_b', 'bare_scalar_a', 'both_keys_prefixed_a', 'prefixed_array_a_b',
    ])
  })

  test('in matches an element of a bare-key or cf:-key array', async () => {
    expect(await runOp('in', ['a', 'c'])).toEqual([
      'bare_array_a_b', 'bare_scalar_a', 'bare_scalar_c', 'both_keys_prefixed_a', 'prefixed_array_a_b', 'prefixed_scalar_c',
    ])
  })

  test('overlap matches an element of a bare-key or cf:-key array', async () => {
    expect(await runOp('overlap', ['a'])).toEqual([
      'bare_array_a_b', 'bare_scalar_a', 'both_keys_prefixed_a', 'prefixed_array_a_b',
    ])
  })

  test('ne returns exactly the set rows eq does not', async () => {
    const matched = await runOp('eq', 'a')
    const excluded = await runOp('ne', 'a')
    expect(excluded).toEqual(['bare_array_b', 'bare_empty', 'bare_numeric_5_6', 'bare_scalar_c', 'prefixed_scalar_c'])
    expect([...matched, ...excluded].sort()).toEqual(SET_IDS)
  })

  test('nin returns exactly the set rows in does not', async () => {
    const matched = await runOp('in', ['a', 'c'])
    const excluded = await runOp('nin', ['a', 'c'])
    expect(excluded).toEqual(['bare_array_b', 'bare_empty', 'bare_numeric_5_6'])
    expect([...matched, ...excluded].sort()).toEqual(SET_IDS)
  })

  test('a number value matches an element of a numeric array', async () => {
    expect(await runOp('eq', 5)).toEqual(['bare_numeric_5_6'])
    expect(await runOp('ne', 5)).toEqual(SET_IDS.filter((id) => id !== 'bare_numeric_5_6'))
  })

  test('the cf: key wins when a document holds both keys', async () => {
    expect(await runOp('eq', 'b')).toEqual(['bare_array_a_b', 'bare_array_b', 'prefixed_array_a_b'])
    expect(await runOp('ne', 'b')).toContain('both_keys_prefixed_a')
  })

  test('null comparisons still test whether the field is set', async () => {
    expect(await runOp('eq', null)).toEqual(['absent', 'bare_null'])
    expect(await runOp('ne', null)).toEqual(SET_IDS)
  })

  test('empty lists keep matching nothing for in and everything for nin', async () => {
    expect(await runOp('in', [])).toEqual([])
    expect(await runOp('nin', [])).toEqual(Object.keys(DOCS))
  })

  test.each<[FilterOp, unknown]>([
    ['eq', 'a'], ['in', ['a', 'c']], ['overlap', ['a']], ['ne', 'a'], ['nin', ['a', 'c']],
  ])('%s selects the same rows in an $or group as at the top level', async (op, value) => {
    const grouped = await run({ $or: [{ 'cf:labels': { [`$${op}`]: value } }, { id: 'no_such_record' }] } as Where)
    expect(grouped).toEqual(await runOp(op, value))
  })
})
