import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

const recordedQueries: CompiledQuery[] = []

function createRecordingKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (compiledQuery: CompiledQuery) => {
    recordedQueries.push(compiledQuery)
    return { rows: [] }
  }
  return db
}

const fakeEm = {
  fork() {
    return {
      getKysely: () => createRecordingKysely(),
    }
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return fakeEm
      return undefined
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    tenantId,
    orgId,
    sub: null,
    isApiKey: true,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ filterIds: [orgId], selectedId: orgId }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/shared/lib/crud/enricher-runner', () => ({
  applyResponseEnrichers: async (items: unknown[]) => ({ items }),
}))

import { GET, listSchema } from '../route'

const rowsQuery = () =>
  recordedQueries.find((entry) => entry.sql.includes('customer_interactions'))

beforeEach(() => {
  recordedQueries.length = 0
})

describe('interactions list — search escaping and date validation (#2734)', () => {
  test('listSchema rejects an unparseable from/to date with a validation error', () => {
    expect(() => listSchema.parse({ from: 'not-a-date' })).toThrow()
    expect(() => listSchema.parse({ to: 'also-not-a-date' })).toThrow()
  })

  test('listSchema coerces valid ISO date strings into Date instances', () => {
    const parsed = listSchema.parse({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01' })
    expect(parsed.from).toBeInstanceOf(Date)
    expect(parsed.to).toBeInstanceOf(Date)
  })

  test('listSchema accepts the opt-in recurring-master filter', () => {
    expect(listSchema.parse({ recurrenceMasters: 'true' }).recurrenceMasters).toBe('true')
    expect(() => listSchema.parse({ recurrenceMasters: 'yes' })).toThrow()
  })

  test('an unparseable from date yields a clean 400 instead of a 500', async () => {
    const res = await GET(new Request('https://example.test/api/customers/interactions?from=not-a-date'))
    expect(res.status).toBe(400)
  })

  test('search wildcards are escaped before being wrapped in the ILIKE pattern', async () => {
    const res = await GET(new Request('https://example.test/api/customers/interactions?search=' + encodeURIComponent('50%_off')))
    expect(res.status).toBe(200)
    const compiled = rowsQuery()
    expect(compiled).toBeDefined()
    expect(compiled!.sql.toLowerCase()).toContain('ilike')
    expect(compiled!.parameters).toContain('%50\\%\\_off%')
    expect(compiled!.parameters).not.toContain('%50%_off%')
  })

  test('list projection includes external_message_id for email interaction links', async () => {
    const res = await GET(new Request('https://example.test/api/customers/interactions?interactionType=email'))
    expect(res.status).toBe(200)
    const compiled = rowsQuery()
    expect(compiled).toBeDefined()
    expect(compiled!.sql).toContain('"external_message_id"')
  })

  test('valid from/to filters bind Date parameters on the occurred/scheduled/created range', async () => {
    const res = await GET(
      new Request(
        'https://example.test/api/customers/interactions?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z',
      ),
    )
    expect(res.status).toBe(200)
    const compiled = rowsQuery()
    expect(compiled).toBeDefined()
    const dateParams = compiled!.parameters.filter((value): value is Date => value instanceof Date)
    expect(dateParams.length).toBeGreaterThanOrEqual(2)
  })

  test('recurring-master reads use the effective date when scheduledAt is nullable', async () => {
    const from = new Date('2026-02-01T00:00:00.000Z')
    const to = new Date('2026-02-08T23:59:59.999Z')
    const res = await GET(
      new Request(
        `https://example.test/api/customers/interactions?recurrenceMasters=true&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    )
    expect(res.status).toBe(200)
    const compiled = rowsQuery()
    expect(compiled).toBeDefined()
    const normalizedSql = compiled!.sql.toLowerCase()
    expect(normalizedSql).toContain('"recurrence_rule" is not null')
    expect(normalizedSql).toContain('recurrence_end is null or recurrence_end >=')
    expect(normalizedSql).toContain('coalesce(occurred_at, scheduled_at, created_at) <=')
    expect(normalizedSql).not.toContain('"scheduled_at" <=')
    expect(normalizedSql).not.toContain('coalesce(occurred_at, scheduled_at, created_at) >=')
    expect(compiled!.parameters).toEqual(expect.arrayContaining([from, to]))
  })
})
