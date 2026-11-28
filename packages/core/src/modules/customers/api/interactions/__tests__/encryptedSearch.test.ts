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
const rowId = (index: number) => `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`

const recorded: CompiledQuery[] = []
const plaintextById = new Map<string, { title: string; body: string }>()

function fullRow(id: string) {
  return {
    id,
    entity_id: '44444444-4444-4444-8444-444444444444',
    interaction_type: 'meeting',
    title: `enc:${id}:title`,
    body: `enc:${id}:body`,
    status: 'done',
    organization_id: orgId,
    tenant_id: tenantId,
    created_at: new Date('2026-03-01T00:00:00.000Z'),
    updated_at: new Date('2026-03-01T00:00:00.000Z'),
    __sort_value: new Date('2026-03-01T00:00:00.000Z'),
  }
}

function createKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (compiled: CompiledQuery) => {
    if (!compiled.sql.includes('customer_interactions')) return { rows: [] }
    recorded.push(compiled)
    const pageIds = compiled.parameters.filter((value): value is string => typeof value === 'string' && plaintextById.has(value))
    if (/"id" in/.test(compiled.sql)) return { rows: pageIds.map(fullRow) }
    if (/\bilike\b/i.test(compiled.sql)) return { rows: [] }
    return {
      rows: Array.from(plaintextById.keys()).map((id) => ({
        id,
        organization_id: orgId,
        title: `enc:${id}:title`,
        body: `enc:${id}:body`,
        scheduled_at: null,
      })),
    }
  }
  return db
}

const fakeEm = {
  fork() {
    return { getKysely: () => createKysely() }
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => (token === 'em' ? fakeEm : undefined),
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId, orgId, sub: null, isApiKey: true }),
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

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: async () => ({}),
}))

const mockGetEncryptedFieldNames = jest.fn<Promise<string[]>, unknown[]>(async () => ['title', 'body'])
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => ({
    isEnabled: () => true,
    getEncryptedFieldNames: (...args: unknown[]) => mockGetEncryptedFieldNames(...args),
    decryptEntityPayload: async (_entityId: string, payload: { id: string }) => plaintextById.get(payload.id) ?? {},
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async () => [],
}))

import { GET } from '../route'

function list(qs: string) {
  return GET(new Request(`http://localhost/api/customers/interactions?${qs}`))
}

const ilikeQueries = () => recorded.filter((query) => /\bilike\b/i.test(query.sql))

describe('interactions list — search over encrypted title and body', () => {
  beforeEach(() => {
    recorded.length = 0
    plaintextById.clear()
    mockGetEncryptedFieldNames.mockImplementation(async () => ['title', 'body'])
    delete process.env.OM_ENCRYPTED_SEARCH_MAX_ROWS
  })

  test('finds a match the first page of history would not show, by decrypting the candidates', async () => {
    for (let index = 1; index <= 60; index += 1) {
      plaintextById.set(rowId(index), { title: `Call ${index}`, body: '' })
    }
    plaintextById.set(rowId(61), { title: 'Quarterly RENEWAL', body: '' })
    plaintextById.set(rowId(62), { title: 'Other', body: 'talked about renewal terms' })

    const res = await list('search=renewal&limit=50&sortField=scheduledAt&sortDir=desc')

    expect(res.status).toBe(200)
    const payload = await res.json() as { items: Array<{ id: string }>; nextCursor?: string }
    expect(payload.items.map((item) => item.id)).toEqual([rowId(61), rowId(62)])
    expect(payload.nextCursor).toBeUndefined()
    expect(ilikeQueries()).toHaveLength(0)
  })

  test('pages over matches only', async () => {
    plaintextById.set(rowId(1), { title: 'Renewal one', body: '' })
    plaintextById.set(rowId(2), { title: 'Unrelated', body: '' })
    plaintextById.set(rowId(3), { title: 'Renewal two', body: '' })

    const first = await (await list('search=renewal&limit=1&sortField=scheduledAt&sortDir=desc')).json() as { items: Array<{ id: string }>; nextCursor?: string }
    expect(first.items.map((item) => item.id)).toEqual([rowId(1)])
    expect(first.nextCursor).toBeTruthy()

    const second = await (await list(`search=renewal&limit=1&sortField=scheduledAt&sortDir=desc&cursor=${encodeURIComponent(first.nextCursor as string)}`)).json() as { items: Array<{ id: string }>; nextCursor?: string }
    expect(second.items.map((item) => item.id)).toEqual([rowId(3)])
    expect(second.nextCursor).toBeUndefined()
  })

  test('bounds the scan, ordered by the requested sort, and stays inside the tenant and organization', async () => {
    process.env.OM_ENCRYPTED_SEARCH_MAX_ROWS = '250'
    await list('search=renewal&sortField=scheduledAt&sortDir=desc')

    const [candidateQuery] = recorded
    expect(candidateQuery.sql).toMatch(/order by coalesce\(scheduled_at/i)
    expect(candidateQuery.sql).toMatch(/limit \$\d+/i)
    expect(candidateQuery.parameters).toEqual(expect.arrayContaining([250, tenantId, orgId]))
  })

  test('keeps the SQL search when title and body are not encrypted', async () => {
    mockGetEncryptedFieldNames.mockImplementation(async () => [])
    await list('search=renewal&sortField=scheduledAt&sortDir=desc')

    expect(ilikeQueries().length).toBeGreaterThan(0)
    expect(recorded.some((query) => /"body"/.test(query.sql) && !/\bilike\b/i.test(query.sql))).toBe(false)
  })
})
