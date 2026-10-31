import type { EntityManager } from '@mikro-orm/postgresql'
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type RawBuilder } from 'kysely'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { normalizeFilters } from '@open-mercato/shared/lib/query/join-utils'
import { prepareNotIlikeFilters } from '@open-mercato/shared/lib/query/not-ilike'
import { prepareOverlapFilters } from '@open-mercato/shared/lib/query/overlap'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { HybridQueryEngine } from '../lib/engine'

const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
  createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
} })
const base = () => database.selectFrom('customers as base').leftJoin('entity_indexes as ei', 'ei.entity_id', 'base.id').select('base.id')
type Builder = ReturnType<typeof base>
type HybridInternals = {
  applyColumnFilter: (builder: Builder, column: string, filter: { field: string; op: 'not_ilike' | 'overlap'; value: unknown }) => Builder
  buildColumnFilterExpression: (eb: unknown, column: string, op: 'not_ilike' | 'overlap', value: unknown) => RawBuilder<boolean>
  applyIndexDocFilterFromAlias: (builder: Builder, alias: string, entity: string, field: string, op: 'not_ilike', value: unknown, idColumn: string) => Builder
  buildIndexDocFilterExpression: (eb: unknown, alias: string, entity: string, field: string, op: 'not_ilike', value: unknown, idColumn: string) => RawBuilder<boolean>
  applyCfFilterFromAlias: (builder: Builder, alias: string, entity: string, field: string, op: 'not_ilike', value: unknown) => Builder
  buildCfFilterExpression: (eb: unknown, field: string, op: 'not_ilike', value: unknown, sources: Array<{ alias: string; entityId: string; recordIdColumn: string }>) => RawBuilder<boolean>
}
const em = { getKysely: () => database } as unknown as EntityManager
const basic = new BasicQueryEngine(em, () => database)
const hybrid = new HybridQueryEngine(em, basic) as unknown as HybridInternals
const entity = 'customers:customer_entity'

describe('HybridQueryEngine negation parity', () => {
  test.each([{ encryptedFields: [] }, { encryptedFields: ['display_name'] }])('preserves scoped predicates across base, doc and custom-field paths with map $encryptedFields', async ({ encryptedFields }) => {
    const filters = normalizeFilters({ display_name: { $not: { $ilike: '%Daniel Harris%' } } })
    await prepareNotIlikeFilters(filters, async (field) => ({
      entity, field, recordIdColumn: 'base.id', organizationIdColumn: 'base.organization_id', tenantId: 'tenant-1', organizationScope: { ids: ['org-1'], includeNull: false },
      searchEnabled: true, searchConfig: { ...resolveSearchConfig(), minTokenLength: 3, enablePartials: false }, encryptedFields,
    }))
    const value = filters[0].value
    const compiled = [
      hybrid.applyColumnFilter(base(), 'base.display_name', filters[0] as { field: string; op: 'not_ilike'; value: unknown }).compile(),
      base().where((eb) => hybrid.buildColumnFilterExpression(eb, 'base.display_name', 'not_ilike', value)).compile(),
      hybrid.applyIndexDocFilterFromAlias(base(), 'ei', entity, 'display_name', 'not_ilike', value, 'base.id').compile(),
      base().where((eb) => hybrid.buildIndexDocFilterExpression(eb, 'ei', entity, 'display_name', 'not_ilike', value, 'base.id')).compile(),
      hybrid.applyCfFilterFromAlias(base(), 'ei', entity, 'display_name', 'not_ilike', value).compile(),
      base().where((eb) => hybrid.buildCfFilterExpression(eb, 'display_name', 'not_ilike', value, [{ alias: 'ei', entityId: entity, recordIdColumn: 'base.id' }])).compile(),
    ]
    for (const [pathIndex, query] of compiled.entries()) {
      if (encryptedFields.length) {
        expect(query.sql).toContain('and not exists (')
        expect(query.sql).toContain('and exists (select 1 from search_tokens')
        expect(query.sql).not.toContain('not ilike')
        const scopeAlias = pathIndex === 5 ? 'ei' : 'base'
        expect(query.sql.split(`organization_id is not distinct from "${scopeAlias}"."organization_id"`).length - 1).toBe(2)
        expect(query.parameters).toEqual(expect.arrayContaining(['tenant-1', 'org-1', 'display_name', 2]))
      } else {
        expect(query.sql).toContain('not ilike')
        expect(query.parameters).toContain('%Daniel Harris%')
      }
    }
  })

  test('uses JSONB membership for staff roles on both direct and OR column paths', async () => {
    const filters = normalizeFilters({ role_ids: { $overlap: ['role-1'] } })
    await prepareOverlapFilters(filters, async () => 'jsonb')
    const direct = hybrid.applyColumnFilter(base(), 'base.role_ids', filters[0] as { field: string; op: 'overlap'; value: unknown }).compile()
    const grouped = base().where((eb) => hybrid.buildColumnFilterExpression(eb, 'base.role_ids', 'overlap', filters[0].value)).compile()
    expect(direct.sql).toContain('"base"."role_ids" ?| $1::text[]')
    expect(grouped.sql).toEqual(direct.sql)
    expect(direct.parameters).toEqual([['role-1']])
  })
})
