/**
 * Real PostgreSQL proof that cf `ne`/`nin` exclude multi-value rows whose array contains the value,
 * mirroring the containment-aware `eq`/`in`. OM_QUERY_INDEX_PG_URL (or OM_COUNT_CAP_PG_URL) enables
 * the suite; it works in a random private schema and drops it afterwards.
 */
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect, sql, type Expression, type ExpressionBuilder } from 'kysely'
import { Pool } from 'pg'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { FilterOp } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

type DocsDb = { cf_docs: { id: string; doc: unknown } }
type IndexDocSource = { alias: string; entityId: string; recordIdColumn: string }
type HybridInternals = {
  buildCfFilterExpression: (
    eb: ExpressionBuilder<DocsDb, 'ei'>,
    key: string,
    op: FilterOp,
    value: unknown,
    sources: IndexDocSource[],
  ) => Expression<boolean> | null
}

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip
const SCHEMA = `om_test_${crypto.randomBytes(8).toString('hex')}`
const sources: IndexDocSource[] = [{ alias: 'ei', entityId: 'cfcheck:widget', recordIdColumn: 'ei.id' }]

const DOCS: Record<string, unknown> = {
  array_a_b: { 'cf:labels': ['a', 'b'] },
  array_b: { 'cf:labels': ['b'] },
  scalar_a: { 'cf:labels': 'a' },
  scalar_c: { 'cf:labels': 'c' },
  json_null: { 'cf:labels': null },
  absent: {},
}

maybe('HybridQueryEngine.buildCfFilterExpression ne/nin against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let db: Kysely<DocsDb>
  let engine: HybridInternals
  let schemaCreated = false

  beforeAll(async () => {
    db = new Kysely<DocsDb>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: PG_URL, options: `-c search_path=${SCHEMA}`, max: 2 }),
      }),
    })
    await sql`create schema ${sql.id(SCHEMA)}`.execute(db)
    schemaCreated = true
    await sql`create table ${sql.id(SCHEMA, 'cf_docs')} (id text primary key, doc jsonb not null)`.execute(db)
    await db.insertInto('cf_docs')
      .values(Object.entries(DOCS).map(([id, doc]) => ({ id, doc: JSON.stringify(doc) })))
      .execute()
    const em = { getKysely: () => db } as unknown as EntityManager
    engine = new HybridQueryEngine(em, new BasicQueryEngine(em, () => db)) as unknown as HybridInternals
  })

  afterAll(async () => {
    if (schemaCreated) await sql`drop schema ${sql.id(SCHEMA)} cascade`.execute(db)
    await db?.destroy()
  })

  const run = async (op: FilterOp, value: unknown) => {
    const rows = await db
      .selectFrom('cf_docs as ei')
      .select('ei.id')
      .where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', op, value, sources)!)
      .orderBy('ei.id')
      .execute()
    return rows.map((row) => row.id)
  }

  test('ne excludes every row eq matches, arrays included', async () => {
    expect(await run('eq', 'a')).toEqual(['array_a_b', 'scalar_a'])
    expect(await run('ne', 'a')).toEqual(['array_b', 'scalar_c'])
  })

  test('nin excludes every row in matches, arrays included', async () => {
    expect(await run('in', ['a', 'c'])).toEqual(['array_a_b', 'scalar_a', 'scalar_c'])
    expect(await run('nin', ['a', 'c'])).toEqual(['array_b'])
  })

  test('ne null still means the field is set', async () => {
    expect(await run('ne', null)).toEqual(['array_a_b', 'array_b', 'scalar_a', 'scalar_c'])
  })

  test('an empty nin excludes nothing but unset fields', async () => {
    expect(await run('nin', [])).toEqual(['array_a_b', 'array_b', 'scalar_a', 'scalar_c'])
  })
})
