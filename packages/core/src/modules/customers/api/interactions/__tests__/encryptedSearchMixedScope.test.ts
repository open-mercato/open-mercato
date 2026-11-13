import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'

const tenantId = '11111111-1111-4111-8111-111111111111'
const parentOrgId = '22222222-2222-4222-8222-222222222222'
const childOrgId = '55555555-5555-4555-8555-555555555555'
const rowId = (index: number) => `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`

type StoredRow = { id: string; organizationId: string; title: string; body: string }

const recorded: CompiledQuery[] = []
const storedRows = new Map<string, StoredRow>()
const plaintextById = new Map<string, { title: string; body: string }>()
let scope: { filterIds: string[] | null; selectedId: string | null } = { filterIds: [parentOrgId, childOrgId], selectedId: null }

function storePlaintextRow(index: number, title: string, body = '') {
  storedRows.set(rowId(index), { id: rowId(index), organizationId: parentOrgId, title, body })
}

function storeEncryptedRow(index: number, title: string, body = '') {
  const id = rowId(index)
  storedRows.set(id, { id, organizationId: childOrgId, title: `enc:${id}:title`, body: `enc:${id}:body` })
  plaintextById.set(id, { title, body })
}

function fullRow(row: StoredRow) {
  return {
    id: row.id,
    entity_id: '44444444-4444-4444-8444-444444444444',
    interaction_type: 'meeting',
    title: row.title,
    body: row.body,
    status: 'done',
    organization_id: row.organizationId,
    tenant_id: tenantId,
    created_at: new Date('2026-03-01T00:00:00.000Z'),
    updated_at: new Date('2026-03-01T00:00:00.000Z'),
    __sort_value: new Date('2026-03-01T00:00:00.000Z'),
  }
}

// Candidate scans name their columns, so the fake returns exactly those: a projection that
// drops a column the route later reads must show up as a missing value, not be papered over.
function projectedColumns(sqlText: string): string[] | null {
  const match = /^select (.+?) from "customer_interactions"/i.exec(sqlText)
  if (!match) return null
  const columns = match[1]!.split(',').map((part) => part.trim())
  if (!columns.every((column) => /^"[a-z_]+"$/.test(column))) return null
  return columns.map((column) => column.slice(1, -1))
}

