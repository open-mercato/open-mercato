import { GET } from '../route'

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
  sortTodoRows: jest.fn((rows: unknown[]) => rows),
}))

describe('customers customer-todos widget route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('merges legacy and canonical rows while unified mode is disabled', async () => {
    const { resolveCustomerInteractionFeatureFlags } =
      jest.requireMock('../../../../../lib/interactionFeatureFlags')
    const { listLegacyTodoRows, listCanonicalTodoRows } =
      jest.requireMock('../../../../../lib/todoCompatibility')

    resolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    listLegacyTodoRows.mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111111',
        todoId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        todoSource: 'example:todo',
        todoTitle: 'Legacy task',
        createdAt: '2026-04-01T10:00:00.000Z',
        organizationId: '22222222-2222-2222-2222-222222222222',
        tenantId: '33333333-3333-3333-3333-333333333333',
        customer: {
          id: '44444444-4444-4444-4444-444444444444',
          displayName: 'Legacy Co',
          kind: 'company',
        },
      },
    ])
    listCanonicalTodoRows.mockResolvedValue({
      items: [
        {
          id: '55555555-5555-5555-5555-555555555555',
          todoId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          todoSource: 'customers:interaction',
          todoTitle: 'Canonical task',
          createdAt: '2026-04-02T10:00:00.000Z',
          organizationId: '22222222-2222-2222-2222-222222222222',
          tenantId: '33333333-3333-3333-3333-333333333333',
          _integrations: {
            example: { href: '/backend/todos/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/edit' },
          },
          customer: {
            id: '66666666-6666-6666-6666-666666666666',
            displayName: 'Canonical Co',
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
    expect(body.items).toHaveLength(2)
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '11111111-1111-1111-1111-111111111111',
          todoSource: 'example:todo',
          todoTitle: 'Legacy task',
        }),
        expect.objectContaining({
          id: '55555555-5555-5555-5555-555555555555',
          todoSource: 'customers:interaction',
          todoTitle: 'Canonical task',
        }),
      ]),
    )
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
})
