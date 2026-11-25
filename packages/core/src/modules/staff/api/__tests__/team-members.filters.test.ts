import { normalizeFilters } from '@open-mercato/shared/lib/query/join-utils'
import { prepareOverlapFilters, buildArrayColumnOverlapPredicate } from '@open-mercato/shared/lib/query/overlap'
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'

type CrudOptions = { list: { buildFilters: (query: Record<string, unknown>) => Promise<Record<string, unknown>> } }
let captured: CrudOptions
jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: CrudOptions) => {
    captured = options
    return { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))

beforeAll(async () => { await import('../team-members') })

test('roleId emits a supported singleton overlap that compiles for the real JSONB storage type', async () => {
  const roleId = '11111111-1111-4111-8111-111111111111'
  const filters = normalizeFilters(await captured.list.buildFilters({ roleId }))
  expect(filters).toEqual([{ field: 'role_ids', op: 'overlap', value: [roleId] }])
  await prepareOverlapFilters(filters, async () => 'jsonb')
  const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
  } })
  const compiled = database.selectFrom('staff_team_members').select('id')
    .where(buildArrayColumnOverlapPredicate('role_ids', filters[0].value)).compile()
  expect(compiled.sql).toContain('"role_ids" ?| $1::text[]')
  expect(compiled.sql).not.toContain('&&')
  expect(compiled.parameters).toEqual([[roleId]])
})

test('omitting roleId leaves the optional role filter absent', async () => {
  expect(await captured.list.buildFilters({})).toEqual({})
})
