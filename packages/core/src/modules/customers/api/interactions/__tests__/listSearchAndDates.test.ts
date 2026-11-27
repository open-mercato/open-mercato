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
const secondOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const resolveScope = jest.fn((): { filterIds: string[]; selectedId: string | null } => ({
  filterIds: [orgId],
  selectedId: orgId,
}))
const hasRequiredFeatures = jest.fn(async () => true)

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
      if (token === 'rbacService') return { userHasAllFeatures: hasRequiredFeatures }
      return undefined
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    tenantId,
    orgId,
    sub: 'api_key:test',
    isApiKey: true,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => resolveScope(),
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
  resolveScope.mockReturnValue({ filterIds: [orgId], selectedId: orgId })
  hasRequiredFeatures.mockReset().mockResolvedValue(true)
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

  test('activityDate orders by when a row happened or is planned, so open activities are not pushed to the last page', async () => {
    const res = await GET(new Request('https://example.test/api/customers/interactions?sortField=activityDate&sortDir=desc'))
    expect(res.status).toBe(200)
    const compiled = rowsQuery()
    expect(compiled).toBeDefined()
    expect(compiled!.sql).toMatch(/order by coalesce\(coalesce\(occurred_at, scheduled_at\), timestamp with time zone '0001-01-01T00:00:00.000Z'\) desc, "id" desc/i)
  })

  test('occurredAt keeps ordering by the occurrence date alone', async () => {
    const res = await GET(new Request('https://example.test/api/customers/interactions?sortField=occurredAt&sortDir=desc'))
    expect(res.status).toBe(200)
    expect(rowsQuery()!.sql).toMatch(/order by coalesce\(occurred_at, timestamp with time zone '0001-01-01T00:00:00.000Z'\) desc/i)
  })

  test('excludeStatus leaves out each listed status and ignores empty entries', async () => {
    const res = await GET(new Request('https://example.test/api/customers/interactions?excludeStatus=done,%20canceled,,completed'))
    expect(res.status).toBe(200)
    const compiled = rowsQuery()
    expect(compiled!.sql.toLowerCase()).toContain('"status" not in')
    expect(compiled!.parameters).toEqual(expect.arrayContaining(['done', 'canceled', 'completed']))
    expect(compiled!.parameters).not.toContain('')
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

describe('interaction appointment filters', () => {
  const from = new Date('2026-03-29T20:00:00Z')
  const to = new Date('2026-03-29T22:00:00Z')

  test.each([
    { overlap: 'true' },
    { overlap: 'true', from: from.toISOString() },
    { overlap: 'true', from: from.toISOString(), to: from.toISOString() },
    { overlap: 'true', from: to.toISOString(), to: from.toISOString() },
    { overlap: 'yes', from: from.toISOString(), to: to.toISOString() },
    { overlapTimezone: 'not/a/timezone' },
    { actorUserId: 'invalid' },
    { organizationId: 'invalid' },
  ])('returns 400 before querying for invalid inputs %p', async (query) => {
    const params = new URLSearchParams(Object.entries(query) as [string, string][])
    const response = await GET(new Request(`https://example.test/api/customers/interactions?${params}`))
    expect(response.status).toBe(400)
    expect(rowsQuery()).toBeUndefined()
  })

  test('applies exact organization and owner-or-attendee predicates to a paged overlap read', async () => {
    resolveScope.mockReturnValue({ filterIds: [orgId, secondOrgId], selectedId: orgId })
    const params = new URLSearchParams({
      actorUserId: actorUserId.toUpperCase(),
      organizationId: secondOrgId.toUpperCase(),
      overlap: 'true',
      overlapTimezone: 'Europe/Warsaw',
      from: from.toISOString(),
      to: to.toISOString(),
      limit: '1',
    })
    const response = await GET(new Request(`https://example.test/api/customers/interactions?${params}`))
    expect(response.status).toBe(200)
    const compiled = rowsQuery()!
    expect(compiled.sql).toMatch(/and \(owner_user_id = \$\d+ or exists \(/)
    expect(compiled.sql).toMatch(/where lower\(attendee ->> 'userId'\) = \$\d+/)
    expect(compiled.sql).toMatch(/coalesce\(occurred_at, scheduled_at\) < \$\d+/)
    expect(compiled.sql).toMatch(/make_interval\(mins => coalesce\(duration_minutes, 30\)\) > \$\d+/)
    expect(compiled.sql).toMatch(/local_day \+ interval '1 day'/)
    expect(compiled.sql).toMatch(/least\(default_start/)
    expect(compiled.sql).toMatch(/least\(default_end/)
    expect(compiled.sql).toMatch(/occurred_at is null and scheduled_at < /)
    expect(compiled.parameters).toEqual(expect.arrayContaining([tenantId, secondOrgId, actorUserId, from, to, 'Europe/Warsaw', 2]))
    expect(compiled.parameters).not.toContain(orgId)
    expect(hasRequiredFeatures).toHaveBeenCalledWith('api_key:test', ['customers.interactions.view'], {
      tenantId, organizationId: secondOrgId,
    })
  })

  test('rejects an organization outside the existing read scope before querying interactions', async () => {
    const response = await GET(new Request(`https://example.test/api/customers/interactions?organizationId=${secondOrgId}`))
    expect(response.status).toBe(403)
    expect(rowsQuery()).toBeUndefined()
    expect(hasRequiredFeatures).not.toHaveBeenCalled()
  })

  test('requires the read feature in the requested organization before querying interactions', async () => {
    resolveScope.mockReturnValue({ filterIds: [orgId, secondOrgId], selectedId: null })
    hasRequiredFeatures.mockResolvedValue(false)
    const response = await GET(new Request(`https://example.test/api/customers/interactions?organizationId=${secondOrgId}`))
    expect(response.status).toBe(403)
    expect(rowsQuery()).toBeUndefined()
  })

  test('keeps earlier recurring masters as candidates for client occurrence expansion', async () => {
    const params = new URLSearchParams({
      actorUserId,
      overlap: 'true',
      recurrenceMasters: 'true',
      from: from.toISOString(),
      to: to.toISOString(),
    })
    const response = await GET(new Request(`https://example.test/api/customers/interactions?${params}`))
    expect(response.status).toBe(200)
    const compiled = rowsQuery()!
    expect(compiled.sql).toContain('"recurrence_rule" is not null')
    expect(compiled.sql).toContain('recurrence_end is null or recurrence_end +')
    expect(compiled.sql).toMatch(/coalesce\(occurred_at, scheduled_at\) < \$\d+/)
    expect(compiled.sql).not.toMatch(/coalesce\(occurred_at, scheduled_at\) >=/)
    expect(compiled.parameters).toEqual(expect.arrayContaining([actorUserId, from, to]))
  })
})

describe('interaction disjunction isolation (#8883)', () => {
  test('groups search and recurrence branches on every list query', async () => {
    const entityId = '33333333-3333-4333-8333-333333333333'
    const response = await GET(new Request(
      `https://example.test/api/customers/interactions?entityId=${entityId}&search=needle&recurrenceMasters=true&from=2026-02-01&to=2026-02-08&limit=1`,
    ))
    expect(response.status).toBe(200)
    const queries = recordedQueries.filter((entry) => entry.sql.includes('customer_interactions'))
    expect(queries.length).toBeGreaterThan(0)
    for (const compiled of queries) {
      expect(compiled.sql).toMatch(/and \(coalesce\(title, ''\) ilike \$\d+ or coalesce\(body, ''\) ilike \$\d+\)/)
      expect(compiled.sql).toMatch(/and \(recurrence_end is null or recurrence_end >= \$\d+\)/)
      expect(compiled.sql).toContain('"deleted_at" is null')
      expect(compiled.sql).toContain('"tenant_id" =')
      expect(compiled.sql).toContain('"organization_id" in')
      expect(compiled.sql).toContain('"entity_id" =')
      expect(compiled.parameters).toEqual(expect.arrayContaining([tenantId, orgId, entityId]))
    }
  })
})
