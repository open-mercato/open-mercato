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

const mockGetEncryptedFieldNames = jest.fn(async () => ['title'])
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => ({
    isEnabled: () => true,
    getEncryptedFieldNames: (...args: unknown[]) => mockGetEncryptedFieldNames(...args),
    decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
  }),
}))

import { GET } from '../route'

const interactionQueries = () => recordedQueries.filter((entry) => entry.sql.includes('customer_interactions'))

beforeEach(() => {
  recordedQueries.length = 0
  mockGetEncryptedFieldNames.mockClear()
  mockGetEncryptedFieldNames.mockImplementation(async () => ['title'])
})

function makeRequest(qs: string) {
  return new Request(`http://localhost/api/customers/interactions?${qs}`)
}

describe('interactions list — encrypted-sort branch routing (#3386)', () => {
  test('sorting by an encrypted field (title) takes the bounded candidate-scan path, not the SQL ORDER BY/keyset path', async () => {
    const res = await GET(makeRequest('sortField=title'))
    expect(res.status).toBe(200)

    const queries = interactionQueries()
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.some((q) => /order by/i.test(q.sql))).toBe(false)
  })

  test('sorting by a non-encrypted field (status) keeps the SQL ORDER BY/keyset path', async () => {
    mockGetEncryptedFieldNames.mockResolvedValueOnce([])
    const res = await GET(makeRequest('sortField=status'))
    expect(res.status).toBe(200)

    const queries = interactionQueries()
    expect(queries.some((q) => /order by/i.test(q.sql))).toBe(true)
  })
})

const SCOPED_SEARCH_QUERY = 'search=needle&recurrenceMasters=true&from=2026-02-01&entityId=33333333-3333-4333-8333-333333333333'
const GROUPED_SEARCH_PREDICATE = /and \(coalesce\(title, ''\) ilike \$\d+ or coalesce\(body, ''\) ilike \$\d+\)/
const GROUPED_RECURRENCE_PREDICATE = /and \(recurrence_end is null or recurrence_end >= \$\d+\)/

test('encrypted candidate scans retain grouped recurrence and search predicates while title and body are plaintext (#8883)', async () => {
  mockGetEncryptedFieldNames.mockImplementation(async () => ['status'])
  const response = await GET(makeRequest(`sortField=status&${SCOPED_SEARCH_QUERY}`))
  expect(response.status).toBe(200)
  const queries = interactionQueries()
  expect(queries.length).toBeGreaterThan(0)
  for (const compiled of queries) {
    expect(compiled.sql).toMatch(GROUPED_SEARCH_PREDICATE)
    expect(compiled.sql).toMatch(GROUPED_RECURRENCE_PREDICATE)
    expect(compiled.parameters).toEqual(expect.arrayContaining([tenantId, orgId, '33333333-3333-4333-8333-333333333333']))
  }
})

test('encrypted title search leaves the ciphertext ILIKE out of the scoped candidate scan and keeps the grouped recurrence predicate (#8883, #7494)', async () => {
  const response = await GET(makeRequest(`sortField=title&${SCOPED_SEARCH_QUERY}`))
  expect(response.status).toBe(200)
  const queries = interactionQueries()
  expect(queries.length).toBeGreaterThan(0)
  for (const compiled of queries) {
    expect(compiled.sql).not.toMatch(/ilike/i)
    expect(compiled.parameters).not.toContain('%needle%')
    expect(compiled.sql).toMatch(GROUPED_RECURRENCE_PREDICATE)
    expect(compiled.parameters).toEqual(expect.arrayContaining([tenantId, orgId, '33333333-3333-4333-8333-333333333333']))
  }
})
