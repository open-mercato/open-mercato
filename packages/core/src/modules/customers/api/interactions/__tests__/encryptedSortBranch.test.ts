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