function project(row: Record<string, unknown>, columns: string[] | null): Record<string, unknown> {
  if (!columns) return row
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))
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
    const pageIds = compiled.parameters.filter((value): value is string => typeof value === 'string' && storedRows.has(value))
    if (/"id" in/.test(compiled.sql)) return { rows: pageIds.map((id) => fullRow(storedRows.get(id) as StoredRow)) }
    // SQL ILIKE only ever sees what is stored: ciphertext never contains the search term.
    const term = compiled.parameters.find((value): value is string => typeof value === 'string' && value.startsWith('%'))
    const needle = term ? term.replace(/%/g, '').toLowerCase() : null
    return {
      rows: Array.from(storedRows.values())
        .filter((row) => needle === null || row.title.toLowerCase().includes(needle) || row.body.toLowerCase().includes(needle))
        .map((row) => project({ scheduled_at: null, ...fullRow(row) }, projectedColumns(compiled.sql))),
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
  getAuthFromRequest: async () => ({ tenantId, orgId: parentOrgId, sub: null, isApiKey: true }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => scope,
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

const mockIsEnabled = jest.fn<boolean, []>(() => true)
// Mirrors the service: an organization resolves its own map, and the tenant-wide policy
// (`null`) is the union of every organization's map.
const mockGetEncryptedFieldNames = jest.fn<Promise<string[]>, [string, string | null, string | null]>(
  async (_entityId, _tenantId, organizationId) => (organizationId === parentOrgId ? [] : ['title', 'body']),
)
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => ({
    isEnabled: () => mockIsEnabled(),
    getEncryptedFieldNames: (entityId: string, tenant: string | null, organizationId: string | null) =>
      mockGetEncryptedFieldNames(entityId, tenant, organizationId),
    decryptEntityPayload: async (_entityId: string, payload: { id: string }, _tenant: string | null, organizationId: string | null) =>
      (organizationId === childOrgId ? plaintextById.get(payload.id) ?? {} : {}),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async () => [],
}))

import { GET } from '../route'

type ListPayload = { items: Array<{ id: string }>; nextCursor?: string }

async function listByTitle(extra = ''): Promise<ListPayload> {
  const res = await GET(new Request(`http://localhost/api/customers/interactions?limit=2&sortField=title&sortDir=asc${extra}`))
  expect(res.status).toBe(200)
  return await res.json() as ListPayload
}

const candidateScans = () => recorded.filter((query) => projectedColumns(query.sql) !== null && !/"id" in/.test(query.sql))

async function searchIds(term: string): Promise<string[]> {
  const res = await GET(new Request(`http://localhost/api/customers/interactions?search=${term}&limit=50&sortField=scheduledAt&sortDir=desc`))
  expect(res.status).toBe(200)
  const payload = await res.json() as { items: Array<{ id: string }> }
  return payload.items.map((item) => item.id)
}

const ilikeQueries = () => recorded.filter((query) => /\bilike\b/i.test(query.sql))
const organizationDiscoveryQueries = () => recorded.filter((query) => /\bdistinct\b/i.test(query.sql))

describe('interactions list — search across organizations with different encryption maps', () => {
  beforeEach(() => {
    recorded.length = 0
    storedRows.clear()
    plaintextById.clear()
    mockIsEnabled.mockReturnValue(true)
    mockGetEncryptedFieldNames.mockClear()
    scope = { filterIds: [parentOrgId, childOrgId], selectedId: null }
    storePlaintextRow(1, 'Parent renewal call')
    storePlaintextRow(2, 'Parent unrelated')
    storeEncryptedRow(3, 'Child RENEWAL meeting')
    storeEncryptedRow(4, 'Child other', 'notes on the renewal terms')
    storeEncryptedRow(5, 'Child unrelated')
  })

  test('finds matches in an encrypted child organization when the parent keeps title and body in plaintext', async () => {
    const ids = await searchIds('renewal')

    expect(ids).toEqual([rowId(1), rowId(3), rowId(4)])
    expect(ilikeQueries()).toHaveLength(0)
    expect(mockGetEncryptedFieldNames.mock.calls.map((call) => call[2])).toEqual(
      expect.arrayContaining([parentOrgId, childOrgId]),
    )
  })

  test('an unrestricted scope uses the tenant-wide policy and never discovers organizations from the rows', async () => {
    scope = { filterIds: null, selectedId: null }

    const ids = await searchIds('renewal')

    expect(ids).toEqual([rowId(1), rowId(3), rowId(4)])
    expect(mockGetEncryptedFieldNames.mock.calls[0]?.[2]).toBeNull()
    expect(organizationDiscoveryQueries()).toHaveLength(0)
    expect(ilikeQueries()).toHaveLength(0)
  })

  test('an unrestricted list without a search or an encrypted sort stays on the single page query', async () => {
    scope = { filterIds: null, selectedId: null }

    const res = await GET(new Request('http://localhost/api/customers/interactions?limit=50&sortField=scheduledAt&sortDir=desc'))

    expect(res.status).toBe(200)
    expect(organizationDiscoveryQueries()).toHaveLength(0)
    expect(candidateScans()).toHaveLength(0)
    expect(recorded).toHaveLength(1)
  })

  test('keeps the SQL search when encryption is off', async () => {
    scope = { filterIds: null, selectedId: null }
    mockIsEnabled.mockReturnValue(false)

    const ids = await searchIds('renewal')

    expect(ids).toEqual([rowId(1)])
    expect(organizationDiscoveryQueries()).toHaveLength(0)
    expect(ilikeQueries().length).toBeGreaterThan(0)
  })

  test('keeps the SQL search when no organization in scope encrypts title or body', async () => {
    mockGetEncryptedFieldNames.mockImplementation(async () => [])

    await searchIds('renewal')

    expect(ilikeQueries().length).toBeGreaterThan(0)
  })

  describe('sorting by a column only the child organization encrypts, without a search', () => {
    beforeEach(() => {
      storedRows.clear()
      plaintextById.clear()
      mockGetEncryptedFieldNames.mockImplementation(
        async (_entityId, _tenantId, organizationId) => (organizationId === childOrgId ? ['title'] : []),
      )
      storePlaintextRow(1, 'Bravo')
      storePlaintextRow(2, 'Delta')
      storeEncryptedRow(3, 'Alpha')
      storeEncryptedRow(4, 'Charlie')
    })

    test('keeps each candidate\'s organization in the projection so child titles sort by their plaintext', async () => {
      const first = await listByTitle()

      expect(first.items.map((item) => item.id)).toEqual([rowId(3), rowId(1)])
      const [scan] = candidateScans()
      expect(projectedColumns(scan!.sql)).toEqual(expect.arrayContaining(['id', 'organization_id', 'title']))
      expect(scan!.sql).not.toMatch(/\bilike\b/i)
    })

    test('pages through the mixed scope in plaintext order', async () => {
      const first = await listByTitle()
      expect(first.nextCursor).toBeTruthy()

      const second = await listByTitle(`&cursor=${encodeURIComponent(first.nextCursor as string)}`)

      expect(second.items.map((item) => item.id)).toEqual([rowId(4), rowId(2)])
      expect(second.nextCursor).toBeUndefined()
    })
  })
})
