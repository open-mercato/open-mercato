/** @jest-environment node */

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((...args: unknown[]) => mockRunRouteMutationGuards(...args)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const buildRequest = (startDate: string) =>
  new Request('http://localhost/api/ledger/fiscal-periods/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startDate }),
  })

describe('ledger fiscal-periods/generate route — mutation guard payload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: ['ledger.periods.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockExecute.mockResolvedValue({ result: { fiscalPeriodIds: ['p1'] } })
  })

  it('passes the requested start date through when no guard rewrites it', async () => {
    const response = await postHandler(buildRequest('2026-01-01'))

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalledWith(
      'ledger.generateFiscalPeriods',
      expect.objectContaining({
        input: { organizationId: ORG_ID, tenantId: TENANT_ID, startDate: '2026-01-01' },
      }),
    )
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('runs the command with the start date a guard rewrote', async () => {
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { startDate: '2026-04-01' },
      runAfterSuccess: mockRunAfterSuccess,
    })

    const response = await postHandler(buildRequest('2026-01-01'))

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalledWith(
      'ledger.generateFiscalPeriods',
      expect.objectContaining({
        input: { organizationId: ORG_ID, tenantId: TENANT_ID, startDate: '2026-04-01' },
      }),
    )
  })

  it('never lets a guard override the server-side organization or tenant', async () => {
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { startDate: '2026-04-01', organizationId: '99999999-9999-4999-8999-999999999999', tenantId: '88888888-8888-4888-8888-888888888888' },
      runAfterSuccess: mockRunAfterSuccess,
    })

    await postHandler(buildRequest('2026-01-01'))

    expect(mockExecute).toHaveBeenCalledWith(
      'ledger.generateFiscalPeriods',
      expect.objectContaining({
        input: { organizationId: ORG_ID, tenantId: TENANT_ID, startDate: '2026-04-01' },
      }),
    )
  })

  it('revalidates a rewritten start date and refuses one that is not the first of a month', async () => {
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { startDate: '2026-04-15' },
      runAfterSuccess: mockRunAfterSuccess,
    })

    const response = await postHandler(buildRequest('2026-01-01'))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('refuses a rewritten start date that is not a string', async () => {
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { startDate: 20260401 },
      runAfterSuccess: mockRunAfterSuccess,
    })

    const response = await postHandler(buildRequest('2026-01-01'))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns the guard response untouched when a guard rejects the request', async () => {
    const rejection = new Response(JSON.stringify({ error: 'blocked' }), { status: 423 })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: false, response: rejection })

    const response = await postHandler(buildRequest('2026-01-01'))

    expect(response.status).toBe(423)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
