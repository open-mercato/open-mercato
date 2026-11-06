import type { EntityManager } from '@mikro-orm/postgresql'
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql, type RawBuilder } from 'kysely'
import { BasicQueryEngine } from '../engine'
import { normalizeFilters } from '../join-utils'
import { buildNotIlikePredicate, prepareNotIlikeFilters } from '../not-ilike'
import { resolveSearchConfig } from '../../search/config'
import { tokenizeText } from '../../search/tokenize'

const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
  createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
} })
const base = () => database.selectFrom('customers as base').select('base.id')
type Builder = ReturnType<typeof base>
type Internals = {
  buildCfValueExistsExpression: (eb: unknown, options: {
    source: { entityId: string; alias: string; table: string; recordIdExpr: RawBuilder<string> }
    qualify: (column: string) => string; tenantId: string; key: string; op: 'overlap' | 'not_ilike'; value: unknown
  }) => RawBuilder<boolean>
  applyColumnOp: (builder: Builder, column: string, op: string, value: unknown) => Builder
  buildColumnOpExpression: (eb: unknown, column: string, op: string, value: unknown) => RawBuilder<boolean>
  buildIndexDocOpExpression: (eb: unknown, options: {
    entity: string; field: string; op: 'not_ilike'; value: unknown; recordIdColumn: string; tenantId: string; withDeleted: boolean
  }) => RawBuilder<boolean>
}
const engine = new BasicQueryEngine({} as EntityManager, () => database) as unknown as Internals
const config = { ...resolveSearchConfig(), minTokenLength: 3, enablePartials: false }

async function valueFor(pattern: string, encryptedFields: string[] | null, searchEnabled = true, fieldName = 'display_name'): Promise<unknown> {
  const filters = normalizeFilters({ [fieldName]: { $not: { $ilike: pattern } } })
  await prepareNotIlikeFilters(filters, async (field) => ({
    field, entity: 'customers:customer_entity', recordIdColumn: 'base.id', organizationIdColumn: 'base.organization_id', tenantId: 'tenant-1',
    organizationScope: { ids: ['org-1'], includeNull: true }, searchEnabled, searchConfig: config, encryptedFields,
  }))
  return filters[0].value
}

