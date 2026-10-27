/** @jest-environment node */
/**
 * Coverage for the hand-written (non-CRUD) organizations route.
 *
 * The route is the module's reference for "a route that builds its own request container".
 * It previously shaped the query-engine result through `(org: any)`, answered with raw
 * `new Response(JSON.stringify(...))`, logged with raw `console.error`, and split the `ids`
 * query parameter by hand so a blank entry reached the query engine as an empty id.
 */
const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A = '00000000-0000-4000-8000-0000000000a1'

type QueryCall = { entity: unknown; options: Record<string, unknown> }

const queryCalls: QueryCall[] = []
const queryResult: { items: Array<{ id: string; name: string | null }>; failWith: Error | null } = {
  items: [],
  failWith: null,
}

const mockAuth: { value: { orgId?: string | null; tenantId?: string | null } | null } = { value: null }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(async () => mockAuth.value),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'queryEngine'
      ? {
          query: async (entity: unknown, options: Record<string, unknown>) => {
            queryCalls.push({ entity, options })
            if (queryResult.failWith) throw queryResult.failWith
            return { items: queryResult.items, page: 1, pageSize: queryResult.items.length, total: queryResult.items.length }
          },
        }
      : null),
  })),
}))

import { GET } from '../organizations/route'

function request(search: string): Request {
  return new Request(`http://localhost/api/example/organizations${search}`)
}

describe('example organizations route', () => {
  beforeEach(() => {
    queryCalls.length = 0
    queryResult.items = []
    queryResult.failWith = null
    mockAuth.value = { orgId: ORG_A, tenantId: TENANT_A }
  })

  it('answers 401 as JSON without a tenant', async () => {
    mockAuth.value = { orgId: null, tenantId: null }

    const response = await GET(request('?ids=1'))

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(queryCalls).toHaveLength(0)
  })

  it('returns an empty list without querying when no ids are supplied', async () => {
    const response = await GET(request(''))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(queryCalls).toHaveLength(0)
  })

  it('drops blank entries instead of forwarding an empty id to the query engine', async () => {
    await GET(request('?ids=org-1,,%20,org-2'))

    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0].options.filters).toEqual([
      { field: 'id', op: 'in', value: ['org-1', 'org-2'] },
    ])
    expect(queryCalls[0].options.tenantId).toBe(TENANT_A)
  })

  it('treats an ids parameter that is only separators as no ids at all', async () => {
    const response = await GET(request('?ids=,,'))

    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(queryCalls).toHaveLength(0)
  })

  it('shapes the response from the typed query-engine rows', async () => {
    queryResult.items = [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: null }]

    const response = await GET(request('?ids=org-1,org-2'))

    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: null }],
    })
  })

  it('answers 500 as JSON when the query engine throws', async () => {
    queryResult.failWith = new Error('[internal] query engine unavailable')

    const response = await GET(request('?ids=org-1'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
