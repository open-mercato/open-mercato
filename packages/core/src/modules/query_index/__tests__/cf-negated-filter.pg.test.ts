/**
 * Real PostgreSQL proof that cf `ne`/`nin` exclude multi-value rows whose array contains the value,
 * mirroring the containment-aware `eq`/`in`. OM_QUERY_INDEX_PG_URL (or OM_COUNT_CAP_PG_URL) enables
 * the suite; it works in a random private schema and drops it afterwards.
 */
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect, sql, type Expression, type ExpressionBuilder, type SelectQueryBuilder } from 'kysely'
import { Pool } from 'pg'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { FilterOp } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

type DocsDb = { cf_docs: { id: string; doc: unknown } }
type Builder = SelectQueryBuilder<DocsDb, 'ei', { id: string }>
type IndexDocSource = { alias: string; entityId: string; recordIdColumn: string }
type HybridInternals = {
  buildCfFilterExpression: (
    eb: ExpressionBuilder<DocsDb, 'ei'>,
    key: string,
    op: FilterOp,
    value: unknown,
    sources: IndexDocSource[],
  ) => Expression<boolean> | null
  applyCfFilterFromAlias: (q: Builder, alias: string, entityType: string, key: string, op: FilterOp, value: unknown) => Builder
}

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip
const ENTITY = 'cfcheck:widget'
const SCHEMA = `om_test_${crypto.randomBytes(8).toString('hex')}`
const sources: IndexDocSource[] = [{ alias: 'ei', entityId: ENTITY, recordIdColumn: 'ei.id' }]

const DOCS: Record<string, unknown> = {
  array_a_b: { 'cf:labels': ['a', 'b'] },
  array_b: { 'cf:labels': ['b'] },
  bare_array_a_b: { labels: ['a', 'b'] },
  bare_scalar_c: { labels: 'c' },
  scalar_a: { 'cf:labels': 'a' },
  scalar_c: { 'cf:labels': 'c' },
  json_null: { 'cf:labels': null },
  absent: {},
}

maybe('HybridQueryEngine cf ne/nin against PostgreSQL', () => {
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

  const base = (): Builder => db.selectFrom('cf_docs as ei').select('ei.id').orderBy('ei.id')
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id)
  const viaExpression = async (op: FilterOp, value: unknown) =>
    ids(await base().where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', op, value, sources)!).execute())
  const viaAlias = async (op: FilterOp, value: unknown) =>
    ids(await engine.applyCfFilterFromAlias(base(), 'ei', ENTITY, 'cf:labels', op, value).execute())

  test.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s: ne excludes every row eq matches, arrays included', async (_name, run) => {
    expect(await run('eq', 'a')).toEqual(['array_a_b', 'bare_array_a_b', 'scalar_a'])
    expect(await run('ne', 'a')).toEqual(['array_b', 'bare_scalar_c', 'scalar_c'])
  })

  test.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s: nin excludes every row in matches, arrays included', async (_name, run) => {
    expect(await run('in', ['a', 'c'])).toEqual(['array_a_b', 'bare_array_a_b', 'bare_scalar_c', 'scalar_a', 'scalar_c'])
    expect(await run('nin', ['a', 'c'])).toEqual(['array_b'])
  })

  test.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s: ne null still means the field is set', async (_name, run) => {
    expect(await run('ne', null)).toEqual(['array_a_b', 'array_b', 'bare_array_a_b', 'bare_scalar_c', 'scalar_a', 'scalar_c'])
  })

  test.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s: an empty nin excludes nothing but unset fields', async (_name, run) => {
    expect(await run('nin', [])).toEqual(['array_a_b', 'array_b', 'bare_array_a_b', 'bare_scalar_c', 'scalar_a', 'scalar_c'])
  })
})
