/** @jest-environment node */

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const HOME_ORG_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockReportError = jest.fn()

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

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  return { createLogger: () => ({ ...logger, child: () => logger }) }
})

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const buildRequest = () =>
  new Request('http://localhost/api/ledger/accounts/import-default-chart-of-accounts', { method: 'POST' })

describe('ledger accounts/import-default-chart-of-accounts route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORG_ID,
      features: ['ledger.accounts.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockExecute.mockResolvedValue({ result: { createdAccountTypeIds: ['t1', 't2'], createdAccountIds: ['a1'] } })
  })

  it('imports into the selected organization and returns the row counts', async () => {
    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, createdAccountTypeCount: 2, createdAccountCount: 1 })
    expect(mockExecute).toHaveBeenCalledWith(
      'ledger.importDefaultChartOfAccounts',
      expect.objectContaining({ input: { organizationId: ORG_ID, tenantId: TENANT_ID } }),
    )
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('passes a command refusal (409) through without reporting it as an error', async () => {
    const { conflict } = jest.requireActual('@open-mercato/shared/lib/crud/errors') as typeof import('@open-mercato/shared/lib/crud/errors')
    mockExecute.mockRejectedValue(conflict('The chart of accounts already has 1 account type(s)'))

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(409)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('reports an unexpected error and answers 500 with a translated message', async () => {
    const failure = new Error('[internal] boom')
    mockExecute.mockRejectedValue(failure)

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
    expect(mockReportError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ module: 'ledger', code: 'ledger.chart_of_accounts_import_failed' }),
    )
  })
})
