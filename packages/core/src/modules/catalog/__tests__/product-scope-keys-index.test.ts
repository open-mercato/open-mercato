import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type SelectQueryBuilder,
} from 'kysely'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { FilterOp } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '@open-mercato/core/modules/query_index/lib/engine'
import { PRODUCT_SCOPE_KEYS_DOC_KEY, PRODUCT_SCOPE_KEYS_ENTITY_TYPE } from '../lib/productScopeKeys'

const INDEX_NAME = 'entity_indexes_catalog_product_scope_keys_gin_idx'
const queryIndexMigrationsDir = join(__dirname, '..', '..', 'query_index', 'migrations')

type Builder = SelectQueryBuilder<any, any, any>
type HybridInternals = {
  applyIndexDocFilterFromAlias: (q: Builder, alias: string, entityType: string, key: string, op: FilterOp, value: unknown, recordIdColumn: string) => Builder
}

function makeCompilingDb(): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

function readScopeKeysMigration(): string {
  const matches = readdirSync(queryIndexMigrationsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(queryIndexMigrationsDir, file), 'utf8'))
    .filter((source) => source.includes(`create index concurrently "${INDEX_NAME}"`))
  expect(matches).toHaveLength(1)
  return matches[0]
}

function engineIndexedExpression(): string {
  const db = makeCompilingDb()
  const em = { getKysely: () => db } as unknown as EntityManager
  const engine = new HybridQueryEngine(em, new BasicQueryEngine(em, () => db)) as unknown as HybridInternals
  const base = db
    .selectFrom('catalog_products as b')
    .leftJoin('entity_indexes as ei', 'ei.entity_id', 'b.id')
    .select('b.id')
  const compiled = engine
    .applyIndexDocFilterFromAlias(base, 'ei', PRODUCT_SCOPE_KEYS_ENTITY_TYPE, PRODUCT_SCOPE_KEYS_DOC_KEY, 'overlap', ['cat:1'], 'b.id')
    .compile()
  const match = /\("ei"\."doc" -> '[^']+'\)(?= \?\| \$\d+::text\[\])/.exec(compiled.sql)
  expect(match).not.toBeNull()
  return match![0].replace('"ei".', '')
}

describe('scope_keys GIN expression index', () => {
  it('indexes exactly the expression the query engine emits for an overlap filter, with the default ?|-capable opclass', () => {
    const expression = engineIndexedExpression()
    expect(expression).toBe(`("doc" -> '${PRODUCT_SCOPE_KEYS_DOC_KEY}')`)
    expect(readScopeKeysMigration()).toContain(
      `create index concurrently "${INDEX_NAME}" on "entity_indexes" using gin (${expression}) where "entity_type" = '${PRODUCT_SCOPE_KEYS_ENTITY_TYPE}';`,
    )
  })

  it('builds concurrently outside a transaction and drops a stale stub first', () => {
    const source = readScopeKeysMigration()
    expect(source).toMatch(/isTransactional\(\): boolean \{\s*return false;/)
    const dropAt = source.indexOf(`drop index concurrently if exists "${INDEX_NAME}"`)
    const createAt = source.indexOf(`create index concurrently "${INDEX_NAME}"`)
    expect(dropAt).toBeGreaterThanOrEqual(0)
    expect(dropAt).toBeLessThan(createAt)
  })
})
