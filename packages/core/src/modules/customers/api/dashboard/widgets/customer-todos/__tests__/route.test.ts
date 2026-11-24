import { GET } from '../route'

const TENANT_ID = '33333333-3333-3333-3333-333333333333'
const ORG_ID = '22222222-2222-2222-2222-222222222222'

jest.mock('../../utils', () => ({
  resolveWidgetScope: jest.fn(async () => ({
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'queryEngine') return { kind: 'query-engine' }
        throw new Error(`Unexpected container resolve: ${name}`)
      }),
    },
    em: {},
    tenantId: '33333333-3333-3333-3333-333333333333',
    organizationIds: ['22222222-2222-2222-2222-222222222222'],
    isUnrestrictedOrganizationScope: false,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('../../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(),
}))

jest.mock('../../../../../lib/todoCompatibility', () => ({
  listLegacyTodoRows: jest.fn(),
  listCanonicalTodoRows: jest.fn(),
  listMergedTodoRows: jest.fn(),
}))

describe('customers customer-todos widget route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('asks the canonical read for open tasks only while unified mode is enabled', async () => {
    const { resolveCustomerInteractionFeatureFlags } =
      jest.requireMock('../../../../../lib/interactionFeatureFlags')
    const { listCanonicalTodoRows } =
      jest.requireMock('../../../../../lib/todoCompatibility')

    resolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: true })
    listCanonicalTodoRows.mockResolvedValue({ items: [], bridgeIds: new Set<string>(), total: 0 })

    const res = await GET(new Request('http://localhost/api?limit=5'))

    expect(res.status).toBe(200)
    expect(listCanonicalTodoRows.mock.calls[0][5]).toMatchObject({ filters: { status: 'open' } })
  })

  it('uses only canonical rows while unified mode is enabled', async () => {
    const { resolveCustomerInteractionFeatureFlags } =
      jest.requireMock('../../../../../lib/interactionFeatureFlags')
    const { listLegacyTodoRows, listCanonicalTodoRows } =
      jest.requireMock('../../../../../lib/todoCompatibility')

    resolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: true })
    listLegacyTodoRows.mockResolvedValue([])
    listCanonicalTodoRows.mockResolvedValue({
      items: [
        {
          id: '77777777-7777-7777-7777-777777777777',
          todoId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          todoSource: 'customers:interaction',
          todoTitle: 'Canonical only',
          createdAt: '2026-04-03T10:00:00.000Z',
          organizationId: '22222222-2222-2222-2222-222222222222',
          tenantId: '33333333-3333-3333-3333-333333333333',
          customer: {
            id: '88888888-8888-8888-8888-888888888888',
            displayName: 'Canonical Only Co',
            kind: 'company',
          },
        },
      ],
      bridgeIds: new Set<string>(),
    })

    const req = new Request('http://localhost/api?limit=5')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: '77777777-7777-7777-7777-777777777777',
      todoSource: 'customers:interaction',
      todoTitle: 'Canonical only',
    })
    expect(listLegacyTodoRows).not.toHaveBeenCalled()
  })

  it('reads the merged compatibility feed for one page of open tasks', async () => {
    const { resolveCustomerInteractionFeatureFlags } =
      jest.requireMock('../../../../../lib/interactionFeatureFlags')
    const { listMergedTodoRows, listCanonicalTodoRows } =
      jest.requireMock('../../../../../lib/todoCompatibility')

    resolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    listMergedTodoRows.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          todoId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          todoSource: 'example:todo',
          todoTitle: 'Legacy task',
          createdAt: '2026-04-01T10:00:00.000Z',
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          customer: { id: '44444444-4444-4444-4444-444444444444', displayName: 'Legacy Co', kind: 'company' },
        },
        {
          id: '55555555-5555-5555-5555-555555555555',
          todoId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          todoSource: 'customers:interaction',
          todoTitle: 'Canonical task',
          createdAt: '2026-04-02T10:00:00.000Z',
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          customer: { id: '66666666-6666-6666-6666-666666666666', displayName: 'Canonical Co', kind: 'company' },
        },
      ],
      total: 2,
      totalIsCapped: false,
    })

    const res = await GET(new Request('http://localhost/api?limit=5'))

    expect(res.status).toBe(200)
    expect(listCanonicalTodoRows).not.toHaveBeenCalled()
    expect(listMergedTodoRows).toHaveBeenCalledTimes(1)
    const options = listMergedTodoRows.mock.calls[0][6]
    expect(options).toMatchObject({
      pagination: { page: 1, pageSize: 5 },
      filters: { status: 'open' },
      isUnrestricted: false,
    })
    expect(options).not.toHaveProperty('source')
    const body = await res.json()
    expect(body.items.map((item: { todoTitle: string }) => item.todoTitle)).toEqual(['Legacy task', 'Canonical task'])
  })

  it('passes unrestricted widget scope through to the merged compatibility read', async () => {
    const { resolveWidgetScope } = jest.requireMock('../../utils')
    const { resolveCustomerInteractionFeatureFlags } =
      jest.requireMock('../../../../../lib/interactionFeatureFlags')
    const { listMergedTodoRows } =
      jest.requireMock('../../../../../lib/todoCompatibility')

    resolveWidgetScope.mockResolvedValueOnce({
      container: {
        resolve: jest.fn((name: string) => {
          if (name === 'queryEngine') return { kind: 'query-engine' }
          throw new Error(`Unexpected container resolve: ${name}`)
        }),
      },
      em: {},
      tenantId: TENANT_ID,
      organizationIds: null,
      isUnrestrictedOrganizationScope: true,
    })
    resolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    listMergedTodoRows.mockResolvedValue({ items: [], total: 0, totalIsCapped: false })

    const res = await GET(new Request('http://localhost/api?limit=5'))

    expect(res.status).toBe(200)
    expect(listMergedTodoRows.mock.calls[0][5]).toBeNull()
    expect(listMergedTodoRows.mock.calls[0][6]).toEqual(expect.objectContaining({ isUnrestricted: true }))
  })

  it('passes explicit organization scope through to the merged compatibility read', async () => {
    const { resolveCustomerInteractionFeatureFlags } =
      jest.requireMock('../../../../../lib/interactionFeatureFlags')
    const { listMergedTodoRows } =
      jest.requireMock('../../../../../lib/todoCompatibility')

    resolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    listMergedTodoRows.mockResolvedValue({ items: [], total: 0, totalIsCapped: false })

    const res = await GET(new Request('http://localhost/api?limit=5'))

    expect(res.status).toBe(200)
    expect(listMergedTodoRows.mock.calls[0][5]).toEqual([ORG_ID])
    expect(listMergedTodoRows.mock.calls[0][6]).toEqual(expect.objectContaining({ isUnrestricted: false }))
  })
})