describe('BasicQueryEngine text negation', () => {
  test('binds the plaintext single-character pattern on direct, OR and document paths', async () => {
    const value = await valueFor('%x%', [])
    const direct = engine.applyColumnOp(base(), 'base.display_name', 'not_ilike', value).compile()
    const grouped = base().where((eb) => engine.buildColumnOpExpression(eb, 'base.display_name', 'not_ilike', value)).compile()
    const doc = base().where((eb) => engine.buildIndexDocOpExpression(eb, {
      entity: 'customers:customer_entity', field: 'display_name', op: 'not_ilike', value,
      recordIdColumn: 'base.id', tenantId: 'tenant-1', withDeleted: false,
    })).compile()
    expect(direct.sql).toContain('"base"."display_name" not ilike $2')
    expect(grouped.sql).toEqual(direct.sql)
    expect(doc.sql).toContain('not ilike')
    expect(direct.parameters.at(-1)).toBe('%x%')
    expect(doc.parameters).toContain('%x%')
    expect(direct.sql).not.toContain('coalesce')
  })

  test('never inlines hostile pattern text', async () => {
    const pattern = "%'); drop table customers; --%"
    const value = await valueFor(pattern, [])
    const compiled = engine.applyColumnOp(base(), 'base.display_name', 'not_ilike', value).compile()
    expect(compiled.sql).not.toContain('drop table')
    expect(compiled.parameters.at(-1)).toBe(pattern)
  })

  test('encrypted negation requires scoped field-token presence and negates all matching hashes', async () => {
    const value = await valueFor('%Daniel Harris%', ['displayName'])
    const compiled = engine.applyColumnOp(base(), 'base.display_name', 'not_ilike', value).compile()
    const grouped = base().where((eb) => engine.buildColumnOpExpression(eb, 'base.display_name', 'not_ilike', value)).compile()
    expect(grouped.sql).toBe(compiled.sql)
    expect(compiled.sql).toContain('"base"."display_name" is not null')
    expect(compiled.sql).toMatch(/and exists \(select 1 from search_tokens/)
    expect(compiled.sql).toMatch(/and not exists \(/)
    expect(compiled.sql.match(/organization_id is not distinct from "base"\."organization_id"/g)).toHaveLength(2)
    expect(compiled.sql).toContain('having count(distinct token_hash) >=')
    expect(compiled.sql).not.toContain('not ilike')
    expect(compiled.parameters).toEqual(expect.arrayContaining([
      'customers:customer_entity', 'display_name', 'tenant-1', 'org-1', 2,
      ...tokenizeText('%Daniel Harris%', config).hashes,
    ]))
    expect(compiled.parameters.filter((parameter) => parameter === 'tenant-1')).toHaveLength(2)
    expect(compiled.parameters.filter((parameter) => parameter === 'display_name')).toHaveLength(2)
    expect(compiled.parameters.filter((parameter) => parameter === 'org-1')).toHaveLength(2)
    expect(compiled.sql).toContain('or organization_id is null')
  })

  test.each(['%x%', '%_%', '%!%'])('rejects an unindexable encrypted pattern %s explicitly', async (pattern) => {
    await expect(valueFor(pattern, ['display_name'])).rejects.toThrow(TypeError)
    await expect(valueFor(pattern, ['display_name'])).rejects.toBeInstanceOf(TypeError)
  })

  test('rejects unavailable encrypted token search instead of comparing ciphertext', async () => {
    await expect(valueFor('%Daniel%', ['display_name'], false)).rejects.toThrow(TypeError)
    await expect(valueFor('%x%', null)).rejects.toThrow(TypeError)
  })

  test('plain SQL negation retains SQL-null exclusion', () => {
    const compiled = base().where(buildNotIlikePredicate('base.display_name', '%x%')).compile()
    expect(compiled.sql).toContain('"base"."display_name" not ilike $2')
    expect(compiled.sql).not.toMatch(/is null|coalesce/)
    expect(compiled.sql).toContain('then false else')
    expect(compiled.parameters[0]).toContain(':v1$')
  })
})


test('all-tags custom-field predicates use independent value rows', () => {
  const source = { entityId: 'customers:customer_entity', alias: 'base', table: 'customers', recordIdExpr: sql<string>`${sql.ref('base.id')}::text` }
  const compiled = base().where((eb) => eb.and(['alpha', 'beta'].map((tag) => engine.buildCfValueExistsExpression(eb, {
    source, qualify: (column) => `base.${column}`, tenantId: 'tenant-1', key: 'tags', op: 'overlap', value: [tag],
  })))).compile()
  expect(compiled.sql.match(/exists \(select/g)).toHaveLength(2)
  expect(compiled.sql).toMatch(/"cfev_\d+"\."value_text"/)
  expect(compiled.parameters).toEqual(expect.arrayContaining(['alpha', 'beta', 'tenant-1', 'tags']))
})


test('custom-field plaintext remains literal while ciphertext uses scoped tokens', async () => {
  const value = await valueFor('%Daniel%', [], true, 'cf:secret')
  const compiled = engine.applyColumnOp(base(), 'base.value_text', 'not_ilike', value).compile()
  expect(compiled.sql).toContain('then')
  expect(compiled.sql).toContain('and not exists (')
  expect(compiled.sql).toContain('else "base"."value_text" not ilike')
  expect(compiled.parameters).toContain('cf:secret')
  const short = await valueFor('%x%', [], false, 'cf:secret')
  const shortQuery = engine.applyColumnOp(base(), 'base.value_text', 'not_ilike', short).compile()
  expect(shortQuery.sql).toContain('then false')
  expect(shortQuery.parameters).toContain('%x%')
})

test('custom-field negation checks every value row and requires a present value', async () => {
  const value = await valueFor('%Daniel%', [], true, 'cf:secret')
  const source = { entityId: 'customers:customer_entity', alias: 'base', table: 'customers', recordIdExpr: sql<string>`${sql.ref('base.id')}::text` }
  const compiled = base().where((expression) => engine.buildCfValueExistsExpression(expression, {
    source, qualify: (column) => `base.${column}`, tenantId: 'tenant-1', key: 'secret', op: 'not_ilike', value,
  })).compile()
  expect(compiled.sql).toMatch(/exists \(select[\s\S]*coalesce\(CASE[\s\S]*value_text[\s\S]*is not null/)
  expect(compiled.sql).toContain('and not exists (')
  expect(compiled.sql).toContain('not case when')
  expect(compiled.sql).toContain('and not exists (')
})
