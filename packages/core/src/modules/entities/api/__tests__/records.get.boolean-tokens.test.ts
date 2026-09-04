/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/entities/api/records'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'

// Regression coverage for #5791: a `select` option whose value happens to read as a
// boolean token ("no", "yes", "on", "off", "1", "0", ...) came back from the records
// API as a real boolean, and the edit form then wrote that boolean back over the
// stored option. Only fields DECLARED boolean may be parsed as booleans.

const storedRow: Record<string, unknown> = {
  id: 'rec-1',
  cf_computed_verdict: 'no',
  cf_tags: ['no', 'maybe'],
  cf_is_archived: 'true',
  cf_notes: 'off',
  created_at: '2024-10-03T00:00:00Z',
}

const mockQE = {
  query: jest.fn(async () => ({ items: [{ ...storedRow }], total: 1, page: 1, pageSize: 50 })),
}

function defRow(key: string, kind: string) {
  return {
    key,
    kind,
    isActive: true,
    deletedAt: null,
    organizationId: 'org',
    tenantId: 't1',
    updatedAt: new Date('2024-10-01T00:00:00Z'),
  }
}

const fieldDefs = [
  defRow('computed_verdict', 'select'),
  defRow('tags', 'select'),
  defRow('is_archived', 'boolean'),
  defRow('notes', 'text'),
]

const mockEm = {
  find: jest.fn(async (entityClass: unknown) => (entityClass === CustomFieldDef ? fieldDefs : [])),
  findOne: jest.fn(async () => ({ id: 'ce-1', entityId: 'outreach:icp_evaluation' })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'queryEngine' ? mockQE : mockEm) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

const baseUrl = 'http://x/api/entities/records?entityId=outreach:icp_evaluation&page=1&pageSize=50'

async function getItems(url = baseUrl) {
  const res = await GET(new Request(url))
  expect(res.status).toBe(200)
  const json = await res.json()
  return json.items as Array<Record<string, unknown>>
}

async function getFilters(url: string) {
  await GET(new Request(url))
  const call = mockQE.query.mock.calls[0] as unknown as [string, { filters?: Record<string, unknown> }]
  return call[1]?.filters ?? {}
}

describe('GET /api/entities/records boolean-token handling', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('returns a select value of "no" as the string it was stored as', async () => {
    const items = await getItems()
    expect(items[0].computed_verdict).toBe('no')
  })

  it('preserves boolean-looking entries inside a multi-select array', async () => {
    const items = await getItems()
    expect(items[0].tags).toEqual(['no', 'maybe'])
  })

  it('still parses a field declared boolean into a real boolean', async () => {
    const items = await getItems()
    expect(items[0].is_archived).toBe(true)
  })

  it('leaves text values that read as boolean tokens untouched', async () => {
    const items = await getItems()
    expect(items[0].notes).toBe('off')
  })

  it('filters a select field by its literal string value', async () => {
    const filters = await getFilters(`${baseUrl}&computed_verdict=no`)
    expect(filters.computed_verdict).toBe('no')
  })

  it('filters a cf_-prefixed select field by its literal string value', async () => {
    const filters = await getFilters(`${baseUrl}&cf_computed_verdict=no`)
    expect(filters.cf_computed_verdict).toBe('no')
  })

  it('still coerces a filter on a field declared boolean', async () => {
    const filters = await getFilters(`${baseUrl}&is_archived=true`)
    expect(filters.is_archived).toBe(true)
  })

  it('leaves values as stored when field definitions cannot be loaded', async () => {
    mockEm.find.mockRejectedValueOnce(new Error('[internal] definitions unavailable'))
    const items = await getItems()
    expect(items[0].computed_verdict).toBe('no')
    expect(items[0].is_archived).toBe('true')
  })
})
