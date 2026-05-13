/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockResolveSyncExcelConcreteScope = jest.fn()
const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return {}
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../../lib/scope', () => ({
  resolveSyncExcelConcreteScope: jest.fn((params: unknown) => mockResolveSyncExcelConcreteScope(params)),
}))

type RouteModule = typeof import('../route')
let getHandler: RouteModule['GET']

beforeAll(async () => {
  const routeModule = await import('../route')
  getHandler = routeModule.GET
})

describe('sync_excel preview route scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockResolveSyncExcelConcreteScope.mockResolvedValue({
      ok: true,
      scope: {
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    })
    mockFindOneWithDecryption.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      filename: 'Leads.csv',
      mimeType: 'text/csv',
      fileSize: 42,
      entityType: 'customers.person',
      headers: ['Email', 'Lead Name'],
      sampleRows: [{ Email: 'ada@example.com', 'Lead Name': 'Ada Lovelace' }],
      totalRows: 1,
    })
  })

  it('returns 422 when All organizations is selected', async () => {
    mockResolveSyncExcelConcreteScope.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: 'Select a concrete organization before importing CSV.',
    })

    const response = await getHandler(new Request('http://localhost/api/sync_excel/preview?uploadId=11111111-1111-4111-8111-111111111111&entityType=customers.person', {
      headers: {
        cookie: 'om_selected_org=__all__',
      },
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Select a concrete organization before importing CSV.' })
  })

  it('loads previews through the concrete organization scope', async () => {
    const response = await getHandler(new Request('http://localhost/api/sync_excel/preview?uploadId=11111111-1111-4111-8111-111111111111&entityType=customers.person', {
      headers: {
        cookie: 'om_selected_org=33333333-3333-4333-8333-333333333333',
      },
    }))

    expect(response.status).toBe(200)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      }),
      undefined,
      {
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    )
  })
})
